import { definitionSchema, type Definition } from './definition';

/**
 * Built-in templates (D-061): flows written in code that a person copies into their own organization and then edits like any
 * other. There is no ready-made data in the database (D-059): choosing "use template" creates the organization's own flow.
 */
export interface FlowTemplate {
  key: string;
  name: string;
  description: string;
  kind: 'setup' | 'update';
  build(): Definition;
}

type N = { id: string; tool: string; bind?: Record<string, string>; config?: Record<string, string | number | boolean>; label?: string };

function chain(nodes: N[], extraEdges: Array<[string, string]> = []): Pick<Definition, 'nodes' | 'edges'> {
  return {
    nodes: nodes.map((n, i) => ({ id: n.id, tool: n.tool, label: n.label, position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 150 }, bind: (n.bind ?? {}) as Definition['nodes'][number]['bind'], config: n.config ?? {} })),
    edges: [...nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id })), ...extraEdges.map(([from, to]) => ({ from, to }))],
  };
}

const ENV = [
  'APP_NAME={{params.slug}}',
  'APP_ENV=production',
  'APP_DEBUG=false',
  'APP_URL=https://{{params.domain}}',
  'DB_CONNECTION=mysql',
  'DB_HOST=127.0.0.1',
  'DB_PORT=3306',
  'DB_DATABASE={{params.db_name}}',
  'DB_USERNAME={{params.db_name}}',
  'DB_PASSWORD={{secrets.db_password}}',
  'SESSION_DOMAIN={{params.domain}}',
  'BROADCAST_CONNECTION=reverb',
  'REVERB_APP_ID={{params.slug}}',
  'REVERB_APP_KEY={{secrets.reverb_key}}',
  'REVERB_APP_SECRET={{secrets.reverb_secret}}',
  'REVERB_HOST=ws-{{params.domain}}',
  'REVERB_PORT=443',
  'REVERB_SCHEME=https',
  'REVERB_SERVER_PORT={{nodes.port.port}}',
  'PM2_APP_NAME={{params.slug}}',
].join('\n');

const server = { ssh: 'server' };
const withGit = { ssh: 'server', github: 'github' };
const dir = '{{params.folder_root}}/{{params.domain}}';

/** A Laravel application kept alive with pm2 (Reverb, queue and scheduler from `ecosystem.config.cjs`), as Invly runs. */
const laravelPm2Setup: FlowTemplate = {
  key: 'laravel-pm2-setup',
  name: 'Laravel + pm2: klien baru',
  description: 'Setup klien baru: cek server, alokasi port Reverb, database, clone, .env, composer, npm, migrasi, build, proxy WebSocket, pm2, dan catat deployment. Situs PHP di aaPanel dibuat manual sebelum langkah cek situs, karena pembuatannya otomatis belum tersedia.',
  kind: 'setup',
  build: () =>
    definitionSchema.parse({
      slots: [{ name: 'server', kind: 'ssh', label: 'Server (SSH)' }, { name: 'panel', kind: 'aapanel', label: 'Panel (aaPanel)' }, { name: 'github', kind: 'github', label: 'GitHub' }],
      params: [
        { name: 'client_id', label: 'Klien', pattern: 'free' },
        { name: 'product_id', label: 'Produk', pattern: 'free' },
        { name: 'slug', label: 'Slug klien', pattern: 'slug' },
        { name: 'domain', label: 'Domain', pattern: 'domain' },
        { name: 'branch', label: 'Branch', pattern: 'branch' },
        { name: 'db_name', label: 'Nama database', pattern: 'identifier' },
        { name: 'folder_root', label: 'Folder induk', pattern: 'path', default: '/www/wwwroot' },
        { name: 'reverb_from', label: 'Port Reverb dari', type: 'number', default: 6000 },
        { name: 'reverb_to', label: 'Port Reverb sampai', type: 'number', default: 6999 },
      ],
      ...chain([
        { id: 'check', tool: 'ssh.check_tools', bind: server, config: { require: 'php,composer,node,npm,pm2,git' }, label: 'Cek server' },
        { id: 'ports_srv', tool: 'ssh.list_ports', bind: server, config: { from: '{{params.reverb_from}}', to: '{{params.reverb_to}}' }, label: 'Port terpakai di server' },
        { id: 'ports_panel', tool: 'panel.list_proxies', bind: { aapanel: 'panel' }, label: 'Port terpakai di proxy' },
        { id: 'port', tool: 'orbyte.allocate_port', config: { from: '{{params.reverb_from}}', to: '{{params.reverb_to}}', used: '{{nodes.ports_srv.ports}},{{nodes.ports_panel.ports}}' }, label: 'Alokasi port Reverb' },
        { id: 'db_pw', tool: 'orbyte.generate_secret', config: { name: 'db_password', length: 24, alphabet: 'alnum' }, label: 'Kata sandi database' },
        { id: 'rv_key', tool: 'orbyte.generate_secret', config: { name: 'reverb_key', length: 32, alphabet: 'hex' }, label: 'Kunci Reverb' },
        { id: 'rv_secret', tool: 'orbyte.generate_secret', config: { name: 'reverb_secret', length: 48, alphabet: 'hex' }, label: 'Rahasia Reverb' },
        { id: 'db', tool: 'panel.create_database', bind: { aapanel: 'panel' }, config: { name: '{{params.db_name}}', password: '{{secrets.db_password}}' }, label: 'Buat database' },
        { id: 'clone', tool: 'ssh.git_clone', bind: withGit, config: { repo: '{{product.repo}}', branch: '{{params.branch}}', dir }, label: 'Clone branch' },
        { id: 'env', tool: 'ssh.env_set', bind: server, config: { dir, entries: ENV, from_example: true }, label: 'Tulis .env' },
        { id: 'composer', tool: 'ssh.composer_install', bind: server, config: { dir }, label: 'composer install' },
        { id: 'npm_ci', tool: 'ssh.npm', bind: server, config: { dir, script: 'ci' }, label: 'npm ci' },
        { id: 'prepare', tool: 'ssh.prepare_folders', bind: server, config: { dir, create: 'storage/backups,storage/app/public/qr-codes', writable: 'storage,bootstrap/cache' }, label: 'Siapkan folder' },
        { id: 'key', tool: 'ssh.artisan', bind: server, config: { dir, command: 'key_generate' }, label: 'key:generate' },
        { id: 'link', tool: 'ssh.artisan', bind: server, config: { dir, command: 'storage_link' }, label: 'storage:link' },
        { id: 'migrate', tool: 'ssh.artisan', bind: server, config: { dir, command: 'migrate' }, label: 'migrate' },
        { id: 'build', tool: 'ssh.npm', bind: server, config: { dir, script: 'build' }, label: 'npm run build' },
        { id: 'cache_config', tool: 'ssh.artisan', bind: server, config: { dir, command: 'config_cache' }, label: 'config:cache' },
        { id: 'cache_route', tool: 'ssh.artisan', bind: server, config: { dir, command: 'route_cache' }, label: 'route:cache' },
        { id: 'cache_view', tool: 'ssh.artisan', bind: server, config: { dir, command: 'view_cache' }, label: 'view:cache' },
        { id: 'cache_event', tool: 'ssh.artisan', bind: server, config: { dir, command: 'event_cache' }, label: 'event:cache' },
        { id: 'proxy', tool: 'panel.create_proxy', bind: { aapanel: 'panel' }, config: { domain: 'ws-{{params.domain}}', target: 'http://127.0.0.1:{{nodes.port.port}}' }, label: 'Proxy WebSocket' },
        { id: 'pm2', tool: 'ssh.pm2', bind: server, config: { dir, action: 'start' }, label: 'pm2 start' },
        { id: 'pm2_save', tool: 'ssh.pm2', bind: server, config: { dir, action: 'save' }, label: 'pm2 save' },
        { id: 'record', tool: 'orbyte.record_deployment', config: { client_id: '{{params.client_id}}', product_id: '{{params.product_id}}', domain: '{{params.domain}}', repo: '{{product.repo}}', branch: '{{params.branch}}', app_path: dir, app_port: '{{nodes.port.port}}', commit: '{{nodes.clone.commit}}', server_slot: 'server' }, label: 'Catat deployment' },
        { id: 'web_check', tool: 'orbyte.http_check', config: { url: 'https://{{params.domain}}', expect: '200,301,302', tries: 6, delay_seconds: 10 }, label: 'Cek situs menjawab' },
      ]),
    }),
};

/** Updating a Laravel + pm2 client to the tip of its branch, in maintenance mode while the database changes. */
const laravelPm2Update: FlowTemplate = {
  key: 'laravel-pm2-update',
  name: 'Laravel + pm2: perbarui kode',
  description: 'Perbarui klien ke commit terbaru branch-nya: mode pemeliharaan, fetch dan merge fast-forward (ditolak bila ada perubahan lokal), composer, npm, migrasi, build, cache, lalu pm2 reload.',
  kind: 'update',
  build: () =>
    definitionSchema.parse({
      slots: [{ name: 'server', kind: 'ssh', label: 'Server (SSH)' }, { name: 'github', kind: 'github', label: 'GitHub' }],
      params: [
        { name: 'domain', label: 'Domain', pattern: 'domain' },
        { name: 'branch', label: 'Branch', pattern: 'branch' },
        { name: 'folder_root', label: 'Folder induk', pattern: 'path', default: '/www/wwwroot' },
      ],
      ...chain([
        { id: 'check', tool: 'ssh.check_tools', bind: server, config: { require: 'php,composer,node,npm,pm2,git' }, label: 'Cek server' },
        { id: 'down', tool: 'ssh.artisan', bind: server, config: { dir, command: 'down' }, label: 'Mode pemeliharaan' },
        { id: 'update', tool: 'ssh.git_update', bind: withGit, config: { dir, branch: '{{params.branch}}' }, label: 'Perbarui kode' },
        { id: 'composer', tool: 'ssh.composer_install', bind: server, config: { dir }, label: 'composer install' },
        { id: 'npm_ci', tool: 'ssh.npm', bind: server, config: { dir, script: 'ci' }, label: 'npm ci' },
        { id: 'migrate', tool: 'ssh.artisan', bind: server, config: { dir, command: 'migrate' }, label: 'migrate' },
        { id: 'build', tool: 'ssh.npm', bind: server, config: { dir, script: 'build' }, label: 'npm run build' },
        { id: 'cache_config', tool: 'ssh.artisan', bind: server, config: { dir, command: 'config_cache' }, label: 'config:cache' },
        { id: 'cache_route', tool: 'ssh.artisan', bind: server, config: { dir, command: 'route_cache' }, label: 'route:cache' },
        { id: 'cache_view', tool: 'ssh.artisan', bind: server, config: { dir, command: 'view_cache' }, label: 'view:cache' },
        { id: 'up', tool: 'ssh.artisan', bind: server, config: { dir, command: 'up' }, label: 'Akhiri pemeliharaan' },
        { id: 'reload', tool: 'ssh.pm2', bind: server, config: { dir, action: 'reload' }, label: 'pm2 reload' },
        { id: 'web_check', tool: 'orbyte.http_check', config: { url: 'https://{{params.domain}}', expect: '200,301,302', tries: 6, delay_seconds: 5 }, label: 'Cek situs menjawab' },
      ]),
    }),
};

export const TEMPLATES: readonly FlowTemplate[] = [laravelPm2Setup, laravelPm2Update];
export const getTemplate = (key: string) => TEMPLATES.find((t) => t.key === key);
