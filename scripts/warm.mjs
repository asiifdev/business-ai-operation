// Preloaded by `pnpm start`. The scheduler starts with the first real request (it must not start during the build), so a
// server that was just restarted would wait for a visitor. This makes one request to /api/health a few seconds after
// startup, which starts it. It changes nothing else and ignores failure.
const port = process.env.PORT ?? '4321';
setTimeout(() => {
  fetch(`http://127.0.0.1:${port}/api/health`).catch(() => {});
}, 3000).unref();
