import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { connections, deployments, findings, organizations } from '../../db/schema';
import { GithubError, githubClient, type GithubClient } from '../../integrations/github/client';
import { env } from '../../lib/env';
import { recordAudit, type AuditWho } from '../audit/service';
import { automationOnce } from '../automation/once';
import { resolvePublicHost } from '../connections/network';
import { answeredUp, isDue, isReservedDomain, nextUptime, PROBE_DOMAIN } from './rules';

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_ATTEMPTS = 2;

export type Probe = (domain: string) => Promise<boolean>;

/**
 * Asks `https://<domain>/` once or twice (fixed timeout and retries, PRD M17). The domain is typed by a person, so it is
 * checked against the private-address guard first (SSRF); a domain that points inside our network is "not reachable".
 * Redirects are not followed: any answer under 500 already proves the site is up.
 * ⚠️ The address is resolved here and again by fetch; pinning the resolved address is still open (BRD-M17 risk list).
 */
export const httpProbe: Probe = async (domain) => {
  if (!PROBE_DOMAIN.test(domain)) return false;
  try {
    await resolvePublicHost(domain);
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://${domain}/`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { 'user-agent': 'Orbyte-Uptime/1.0' } });
      await res.body?.cancel().catch(() => undefined);
      if (answeredUp(res.status) || res.type === 'opaqueredirect') return true;
    } catch {
      /* timeout, refused, TLS failure: try once more, then count it as a failure */
    }
  }
  return false;
};

async function orgInterval(orgId: string): Promise<number> {
  const [org] = await db.select({ min: organizations.uptimeIntervalMin }).from(organizations).where(eq(organizations.id, orgId));
  return org?.min ?? 5;
}

/**
 * Uptime (PRD M17): checks every active deployment with a domain that is due, by the organization's interval, and stores
 * the outcome. Only the current state and the run of failures are kept, no long history (PRD: "riwayat panjang tidak
 * disimpan"). Returns how many were checked and how many flipped.
 */
export async function checkUptime(orgId: string, now: Date, probe: Probe = httpProbe): Promise<{ checked: number; changed: number }> {
  const interval = await orgInterval(orgId);
  const rows = await db
    .select({ id: deployments.id, domain: deployments.domain, state: deployments.uptimeState, failures: deployments.uptimeFailures, checkedAt: deployments.uptimeCheckedAt })
    .from(deployments)
    .where(and(eq(deployments.orgId, orgId), eq(deployments.status, 'active'), isNotNull(deployments.domain)));
  let checked = 0;
  let changed = 0;
  for (const d of rows) {
    if (!d.domain || isReservedDomain(d.domain) || !isDue(d.checkedAt, interval, now)) continue;
    const ok = await probe(d.domain.toLowerCase());
    const next = nextUptime({ state: d.state, failures: d.failures }, ok);
    await db
      .update(deployments)
      .set({ uptimeState: next.state, uptimeFailures: next.failures, uptimeCheckedAt: now, ...(next.changed ? { uptimeChangedAt: now } : {}) })
      .where(and(eq(deployments.orgId, orgId), eq(deployments.id, d.id)));
    checked++;
    if (next.changed) changed++;
  }
  return { checked, changed };
}

/**
 * Code drift (BR-M17-11, -12): for each active deployment with a repository, a branch and a known installed commit, reads
 * the tip of the branch through the organization's GitHub App installation that can see the repository, and how many
 * commits the server is behind. Stores the tip, the count and the time; `behind_by` is a reading, refreshed every check.
 * ⚠️ The installed commit itself is written by setup runs and `orbyte.record_deployment`; reading it from the server over
 * SSH is not done here yet (untested against a real server, PRD M17).
 */
export async function checkCodeDrift(orgId: string, now: Date, gh: GithubClient = githubClient()): Promise<{ checked: number; failed: number }> {
  const interval = await orgInterval(orgId);
  const apps = await db.select({ config: connections.config }).from(connections).where(and(eq(connections.orgId, orgId), eq(connections.kind, 'github'), sql`${connections.testStatus} <> 'failed'`));
  if (apps.length === 0) return { checked: 0, failed: 0 };
  const rows = await db
    .select({ id: deployments.id, repo: deployments.repo, branch: deployments.branch, deployed: deployments.deployedCommit, checkedAt: deployments.codeCheckedAt })
    .from(deployments)
    .where(and(eq(deployments.orgId, orgId), eq(deployments.status, 'active'), isNotNull(deployments.repo), isNotNull(deployments.branch), isNotNull(deployments.deployedCommit)));
  const due = rows.filter((d) => isDue(d.checkedAt, interval, now));
  if (due.length === 0) return { checked: 0, failed: 0 };

  // Which installation sees which repository, read once per run.
  const owner = new Map<string, number>();
  for (const app of apps) {
    const installationId = Number((app.config as { installationId?: unknown }).installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) continue;
    const repos = await gh.listRepositories(installationId).catch(() => []);
    for (const r of repos) if (!owner.has(r.fullName.toLowerCase())) owner.set(r.fullName.toLowerCase(), installationId);
  }

  let checked = 0;
  let failed = 0;
  for (const d of due) {
    const installationId = owner.get(d.repo!.toLowerCase());
    if (!installationId) continue; // no installation of this organization can see the repository
    try {
      const head = await gh.getBranchHead(installationId, d.repo!, d.branch!);
      const behind = head === d.deployed ? 0 : await gh.commitsAhead(installationId, d.repo!, d.deployed!, head);
      await db.update(deployments).set({ latestCommit: head, behindBy: behind, codeCheckedAt: now }).where(and(eq(deployments.orgId, orgId), eq(deployments.id, d.id)));
      checked++;
    } catch (err) {
      failed++;
      if (err instanceof GithubError && err.kind === 'rate_limited') break; // try the rest on a later tick
    }
  }
  return { checked, failed };
}

/**
 * The two M17 findings (BRD-M08 section 3, PRD M17), each through `automation.once`:
 * - `deployment_outdated`: one per (deployment, tip of the branch). A newer push makes a new period.
 * - `deployment_down`: one per down spell (the moment it went down). Coming back up closes it (sweep).
 */
export async function emitDeploymentFindings(orgId: string): Promise<{ outdated: number; down: number }> {
  const rows = await db
    .select({ id: deployments.id, behindBy: deployments.behindBy, latest: deployments.latestCommit, state: deployments.uptimeState, changedAt: deployments.uptimeChangedAt })
    .from(deployments)
    .where(and(eq(deployments.orgId, orgId), eq(deployments.status, 'active')));
  let outdated = 0;
  let down = 0;
  for (const d of rows) {
    if (d.behindBy && d.behindBy > 0 && d.latest) {
      if (await raise(orgId, 'deployment_outdated', d.id, d.latest, `outdated:${d.id}:${d.latest}`)) outdated++;
    }
    if (d.state === 'down' && d.changedAt) {
      const since = d.changedAt.toISOString();
      if (await raise(orgId, 'deployment_down', d.id, since, `down:${d.id}:${since}`)) down++;
    }
  }
  return { outdated, down };
}

async function raise(orgId: string, rule: 'deployment_outdated' | 'deployment_down', deploymentId: string, periodKey: string, key: string): Promise<boolean> {
  const audit: AuditWho = { orgId, actor: `system:rule.${rule}` };
  return db.transaction(async (tx) => {
    const once = await automationOnce(tx, orgId, rule, key, async () => {
      const [row] = await tx.insert(findings).values({ orgId, rule, entityType: 'deployment', entityId: deploymentId, periodKey }).onConflictDoNothing().returning({ id: findings.id });
      if (row) await recordAudit(tx, audit, { action: 'finding.created', entityType: 'finding', entityId: row.id, summary: { rule, deploymentId } });
      return row?.id ?? null;
    });
    return once.ran && once.result !== null;
  });
}

/**
 * What the ticker runs every minute per organization, outside its lock because it calls the network: uptime, then drift
 * when a GitHub App is configured on this server, then the findings. Each check only touches deployments that are due.
 */
export async function runOperationChecks(orgId: string, now: Date, deps: { probe?: Probe; gh?: GithubClient | null } = {}) {
  const uptime = await checkUptime(orgId, now, deps.probe);
  let drift = { checked: 0, failed: 0 };
  const gh = deps.gh === undefined ? githubAppIfConfigured() : deps.gh;
  if (gh) drift = await checkCodeDrift(orgId, now, gh);
  const raised = await emitDeploymentFindings(orgId);
  return { uptime, drift, raised };
}

function githubAppIfConfigured(): GithubClient | null {
  return env('GITHUB_APP_ID') && env('GITHUB_APP_PRIVATE_KEY') ? githubClient() : null;
}
