import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

export const prerender = false;

/** Liveness plus database check for the process manager and uptime monitors. No data is returned. */
export const GET: APIRoute = async () => {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
};
