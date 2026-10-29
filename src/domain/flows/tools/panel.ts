import { z } from 'zod';
import { ToolError } from './ssh';
import type { PanelCall, ToolDef } from './types';
import { dbIdentifier, domainName } from './validate';

/**
 * aaPanel tools (skill `aapanel-integration`, sections 4b and 4c: every call here was observed on a real panel, and the
 * create and delete calls were proved with throwaway `orbyte_probe_*` objects). The v2 envelope is `{status: 0, timestamp,
 * message}`; a refusal is `{status: false, msg}` with HTTP 200.
 */
type Row = Record<string, unknown>;

function unwrap(res: unknown): unknown {
  const r = res as { status?: unknown; message?: unknown; msg?: unknown };
  if (r?.status === false) throw new ToolError(`the panel refused: ${String(r.msg ?? 'no reason given').slice(0, 200)}`);
  if (r?.status !== 0 || r.message === undefined) throw new ToolError('the panel answered in a way we did not expect');
  return r.message;
}

async function rowsOf(call: PanelCall, table: 'sites' | 'databases', search: string): Promise<Row[]> {
  const m = unwrap(await call('/v2/data?action=getData', { table, p: '1', limit: '200', search, order: '', type: '-1', re_order: '' })) as { data?: unknown };
  return Array.isArray(m?.data) ? (m.data as Row[]) : [];
}

async function proxyRows(call: PanelCall, search: string): Promise<Row[]> {
  const m = unwrap(await call('/v2/mod/proxy/com/get_list', { p: '1', limit: '500', search, re_order: '' })) as { data?: { data?: unknown } };
  return Array.isArray(m?.data?.data) ? (m.data!.data as Row[]) : [];
}

const portsOf = (target: unknown) => [...String(target ?? '').matchAll(/:(\d{2,5})(?:\/|$)/g)].map((m) => Number(m[1]));
const empty = z.object({});
const createDb = z.object({ name: dbIdentifier, user: dbIdentifier.optional(), password: z.string().min(12).max(128), note: z.string().max(100).default('') });
const createProxy = z.object({
  domain: domainName,
  target: z.string().regex(/^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{2,5})?(\/[A-Za-z0-9._~/-]*)?$/),
  remark: z.string().max(100).default(''),
});
const del = z.object({ from: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) });

/** The object a delete tool may remove: only what the named create node made in THIS run (BR-M17-25). */
function createdBy(scope: Record<string, Record<string, unknown>>, from: string): { id: string; name: string } {
  const out = scope[from];
  if (!out || !out.id || !out.name) throw new ToolError(`the node "${from}" has not created anything in this run`);
  return { id: String(out.id), name: String(out.name) };
}

const needs = ['aapanel'] as const;

export const panelTools: ToolDef[] = [
  {
    id: 'panel.list_sites',
    needs,
    tier: 'read',
    available: true,
    outputs: ['count', 'names'],
    schema: empty,
    async run(t) {
      const rows = await rowsOf(await t.panel(), 'sites', '');
      return { outputs: { count: rows.length, names: rows.map((r) => String(r.name)).join(',') }, log: `${rows.length} site(s)` };
    },
  },
  {
    id: 'panel.list_databases',
    needs,
    tier: 'read',
    available: true,
    outputs: ['count', 'names'],
    schema: empty,
    async run(t) {
      const rows = await rowsOf(await t.panel(), 'databases', '');
      return { outputs: { count: rows.length, names: rows.map((r) => String(r.name)).join(',') }, log: `${rows.length} database(s)` };
    },
  },
  {
    id: 'panel.list_proxies',
    needs,
    tier: 'read',
    available: true,
    outputs: ['count', 'ports'],
    schema: empty,
    async run(t) {
      const rows = await proxyRows(await t.panel(), '');
      const ports = [...new Set(rows.flatMap((r) => portsOf(r.proxy_pass)))].sort((a, b) => a - b);
      return { outputs: { count: rows.length, ports: ports.join(',') }, log: `${rows.length} reverse prox(ies), ${ports.length} port(s) targeted` };
    },
  },
  {
    id: 'panel.create_database',
    needs,
    tier: 'change',
    available: true,
    creates: 'database',
    outputs: ['id', 'name'],
    secretKeys: ['password'],
    schema: createDb,
    async run(t, input: z.infer<typeof createDb>) {
      const call = await t.panel();
      if ((await rowsOf(call, 'databases', input.name)).some((r) => r.name === input.name)) throw new ToolError(`the database "${input.name}" already exists`);
      t.track(input.password);
      const user = input.user ?? input.name;
      unwrap(await call('/v2/database?action=AddDatabase', { sid: '0', name: input.name, codeing: 'utf8mb4', db_user: user, password: input.password, dataAccess: '127.0.0.1', address: '127.0.0.1', active: 'false', ssl: '', ps: input.note || `orbyte:${t.runId}`, dtype: 'MySQL' }));
      const made = (await rowsOf(call, 'databases', input.name)).filter((r) => r.name === input.name);
      if (made.length !== 1) throw new ToolError('the database was created but could not be found afterwards');
      return { outputs: { id: String(made[0].id), name: input.name }, log: `created database ${input.name}` };
    },
  },
  {
    id: 'panel.create_proxy',
    needs,
    tier: 'change',
    available: true,
    creates: 'proxy',
    outputs: ['id', 'name'],
    schema: createProxy,
    async run(t, input: z.infer<typeof createProxy>) {
      const call = await t.panel();
      if ((await proxyRows(call, input.domain)).some((r) => r.name === input.domain)) throw new ToolError(`a reverse proxy for "${input.domain}" already exists`);
      unwrap(await call('/v2/mod/proxy/com/create', { domains: input.domain, proxy_type: 'true', url: input.target, unx: '', proxy_host: '$http_host', remark: input.remark || `orbyte:${t.runId}`, keepuri: '1', 'rewrite[0][key]': '', 'rewrite[0][value]': '', proxy_pass: input.target, rewritedir: '[]' }));
      const made = (await proxyRows(call, input.domain)).filter((r) => r.name === input.domain);
      if (made.length !== 1) throw new ToolError('the reverse proxy was created but could not be found afterwards');
      return { outputs: { id: String(made[0].id), name: input.domain }, log: `created reverse proxy ${input.domain} to ${input.target}` };
    },
  },
  {
    id: 'panel.create_site',
    needs,
    tier: 'change',
    available: false, // `AddSite` was not proved on a real panel yet (skill section 4c): a flow cannot use it until it was
    outputs: ['id', 'name'],
    schema: empty,
    async run() {
      throw new ToolError('creating a PHP site through the panel is not available yet');
    },
  },
  {
    id: 'panel.delete_database',
    needs,
    tier: 'change',
    available: true,
    deletes: { kind: 'database', key: 'from' },
    outputs: [],
    schema: del,
    async run(t, input: z.infer<typeof del>) {
      const call = await t.panel();
      const mine = createdBy(t.scope.nodes, input.from);
      unwrap(await call('/v2/database?action=DeleteDatabase', { name: mine.name, id: mine.id }));
      if ((await rowsOf(call, 'databases', mine.name)).some((r) => r.name === mine.name)) throw new ToolError('the database is still there after the delete');
      return { log: `deleted database ${mine.name}` };
    },
  },
  {
    id: 'panel.delete_proxy',
    needs,
    tier: 'change',
    available: true,
    deletes: { kind: 'proxy', key: 'from' },
    outputs: [],
    schema: del,
    async run(t, input: z.infer<typeof del>) {
      const call = await t.panel();
      const mine = createdBy(t.scope.nodes, input.from);
      unwrap(await call('/v2/mod/proxy/com/delete', { id: mine.id, site_name: mine.name, remove_path: '0' }));
      if ((await proxyRows(call, mine.name)).some((r) => r.name === mine.name)) throw new ToolError('the reverse proxy is still there after the delete');
      return { log: `deleted reverse proxy ${mine.name}` };
    },
  },
];
