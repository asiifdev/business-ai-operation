/** All domain code reads time through a Clock so tests can move it (D-024). Never call `new Date()` in services. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock & { set(next: Date | string): void } {
  let current = new Date(at);
  return { now: () => new Date(current), set: (next) => { current = new Date(next); } };
}
