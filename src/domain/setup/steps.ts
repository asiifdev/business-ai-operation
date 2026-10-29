/**
 * The catalogue of steps a playbook may contain (BR-M17-04, PRD M17). A step is named here and implemented in code; a
 * profile or a plan can only pick from this list, so there is no way to describe "run this command". `tier` says whether
 * a step only reads (may run without approval) or changes the server (needs the approved plan).
 */
export const STEP_CATALOG = [
  { key: 'check_server', tier: 'read' },
  { key: 'git_clone', tier: 'change' },
  { key: 'git_update', tier: 'change' },
  { key: 'create_database', tier: 'change' },
  { key: 'write_env', tier: 'change' },
  { key: 'install_dependencies', tier: 'change' },
  { key: 'build_app', tier: 'change' },
  { key: 'set_domain_and_nginx', tier: 'change' },
  { key: 'restart_service', tier: 'change' },
  { key: 'verify_http', tier: 'read' },
] as const;

export type StepKey = (typeof STEP_CATALOG)[number]['key'];
export const STEP_KEYS = STEP_CATALOG.map((s) => s.key) as unknown as readonly [StepKey, ...StepKey[]];

/** The steps of a new client, in order. `git_update` belongs to updates and is not part of a first setup. */
export const DEFAULT_SETUP_STEPS: StepKey[] = ['check_server', 'git_clone', 'create_database', 'write_env', 'install_dependencies', 'build_app', 'set_domain_and_nginx', 'restart_service', 'verify_http'];
