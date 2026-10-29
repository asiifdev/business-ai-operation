import { and, asc, eq, sql } from 'drizzle-orm';
import { db, pg } from '../../db/client';
import { flowVersions, organizations, playbookRuns, playbookSteps } from '../../db/schema';
import { aapanelPost } from '../../integrations/aapanel/client';
import { githubClient } from '../../integrations/github/client';
import { sshConnect, type SshConfig, type SshSession } from '../../integrations/ssh/client';
import { systemClock, type Clock } from '../../lib/clock';
import { recordAudit } from '../audit/service';
import { openConnection } from '../connections/service';
import { resolvePublicHost } from '../connections/network';
import { decryptSecret, encryptSecret, scrubSecrets } from '../connections/vault';
import type { Ctx } from '../ctx';
import { userCtx } from '../ctx';
import { definitionSchema, validateDefinition, type Definition } from './definition';
import { render, TemplateError, type Scalar, type Scope } from './template';
import { getTool, ToolError, type PanelCall, type ToolContext } from './tools';
import type { Role } from '../permissions';

/**
 * Runs a flow (BRD-M17 section 13). One run, one worker at a time: nodes go in topological order, each node once; a node that
 * fails pauses the run and waits for a person (retry or cancel); a node that is `done` is never repeated when the run
 * continues, even after the process died in between. Secrets the run generated live sealed in the run row until the run ends
 * (BR-M17-24). Nothing here talks to the model.
 */
export interface RunServices {
  ssh(orgId: string, connectionId: string): Promise<SshSession>;
  panel(orgId: string, connectionId: string): Promise<PanelCall>;
  github(orgId: string, connectionId: string): Promise<{ client: ReturnType<typeof githubClient>; installationId: number }>;
  fetch: typeof fetch;
  gitBase: string;
  clock: Clock;
}

export const realServices = (): RunServices => ({
  async ssh(orgId, connectionId) {
    const { row, secret } = await openConnection(orgId, connectionId);
    if (row.kind !== 'ssh') throw new ToolError('the slot is not bound to an SSH connection');
    if (!row.hostKeyFingerprint) throw new ToolError('the server fingerprint was never confirmed: test and confirm the connection first');
    const named = row.config as unknown as SshConfig;
    const cfg: SshConfig = { ...named, host: (await resolvePublicHost(named.host)).address };
    const s = await sshConnect(cfg, secret, row.hostKeyFingerprint);
    if (!('exec' in s)) throw new ToolError('the SSH connection did not open');
    return s;
  },
  async panel(orgId, connectionId) {
    const { row, secret } = await openConnection(orgId, connectionId);
    if (row.kind !== 'aapanel') throw new ToolError('the slot is not bound to an aaPanel connection');
    const url = String(row.config.url);
    const address = await resolvePublicHost(new URL(url).hostname);
    return async (path, form) => {
      const res = await aapanelPost({ url, tlsInsecure: Boolean(row.config.tlsInsecure), address }, secret.apiKey ?? '', path, form ?? {});
      try {
        return JSON.parse(res.body);
      } catch {
        throw new ToolError('the panel answered with something that is not JSON');
      }
    };
  },
  async github(orgId, connectionId) {
    const { row } = await openConnection(orgId, connectionId);
    if (row.kind !== 'github') throw new ToolError('the slot is not bound to a GitHub connection');
    return { client: githubClient(), installationId: Number(row.config.installationId) };
  },
  fetch,
  gitBase: 'https://github.com',
  clock: systemClock,
});

/** Another worker already runs it, or one of its servers is busy with another run: try again shortly. */
export class RunBusy extends Error {
  constructor() {
    super('busy');
    this.name = 'RunBusy';
  }
}

const OUTPUT_LIMIT = 8 * 1024;
const MASK = '••••';

function scalarOutputs(o: Record<string, Scalar> | undefined): Record<string, Scalar> {
  return o ? Object.fromEntries(Object.entries(o).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))) : {};
}

/** Zod issues as `path: message`, never the value: a rejected value could be a secret. */
const issueText = (issues: Array<{ path: PropertyKey[]; message: string }>) => issues.map((i) => `${i.path.map(String).join('.') || 'value'}: ${i.message}`).join('; ').slice(0, 400);

type RunRow = typeof playbookRuns.$inferSelect;

async function withLocks<T>(runId: string, connectionIds: string[], fn: () => Promise<T>): Promise<T> {
  const reserved = await pg.reserve();
  const keys = [`run:${runId}`, ...[...new Set(connectionIds)].sort().map((c) => `conn:${c}`)];
  const held: string[] = [];
  try {
    for (const k of keys) {
      const [row] = await reserved`select pg_try_advisory_lock(hashtext(${k})) as ok`;
      if (!row.ok) throw new RunBusy();
      held.push(k);
    }
    return await fn();
  } finally {
    for (const k of held) await reserved`select pg_advisory_unlock(hashtext(${k}))`;
    reserved.release();
  }
}

export async function purgeRunSecrets(runId: string) {
  await db.update(playbookRuns).set({ secretsCiphertext: null, secretsKeyVersion: null }).where(eq(playbookRuns.id, runId));
}

/**
 * Executes (or continues) a run that is `running`. Returns when the run is done, paused on a failed node, or cancelled.
 * Throws `RunBusy` when it cannot take its locks yet.
 */
export async function executeRun(runId: string, services: RunServices = realServices()): Promise<'done' | 'paused' | 'cancelled' | 'failed' | 'skipped'> {
  const [run] = await db.select().from(playbookRuns).where(eq(playbookRuns.id, runId));
  if (!run || run.status !== 'running') return 'skipped';
  const bindings = run.bindings;
  return withLocks(runId, Object.values(bindings), () => loop(run, services));
}

async function loop(initial: RunRow, services: RunServices) {
  const { orgId } = initial;
  const [ver] = await db.select().from(flowVersions).where(and(eq(flowVersions.orgId, orgId), eq(flowVersions.id, initial.flowVersionId ?? '')));
  const [org] = await db.select({ timeout: organizations.stepTimeoutSec }).from(organizations).where(eq(organizations.id, orgId));
  const failRun = async (message: string) => {
    await db.update(playbookRuns).set({ status: 'failed', error: message.slice(0, 500), finishedAt: services.clock.now(), secretsCiphertext: null, secretsKeyVersion: null }).where(eq(playbookRuns.id, initial.id));
    return 'failed' as const;
  };
  if (!ver) return failRun('the flow version of this run no longer exists');
  const parsed = definitionSchema.safeParse(ver.definition);
  if (!parsed.success) return failRun('the saved flow is not a valid definition');
  const def: Definition = parsed.data;
  const { order } = validateDefinition(def, { canUseCommand: true }); // who may SAVE a command node was decided when it was saved
  if (!order) return failRun('the flow has a cycle');

  const bindings = initial.bindings;
  const params = initial.params as Record<string, Scalar>;
  const product = ((initial.params as { __product?: Record<string, Scalar> }).__product ?? {}) as Record<string, Scalar>;
  const secrets: Record<string, string> = initial.secretsCiphertext ? decryptSecret(initial.secretsCiphertext, orgId, initial.id, initial.secretsKeyVersion ?? undefined) : {};
  const tracked = new Set<string>();
  const scrub = (text: string) => scrubSecrets(text, [...Object.values(secrets), ...tracked]);

  const steps = await db.select().from(playbookSteps).where(and(eq(playbookSteps.orgId, orgId), eq(playbookSteps.runId, initial.id))).orderBy(asc(playbookSteps.position));
  const nodes: Record<string, Record<string, Scalar>> = {};
  const sessions = new Map<string, SshSession>();
  const actor: Ctx = { ...userCtx({ orgId, userId: initial.createdBy.replace(/^user:/, ''), role: 'admin' as Role }, services.clock), actor: `system:flow:${initial.id}` };
  try {
    for (const nodeId of order) {
      const [fresh] = await db.select({ status: playbookRuns.status }).from(playbookRuns).where(eq(playbookRuns.id, initial.id));
      if (fresh?.status === 'cancelled') return 'cancelled' as const;
      const step = steps.find((s) => s.stepKey === nodeId);
      const node = def.nodes.find((n) => n.id === nodeId)!;
      if (!step) return failRun(`the node "${nodeId}" has no record in this run`);
      if (step.status === 'done') {
        nodes[nodeId] = scalarOutputs(step.outputs as Record<string, Scalar>);
        continue;
      }
      const tool = getTool(node.tool);
      const markFailed = async (message: string, log?: string) => {
        const msg = scrub(message).slice(0, 500);
        await db.update(playbookSteps).set({ status: 'failed', error: msg, output: log ? scrub(log).slice(0, OUTPUT_LIMIT) : null, finishedAt: services.clock.now() }).where(eq(playbookSteps.id, step.id));
        await db.update(playbookRuns).set({ status: 'paused', error: `${nodeId}: ${msg}`.slice(0, 500) }).where(eq(playbookRuns.id, initial.id));
        await recordAudit(db, { orgId, actor: actor.actor, userId: actor.userId }, { action: 'flow.node_failed', entityType: 'playbook_run', entityId: initial.id, summary: { node: nodeId, tool: node.tool } });
        return 'paused' as const;
      };
      if (!tool || !tool.available) return markFailed(`the tool "${node.tool}" is not available`);

      await db.update(playbookSteps).set({ status: 'running', attempts: sql`${playbookSteps.attempts} + 1`, startedAt: services.clock.now(), finishedAt: null, error: null }).where(eq(playbookSteps.id, step.id));

      // Variables go in here, according to the context of each key (shell values are quoted, secrets only where allowed).
      const scope: Scope = { params, nodes, product, secrets };
      const rendered: Record<string, unknown> = {};
      try {
        for (const [key, value] of Object.entries(node.config)) {
          if (typeof value !== 'string') {
            rendered[key] = value;
            continue;
          }
          const r = render(value, scope, { context: tool.contexts?.[key] ?? 'text', allowSecrets: (tool.secretKeys ?? []).includes(key) });
          r.usedSecrets.forEach((s) => tracked.add(s));
          rendered[key] = r.text;
        }
      } catch (e) {
        return markFailed(e instanceof TemplateError ? `a variable could not be filled in (${e.code}: ${e.ref})` : 'a variable could not be filled in');
      }
      const input = tool.schema.safeParse(rendered);
      if (!input.success) return markFailed(`the settings of this node are not valid (${issueText(input.error.issues)})`);

      const bound = (kind: 'ssh' | 'aapanel' | 'github') => {
        const slot = node.bind[kind];
        const id = slot ? bindings[slot] : undefined;
        if (!id) throw new ToolError(`the slot for ${kind} is not bound to a connection`);
        return id;
      };
      const timeoutMs = Math.max((org?.timeout ?? 300) * 1000, tool.minTimeoutMs ?? 0);
      const tctx: ToolContext = {
        ctx: actor,
        runId: initial.id,
        nodeId,
        clock: services.clock,
        timeoutMs,
        gitBase: services.gitBase,
        fetch: services.fetch,
        scope: { params, nodes },
        connectionId: (slot) => bindings[slot],
        track: (s) => tracked.add(s),
        scrub,
        async ssh() {
          const id = bound('ssh');
          if (!sessions.has(id)) sessions.set(id, await services.ssh(orgId, id));
          return sessions.get(id)!;
        },
        panel: async () => services.panel(orgId, bound('aapanel')),
        github: async () => services.github(orgId, bound('github')),
      };
      try {
        const outcome = await Promise.race([
          tool.run(tctx, input.data),
          new Promise<never>((_, rej) => setTimeout(() => rej(new ToolError(`the node took longer than ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs + 5000).unref()),
        ]);
        Object.assign(secrets, outcome.secrets ?? {});
        const outputs = scalarOutputs(outcome.outputs);
        const sealed = Object.keys(secrets).length ? encryptSecret(secrets, orgId, initial.id) : null;
        await db.transaction(async (tx) => {
          await tx.update(playbookSteps).set({ status: 'done', outputs, output: scrub(outcome.log ?? '').slice(0, OUTPUT_LIMIT), finishedAt: services.clock.now() }).where(eq(playbookSteps.id, step.id));
          if (sealed) await tx.update(playbookRuns).set({ secretsCiphertext: sealed.ciphertext, secretsKeyVersion: sealed.keyVersion }).where(eq(playbookRuns.id, initial.id));
        });
        nodes[nodeId] = outputs;
      } catch (e) {
        const message = e instanceof ToolError ? e.message : e instanceof Error && e.name === 'SshError' ? `SSH: ${e.message}` : 'the node failed unexpectedly';
        if (!(e instanceof ToolError) && !(e instanceof Error && e.name === 'SshError')) console.error('flow node', node.tool, e instanceof Error ? e.name : 'error');
        return markFailed(message, e instanceof ToolError ? e.output : undefined);
      }
    }
    await db.update(playbookRuns).set({ status: 'done', error: null, finishedAt: services.clock.now(), summary: `${order.length} node(s) done`, secretsCiphertext: null, secretsKeyVersion: null }).where(eq(playbookRuns.id, initial.id));
    await recordAudit(db, { orgId, actor: actor.actor, userId: actor.userId }, { action: 'flow.run_done', entityType: 'playbook_run', entityId: initial.id, summary: { nodes: order.length } });
    return 'done' as const;
  } finally {
    for (const s of sessions.values()) s.close();
  }
}
