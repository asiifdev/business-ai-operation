import type { APIRoute } from 'astro';
import { handleGithubWebhook } from '../../../domain/connections/github-webhook';
import { verifyWebhookSignature } from '../../../integrations/github/webhook';
import { env } from '../../../lib/env';

export const prerender = false;

const json = (status: number, body: Record<string, unknown> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * `POST /api/github/webhook`: the App's single webhook URL (D-058). No session: the signature is the credential. The
 * answer is quick (GitHub gives 10 seconds); a bad signature gets 401 and no detail.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env('GITHUB_WEBHOOK_SECRET');
  if (!secret) return json(503);
  const raw = await request.text(); // the exact bytes, before any parsing
  if (!verifyWebhookSignature(raw, request.headers.get('x-hub-signature-256'), secret)) return json(401);
  const event = request.headers.get('x-github-event') ?? '';
  const delivery = request.headers.get('x-github-delivery') ?? '';
  if (!event || !/^[0-9a-f-]{8,64}$/i.test(delivery)) return json(400);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400);
  }
  try {
    return json(200, { result: await handleGithubWebhook(event, delivery, payload) });
  } catch (error) {
    console.error('github webhook', error instanceof Error ? error.name : 'error');
    return json(500); // GitHub shows the failure and the delivery can be redelivered
  }
};
