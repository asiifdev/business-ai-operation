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

// https://astro.build/config
export default defineConfig({
  adapter: node({
    mode: 'standalone'
  }),

  integrations: [react()],

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
