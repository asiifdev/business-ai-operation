import type { APIRoute } from 'astro';
import { auth } from '../../../auth/auth';

export const prerender = false;

// Better Auth serves sign-in, sign-out and session endpoints here. Server-side calls bypass its rate limiter,
// but this HTTP route is covered by the limiter configured in src/auth/auth.ts.
export const ALL: APIRoute = ({ request }) => auth.handler(request);
