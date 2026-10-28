// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Config is evaluated before Astro loads .env, so read it here (real environment variables win).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file: rely on the real environment */
}

// The public address of the app (e.g. https://app.example.com). Used to trust the reverse proxy's
// X-Forwarded-Host/Proto, so POSTs pass Astro's Origin check, and to allow the host in the dev/preview server.
const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : undefined;
const hostAllowList = appUrl ? [appUrl.hostname] : undefined;

// The live meeting socket (D-051). In production `scripts/start.ts` attaches it; in dev the Vite server is the HTTP server.
/** @type {import('astro').AstroIntegration} */
const liveSocket = {
  name: 'live-meeting-socket',
  hooks: {
    'astro:server:setup': async ({ server }) => {
      const { attachLiveSocket } = await server.ssrLoadModule('/src/server/live-socket.ts');
      if (server.httpServer) attachLiveSocket(server.httpServer);
    }
  }
};

// https://astro.build/config
export default defineConfig({
  adapter: node({
    mode: 'standalone'
  }),

  integrations: [react(), liveSocket],

  // The floating dev toolbar sits over the phone tab bar and hides it while testing the app layout.
  devToolbar: { enabled: false },

  security: appUrl
    ? {
        allowedDomains: [
          {
            hostname: appUrl.hostname,
            protocol: appUrl.protocol.replace(':', ''),
            ...(appUrl.port ? { port: appUrl.port } : {})
          }
        ]
      }
    : undefined,

  vite: {
    plugins: [tailwindcss()],
    // One React instance only: two copies break hooks ("Invalid hook call") when Vite re-optimizes dependencies in dev.
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { allowedHosts: hostAllowList },
    preview: { allowedHosts: hostAllowList }
  }
});
