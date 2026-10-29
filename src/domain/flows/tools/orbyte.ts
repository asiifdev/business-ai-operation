import { randomInt } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client';
import { clients, deployments, products } from '../../../db/schema';
import { recordAudit } from '../../audit/service';
import { resolvePublicHost } from '../../connections/network';
import { who } from '../../portfolio/shared';
import { ToolError } from './ssh';
import type { ToolDef } from './types';
import { absPath, branchName, domainName, intFrom, portList, repoName, secretName } from './validate';

const ALPHABETS = { alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', hex: '0123456789abcdef', lower: 'abcdefghijklmnopqrstuvwxyz0123456789' } as const;

const allocate = z.object({ from: intFrom(1024, 65535), to: intFrom(1024, 65535), used: z.string().max(20_000).default('') }).refine((v) => v.from <= v.to, 'range');
const secret = z.object({ name: secretName, length: intFrom(16, 128).default(32), alphabet: z.enum(['alnum', 'hex', 'lower']).default('alnum') });
const httpCheck = z.object({
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'url'),
  expect: z.string().regex(/^[0-9, ]{3,40}$/).default('200,301,302'),
  tries: intFrom(1, 12).default(3),
  delay_seconds: intFrom(0, 60).default(5),
});
const record = z.object({
  client_id: z.string().min(1).max(40),
  product_id: z.string().min(1).max(40),
  environment: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).default('production'),
  domain: domainName.optional(),
  repo: repoName.optional(),
  branch: branchName.optional(),
  app_path: absPath.optional(),
  app_port: intFrom(1, 65535).optional(),
  commit: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
  server_slot: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
});

export const orbyteTools: ToolDef[] = [
  {
    id: 'orbyte.allocate_port',
    needs: [],
    tier: 'read',
    available: true,
    outputs: ['port'],
    schema: allocate,
    async run(t, input: z.infer<typeof allocate>) {
      // The highest port already taken in the range, plus one (owner's rule, BR-M17-26). Taken = what the server listens on,
      // what the panel proxies to (both passed in as `used`), and what Orbyte has recorded for this organization.
      const known = await db.select({ port: deployments.appPort }).from(deployments).where(and(eq(deployments.orgId, t.ctx.orgId), isNotNull(deployments.appPort)));
      const taken = [...portList(input.used), ...known.map((k) => k.port!)].filter((p) => p >= input.from && p <= input.to);
      const port = taken.length ? Math.max(...taken) + 1 : input.from;
      if (port > input.to) throw new ToolError(`no free port left between ${input.from} and ${input.to}`);
      return { outputs: { port }, log: `port ${port} (${taken.length} taken in ${input.from}-${input.to})` };
    },
  },
  {
    id: 'orbyte.generate_secret',
    needs: [],
    tier: 'read',
    available: true,
    outputs: [],
    producesSecretFrom: 'name',
    schema: secret,
    async run(_t, input: z.infer<typeof secret>) {
      const chars = ALPHABETS[input.alphabet];
      const value = Array.from({ length: input.length }, () => chars[randomInt(chars.length)]).join('');
      return { secrets: { [input.name]: value }, log: `generated the secret "${input.name}" (${input.length} characters, kept only until the run ends)` };
    },
  },
  {
    id: 'orbyte.http_check',
    needs: [],
    tier: 'read',
    available: true,
    outputs: ['status'],
    schema: httpCheck,
    async run(t, input: z.infer<typeof httpCheck>) {
      // Orbyte's own server makes this request, so the address must be public (same guard as connections, D-059).
      const target = new URL(input.url);
      await resolvePublicHost(target.hostname);
      const wanted = new Set(input.expect.split(/[ ,]+/).map(Number));
      let last = 0;
      for (let attempt = 1; attempt <= input.tries; attempt++) {
        try {
          const res = await t.fetch(input.url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'orbyte-check' } });
          last = res.status;
          if (wanted.has(res.status)) return { outputs: { status: res.status }, log: `${input.url} answered ${res.status}` };
        } catch {
          last = 0;
        }
        if (attempt < input.tries) await new Promise((r) => setTimeout(r, input.delay_seconds * 1000));
      }
      throw new ToolError(`${input.url} answered ${last || 'nothing'}, expected ${[...wanted].join(' or ')}`);
    },
  },
  {
    id: 'orbyte.record_deployment',
    needs: [],
    tier: 'change',
    available: true,
    outputs: ['deployment_id'],
    schema: record,
    async run(t, input: z.infer<typeof record>) {
      const orgId = t.ctx.orgId;
      const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.orgId, orgId), eq(clients.id, input.client_id)));
      const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.orgId, orgId), eq(products.id, input.product_id)));
      if (!client || !product) throw new ToolError('the client or the product does not exist in this organization');
      const server = input.server_slot ? t.connectionId(input.server_slot) : undefined;
      const values = {
        domain: input.domain ?? null,
        repo: input.repo ?? null,
        branch: input.branch ?? null,
        appPath: input.app_path ?? null,
        appPort: input.app_port ?? null,
        deployedCommit: input.commit ?? null,
        latestCommit: input.commit ?? null,
        behindBy: input.commit ? 0 : null,
        serverConnectionId: server ?? null,
        codeCheckedAt: input.commit ? t.clock.now() : null,
        status: 'active' as const,
      };
      const id = await db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: deployments.id }).from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.productId, input.product_id), eq(deployments.clientId, input.client_id), eq(deployments.environment, input.environment)));
        const row = existing
          ? (await tx.update(deployments).set(values).where(and(eq(deployments.orgId, orgId), eq(deployments.id, existing.id))).returning({ id: deployments.id }))[0]
          : (await tx.insert(deployments).values({ orgId, productId: input.product_id, clientId: input.client_id, environment: input.environment, ...values }).returning({ id: deployments.id }))[0];
        await recordAudit(tx, who(t.ctx), { action: existing ? 'deployment.updated' : 'deployment.created', entityType: 'deployment', entityId: row.id, summary: { by: 'flow', runId: t.runId, domain: input.domain ?? null } });
        return row.id;
      });
      return { outputs: { deployment_id: id }, log: `recorded the deployment (${input.domain ?? 'no domain'}) in Orbyte` };
    },
  },
];
