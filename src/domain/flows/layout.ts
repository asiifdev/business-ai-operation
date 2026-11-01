/**
 * Where the steps of a flow sit on the diagram. A flow reads left to right, the order it runs in, the way an n8n
 * workflow does: one step after the other, and steps that do not wait for each other stacked in the same column. Pure
 * arithmetic with no screen in it, so the editor, the run view and the built-in templates draw the same picture and a
 * test can pin it down.
 */
export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 72;
/** Distance between two columns: the card plus room for the line and the "+" that sits on it. */
export const COLUMN_STEP = 312;
export const ROW_STEP = 112;

export interface Point {
  x: number;
  y: number;
}
interface Edge {
  from: string;
  to: string;
}

/** Columns per row when nothing says otherwise: about what fits a laptop window at a size that can be read. */
export const DEFAULT_PER_ROW = 4;
/** Empty space between two rows, so the line that turns down at the end of a row has room. */
export const ROW_GAP = 40;

/**
 * How many columns fit a canvas of this width at a readable size (not below 0.8 zoom), so a long flow wraps instead of
 * running off to the right and needing a long scroll.
 */
export function columnsPerRow(canvasWidth: number): number {
  return Math.max(3, Math.min(8, Math.floor((canvasWidth - 96) / (COLUMN_STEP * 0.8))));
}

/**
 * Column of each step = the longest chain of steps before it, so a step always sits after everything it waits for.
 * Steps in one column keep the order they were written in and are centred around the same middle line.
 *
 * A long flow wraps like a snake: the first `perRow` columns run left to right, the line turns down at the end, the next
 * `perRow` run right to left, and so on. So no line ever runs back across the picture, and a flow of twenty-six steps
 * is a few rows, not one very long strip. Every position is non-negative.
 */
export function layoutSteps(ids: readonly string[], edges: readonly Edge[], perRow: number = DEFAULT_PER_ROW): Map<string, Point> {
  const known = new Set(ids);
  const before = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (known.has(e.from) && known.has(e.to) && e.from !== e.to) before.get(e.to)!.push(e.from);

  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const columnOf = (id: string): number => {
    const cached = column.get(id);
    if (cached !== undefined) return cached;
    // A loop is not a valid flow (the server refuses it); do not hang the screen on one while the person fixes it.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value = before.get(id)!.reduce((furthest, parent) => Math.max(furthest, columnOf(parent) + 1), 0);
    visiting.delete(id);
    column.set(id, value);
    return value;
  };
  for (const id of ids) columnOf(id);

  const columns = new Map<number, string[]>();
  for (const id of ids) columns.set(column.get(id)!, [...(columns.get(column.get(id)!) ?? []), id]);
  const width = Math.max(1, Math.floor(perRow));
  const last = Math.max(0, ...columns.keys());

  // The tallest column of each row decides how much room the row takes.
  const bandHeight = new Map<number, number>();
  for (const [c, members] of columns) {
    const band = Math.floor(c / width);
    bandHeight.set(band, Math.max(bandHeight.get(band) ?? 0, members.length * ROW_STEP));
  }
  const bandTop = new Map<number, number>();
  let top = 0;
  for (let band = 0; band <= Math.floor(last / width); band++) {
    bandTop.set(band, top);
    top += (bandHeight.get(band) ?? ROW_STEP) + ROW_GAP;
  }

  const out = new Map<string, Point>();
  for (const [c, members] of columns) {
    const band = Math.floor(c / width);
    const slot = c % width;
    const across = band % 2 === 0 ? slot : width - 1 - slot;
    const offset = ((bandHeight.get(band)! - members.length * ROW_STEP) / 2);
    members.forEach((id, i) => out.set(id, { x: across * COLUMN_STEP, y: bandTop.get(band)! + offset + i * ROW_STEP }));
  }
  return out;
}

/**
 * Flows drawn before this layout were laid out in a grid that wrapped every fourth step, so one line ran back across the
 * whole picture. A line that jumps back more than a column and a half is of that kind (the snake never does that: its
 * lines go one column along a row or straight down) and the flow is redrawn when it is opened. Nothing is saved until
 * the person saves.
 */
export function isLegacyGrid(nodes: ReadonlyArray<{ id: string; position: Point }>, edges: readonly Edge[]): boolean {
  const at = new Map(nodes.map((n) => [n.id, n.position]));
  return edges.some((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    return !!a && !!b && a.x - b.x > COLUMN_STEP * 1.5;
  });
}

/**
 * Which way a step faces: in a row that runs right to left its line comes in on the right and goes out on the left.
 * Worked out from where its neighbours are, so it needs nothing stored.
 */
export function runsLeft(id: string, at: ReadonlyMap<string, Point>, edges: readonly Edge[]): boolean {
  const me = at.get(id);
  if (!me) return false;
  return edges.some((e) => (e.to === id && (at.get(e.from)?.x ?? me.x) > me.x) || (e.from === id && (at.get(e.to)?.x ?? me.x) < me.x));
}
