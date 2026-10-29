import { describe, expect, it } from 'vitest';
import { definitionSchema, hasCommandNode, planHash, topologicalOrder, validateDefinition, type Definition } from '../definition';

const base = (over: Partial<Definition> = {}): Definition =>
  definitionSchema.parse({
    slots: [{ name: 'server', kind: 'ssh' }, { name: 'panel', kind: 'aapanel' }, { name: 'gh', kind: 'github' }],
    params: [{ name: 'slug' }, { name: 'domain' }],
    nodes: [
      { id: 'check', tool: 'ssh.check_tools', bind: { ssh: 'server' }, config: {} },
      { id: 'pw', tool: 'orbyte.generate_secret', config: { name: 'db_password', length: 24 } },
      { id: 'db', tool: 'panel.create_database', bind: { aapanel: 'panel' }, config: { name: '{{params.slug}}', password: '{{secrets.db_password}}' } },
      { id: 'clone', tool: 'ssh.git_clone', bind: { ssh: 'server', github: 'gh' }, config: { repo: '{{product.repo}}', branch: 'main', dir: '/www/wwwroot/{{params.domain}}' } },
    ],
    edges: [{ from: 'check', to: 'pw' }, { from: 'pw', to: 'db' }, { from: 'db', to: 'clone' }],
    ...over,
  });
const codes = (d: Definition, canUseCommand = false) => validateDefinition(d, { canUseCommand }).problems.map((p) => p.code);

describe('flow definition', () => {
  it('accepts a sound diagram and orders it', () => {
    const r = validateDefinition(base(), { canUseCommand: false });
    expect(r.problems).toEqual([]);
    expect(r.order).toEqual(['check', 'pw', 'db', 'clone']);
  });

  it('keeps the listed order between nodes that do not depend on each other', () => {
    const d = base({ edges: [] });
    expect(topologicalOrder(d)).toEqual(['check', 'pw', 'db', 'clone']);
    expect(topologicalOrder({ ...d, edges: [{ from: 'clone', to: 'check' }] })).toEqual(['pw', 'db', 'clone', 'check']);
  });

  it('refuses cycles, duplicates, loose edges and self edges', () => {
    expect(codes(base({ edges: [{ from: 'check', to: 'pw' }, { from: 'pw', to: 'check' }] }))).toContain('cycle');
    const dup = base();
    dup.nodes.push({ ...dup.nodes[0] });
    expect(codes(dup)).toContain('duplicate_node');
    expect(codes(base({ edges: [{ from: 'check', to: 'nowhere' }] }))).toContain('edge_unknown');
    expect(codes(base({ edges: [{ from: 'check', to: 'check' }] }))).toContain('edge_self');
  });

  it('refuses an unknown tool and one that is not proved yet', () => {
    const d = base();
    d.nodes.push({ id: 'x', tool: 'ssh.rm_rf', position: { x: 0, y: 0 }, bind: {}, config: {} });
    d.nodes.push({ id: 'site', tool: 'panel.create_site', position: { x: 0, y: 0 }, bind: { aapanel: 'panel' }, config: {} });
    expect(codes(d)).toEqual(expect.arrayContaining(['unknown_tool', 'tool_unavailable']));
  });

  it('checks that every node is bound to a slot of the right kind', () => {
    const d = base();
    d.nodes[0].bind = {};
    d.nodes[3].bind = { ssh: 'panel', github: 'gh' }; // panel is an aaPanel slot
    d.nodes[2].bind = { aapanel: 'ghost' };
    expect(codes(d)).toEqual(expect.arrayContaining(['slot_missing', 'slot_kind', 'slot_unknown']));
  });

  it('only a flow written by the Owner may hold a free command node (BR-M17-18)', () => {
    const d = base();
    d.nodes.push({ id: 'cmd', tool: 'ssh.run_command', position: { x: 0, y: 0 }, bind: { ssh: 'server' }, config: { script: 'echo {{params.slug}}' } });
    d.edges.push({ from: 'clone', to: 'cmd' });
    expect(hasCommandNode(d)).toBe(true);
    expect(codes(d, false)).toContain('command_not_allowed');
    expect(codes(d, true)).not.toContain('command_not_allowed');
    expect(hasCommandNode(base())).toBe(false);
  });

  it('variables must come from somewhere that exists and runs earlier', () => {
    const d = base();
    d.nodes[3].config.branch = '{{params.nope}}';
    d.nodes[2].config.name = '{{nodes.clone.commit}}'; // clone runs AFTER db
    d.nodes[0].config.require = '{{nodes.pw.ghost}}'; // not an output of that tool
    d.nodes[1].config.length = '{{product.password}}'; // not a product field
    const found = validateDefinition(d, { canUseCommand: false }).problems.filter((p) => p.code === 'ref_unknown').map((p) => p.detail);
    expect(found).toEqual(expect.arrayContaining(['params.nope', 'nodes.clone.commit', 'nodes.pw.ghost', 'product.password']));
  });

  it('a secret may only go where the tool allows it, and only after a node made it', () => {
    const d = base();
    d.nodes[3].config.branch = '{{secrets.db_password}}'; // git_clone does not take secrets
    expect(codes(d)).toContain('secret_not_allowed');
    const e = base({ edges: [{ from: 'db', to: 'clone' }] }); // `pw` no longer runs before `db`
    expect(validateDefinition(e, { canUseCommand: false }).problems.map((p) => p.detail)).toContain('secrets.db_password');
  });

  it('a delete node may only name an earlier node that created that kind of object (BR-M17-25)', () => {
    const ok = base();
    ok.nodes.push({ id: 'undo', tool: 'panel.delete_database', position: { x: 0, y: 0 }, bind: { aapanel: 'panel' }, config: { from: 'db' } });
    ok.edges.push({ from: 'clone', to: 'undo' });
    expect(codes(ok)).not.toContain('delete_target');
    for (const from of ['clone', 'ghost', 'pw']) {
      const bad = base();
      bad.nodes.push({ id: 'undo', tool: 'panel.delete_database', position: { x: 0, y: 0 }, bind: { aapanel: 'panel' }, config: { from } });
      bad.edges.push({ from: 'clone', to: 'undo' });
      expect(codes(bad)).toContain('delete_target');
    }
    const early = base();
    early.nodes.push({ id: 'undo', tool: 'panel.delete_database', position: { x: 0, y: 0 }, bind: { aapanel: 'panel' }, config: { from: 'db' } }); // no edge: not "earlier"
    expect(codes(early)).toContain('delete_target');
  });

  it('the plan hash follows what runs, not how it is written', () => {
    const d = base();
    const order = ['check', 'pw', 'db', 'clone'];
    const h = planHash(d, order, { slug: 'a', domain: 'b.example.com' }, { server: 's1' });
    expect(planHash(d, order, { domain: 'b.example.com', slug: 'a' }, { server: 's1' })).toBe(h); // key order does not matter
    expect(planHash(d, order, { slug: 'a2', domain: 'b.example.com' }, { server: 's1' })).not.toBe(h);
    expect(planHash(d, order, { slug: 'a', domain: 'b.example.com' }, { server: 's2' })).not.toBe(h);
    const changed = base();
    changed.nodes[3].config.branch = 'other';
    expect(planHash(changed, order, { slug: 'a', domain: 'b.example.com' }, { server: 's1' })).not.toBe(h);
    const moved = base();
    moved.nodes[3].position = { x: 999, y: 999 }; // moving a box on the canvas changes nothing that runs
    expect(planHash(moved, order, { slug: 'a', domain: 'b.example.com' }, { server: 's1' })).toBe(h);
  });

  it('the schema bounds the size and the names', () => {
    expect(definitionSchema.parse({ nodes: [] }).nodes).toEqual([]); // a blank draft may be saved; planning a run refuses it
    expect(() => definitionSchema.parse({ nodes: [{ id: 'Bad Id', tool: 'x' }] })).toThrow();
    expect(() => definitionSchema.parse({ nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, tool: 'x' })) })).toThrow();
  });
});
