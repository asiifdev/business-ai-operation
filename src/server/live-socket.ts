import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { resolveSession } from '../auth/session';
import { env } from '../lib/env';
import { metaUpstream, runLiveSession } from './live-meeting';

export const LIVE_PATH = '/api/meetings/live';
const globalForLive = globalThis as unknown as { __liveSocketServers?: WeakSet<Server> };

const reject = (socket: Duplex, status: number, text: string) => {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

/** The page and the socket must be the same site: a page on another origin cannot open a person's microphone session. */
function sameSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    const app = env('APP_URL');
    return host === req.headers.host || (app ? host === new URL(app).host : false);
  } catch {
    return false;
  }
}

/**
 * Lets the HTTP server of this process accept the live meeting socket (D-051). Astro routes cannot upgrade a connection,
 * so this listens for the `upgrade` event itself: only `LIVE_PATH`, only from our own pages, only for a signed-in person
 * (the same cookie session the rest of the app uses). Everything else is left to whoever else listens on the server.
 */
export function attachLiveSocket(server: Server): void {
  const attached = (globalForLive.__liveSocketServers ??= new WeakSet());
  if (attached.has(server)) return;
  attached.add(server);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== LIVE_PATH) return;
    if (!sameSite(req)) return reject(socket, 403, 'Forbidden');
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    void resolveSession(headers)
      .then((session) => {
        if (!session) return reject(socket, 401, 'Unauthorized');
        wss.handleUpgrade(req, socket, head, (ws) => void runLiveSession(ws, session.ctx, { openUpstream: metaUpstream() }).catch(() => ws.close(1011, 'error')));
      })
      .catch(() => reject(socket, 500, 'Server Error'));
  });
}
