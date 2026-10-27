/** Normalises Postgres errors; Drizzle wraps them as "Failed query" with the real error on `cause`. */
export interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

export function pgError(err: unknown): PgError {
  const e = err as { code?: string; constraint_name?: string; message?: string; cause?: { code?: string; constraint_name?: string; message?: string } };
  const src = e?.cause ?? e;
  return { code: src?.code, constraint: src?.constraint_name, message: src?.message ?? e?.message ?? String(err) };
}

export const isUniqueViolation = (err: unknown, constraint?: string) => {
  const p = pgError(err);
  return p.code === '23505' && (constraint === undefined || p.constraint === constraint);
};
