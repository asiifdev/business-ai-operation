/**
 * `pnpm start`: the built Astro server plus the live meeting socket (D-051). Astro routes cannot upgrade a connection to a
 * WebSocket, so the built entry is started here instead of on its own and the socket is attached to the same HTTP server:
 * same port, same cookie session, nothing else to run or to route.
 */
export {};
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { startServer } = await import('../dist/server/entry.mjs');
const { attachLiveSocket } = await import('../src/server/live-socket');
const running = startServer();
attachLiveSocket(running.server.server);
running.done.catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
