import { describe, expect, it } from 'vitest';
import { COLUMN_STEP, columnsPerRow, DEFAULT_PER_ROW, isLegacyGrid, layoutSteps, ROW_GAP, ROW_STEP, runsLeft } from '../layout';
import { getTemplate } from '../templates';

const line = (ids: string[]) => ids.slice(1).map((to, i) => ({ from: ids[i], to }));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);

describe('flow layout', () => {
  it('puts a short chain in one row, each step one column to the right of the one before', () => {
    const at = layoutSteps(['a', 'b', 'c', 'd'], line(['a', 'b', 'c', 'd']));
    expect([...at.values()].map((p) => p.y)).toEqual([0, 0, 0, 0]);
    expect([...at.values()].map((p) => p.x)).toEqual([0, COLUMN_STEP, 2 * COLUMN_STEP, 3 * COLUMN_STEP]);
  });

  it('wraps a long chain like a snake: left to right, down at the end, right to left, down, left to right', () => {
    const all = ids(7);
    const at = layoutSteps(all, line(all), 3);
    const rowTwo = ROW_STEP + ROW_GAP;
    expect(all.map((id) => at.get(id))).toEqual([
      { x: 0, y: 0 }, { x: COLUMN_STEP, y: 0 }, { x: 2 * COLUMN_STEP, y: 0 },
      { x: 2 * COLUMN_STEP, y: rowTwo }, { x: COLUMN_STEP, y: rowTwo }, { x: 0, y: rowTwo },
      { x: 0, y: 2 * rowTwo },
    ]);
  });

  it('never draws a line that runs back across the picture: a line goes one column along its row, or straight down', () => {
    const all = ids(26);
    const at = layoutSteps(all, line(all));
    for (const e of line(all)) {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      const along = Math.abs(b.x - a.x) === COLUMN_STEP && b.y === a.y;
      const down = b.x === a.x && b.y > a.y;
      expect(along || down, `${e.from}->${e.to}`).toBe(true);
    }
    // twenty-six steps are a few rows, not one strip of 26 columns
    expect(Math.max(...[...at.values()].map((p) => p.x))).toBe((DEFAULT_PER_ROW - 1) * COLUMN_STEP);
  });

  it('stacks steps that do not wait for each other in one column, and puts a step after everything it waits for', () => {
    const at = layoutSteps(['start', 'top', 'bottom', 'end'], [{ from: 'start', to: 'top' }, { from: 'start', to: 'bottom' }, { from: 'top', to: 'end' }, { from: 'bottom', to: 'end' }]);
    expect(at.get('top')!.x).toBe(at.get('bottom')!.x);
    expect(at.get('bottom')!.y - at.get('top')!.y).toBe(ROW_STEP);
    expect(at.get('end')!.x).toBe(2 * COLUMN_STEP);
    expect(at.get('start')!.y).toBe(ROW_STEP / 2);
    expect(at.get('end')!.y).toBe(at.get('start')!.y);
  });

  it('keeps every position non-negative, uses the longest chain for a late dependency, and ignores lines to unknown steps', () => {
    const at = layoutSteps(['a', 'b', 'c'], [...line(['a', 'b', 'c']), { from: 'a', to: 'c' }, { from: 'ghost', to: 'b' }]);
    expect(at.get('c')!.x).toBe(2 * COLUMN_STEP);
    for (const p of at.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not hang on a loop while the person is still fixing it', () => {
    expect(layoutSteps(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]).size).toBe(2);
  });

  it('fits more columns to a wider canvas, never fewer than three or more than eight', () => {
    expect(columnsPerRow(500)).toBe(3);
    expect(columnsPerRow(1250)).toBe(4);
    expect(columnsPerRow(1800)).toBe(6);
    expect(columnsPerRow(6000)).toBe(8);
  });

  it('faces a step left exactly in the rows that run right to left', () => {
    const all = ids(7);
    const edges = line(all);
    const at = layoutSteps(all, edges, 3);
    expect(all.map((id) => runsLeft(id, at, edges))).toEqual([false, false, false, true, true, true, false]);
  });

  it('draws both built-in templates as a snake, every line along a row or straight down', () => {
    for (const key of ['laravel-pm2-setup', 'laravel-pm2-update']) {
      const def = getTemplate(key)!.build();
      const at = new Map(def.nodes.map((n) => [n.id, n.position]));
      expect(isLegacyGrid(def.nodes, def.edges), key).toBe(false);
      for (const e of def.edges) {
        const a = at.get(e.from)!;
        const b = at.get(e.to)!;
        expect((Math.abs(b.x - a.x) === COLUMN_STEP && b.y === a.y) || (b.x === a.x && b.y > a.y), `${key}: ${e.from}->${e.to}`).toBe(true);
      }
    }
  });

  it('recognises the old four-column grid by the line that jumps back, and leaves the snake and a plain row alone', () => {
    const grid = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 150 } }));
    expect(isLegacyGrid(grid, line(['a', 'b', 'c', 'd', 'e']))).toBe(true);
    const all = ids(26);
    const at = layoutSteps(all, line(all));
    expect(isLegacyGrid(all.map((id) => ({ id, position: at.get(id)! })), line(all))).toBe(false);
    // a flow of four steps or fewer was a single row in the old grid too, and is already fine
    expect(isLegacyGrid(grid.slice(0, 4), line(['a', 'b', 'c', 'd']))).toBe(false);
  });
});
