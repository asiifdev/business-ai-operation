import { describe, expect, it } from 'vitest';
import { priorityOf, stillApplies, type FindingFacts } from '../../action-center/facts';
import { answeredUp, DOWN_AFTER_FAILURES, isDue, isReservedDomain, nextUptime, PROBE_DOMAIN } from '../rules';

describe('uptime decisions (PRD M17)', () => {
  it('needs two failures in a row before a site counts as down, and one success brings it back', () => {
    expect(DOWN_AFTER_FAILURES).toBe(2);
    const once = nextUptime({ state: 'up', failures: 0 }, false);
    expect(once).toEqual({ state: 'up', failures: 1, changed: false });
    const twice = nextUptime(once, false);
    expect(twice).toEqual({ state: 'down', failures: 2, changed: true });
    expect(nextUptime(twice, false)).toEqual({ state: 'down', failures: 3, changed: false }); // stays down, no new spell
    expect(nextUptime(twice, true)).toEqual({ state: 'up', failures: 0, changed: true });
  });

  it('never calls a site down on its very first failed check', () => {
    expect(nextUptime({ state: null, failures: 0 }, false)).toEqual({ state: null, failures: 1, changed: false });
    expect(nextUptime({ state: null, failures: 0 }, true)).toEqual({ state: 'up', failures: 0, changed: true });
  });

  it('counts any answer below 500 as up', () => {
    expect([200, 301, 404, 403].every(answeredUp)).toBe(true);
    expect([500, 502, 503, 0].some(answeredUp)).toBe(false);
  });

  it('probes plain host names only, and skips names reserved for documentation and tests', () => {
    expect(PROBE_DOMAIN.test('crm.aksara.co.id')).toBe(true);
    for (const bad of ['https://x.com', 'x.com/path', 'user@x.com', 'x.com:8080', '-x.com', 'a..b.com', 'X.COM']) expect(PROBE_DOMAIN.test(bad), bad).toBe(false);
    for (const reserved of ['crm.aksara.example.test', 'app.example.com', 'example.org', 'site.invalid', 'localhost', 'a.localhost']) expect(isReservedDomain(reserved), reserved).toBe(true);
    for (const real of ['crm.aksara.co.id', 'myexample.com', 'test.com', 'example.co.id']) expect(isReservedDomain(real), real).toBe(false);
  });

  it('checks again only after the organization interval', () => {
    const at = new Date('2026-10-28T03:00:00Z');
    expect(isDue(null, 5, at)).toBe(true);
    expect(isDue(new Date('2026-10-28T02:56:00Z'), 5, at)).toBe(false);
    expect(isDue(new Date('2026-10-28T02:55:00Z'), 5, at)).toBe(true);
  });
});

const dep = (over: Partial<Extract<FindingFacts, { kind: 'deployment' }>> = {}): FindingFacts => ({
  kind: 'deployment',
  deploymentId: 'dep-1',
  status: 'active',
  clientId: 'c1',
  clientName: 'Aksara Studio',
  productName: 'Orbit CRM',
  environment: 'production',
  domain: 'crm.aksara.co.id',
  repo: 'orbit/crm',
  branch: 'main',
  deployedCommit: 'aaa1111',
  latestCommit: 'bbb2222',
  behindBy: 3,
  uptimeState: 'up',
  uptimeChangedAt: '2026-10-28T03:00:00.000Z',
  uptimeCheckedAt: '2026-10-28T03:00:00.000Z',
  ...over,
});

describe('deployment findings (BRD-M08 section 3, PRD M17)', () => {
  it('deployment_outdated stays open while behind the same tip, and closes when updated or a newer push arrives', () => {
    expect(stillApplies('deployment_outdated', 'bbb2222', dep())).toBe(true);
    expect(stillApplies('deployment_outdated', 'bbb2222', dep({ behindBy: 0, deployedCommit: 'bbb2222' }))).toBe(false);
    expect(stillApplies('deployment_outdated', 'bbb2222', dep({ latestCommit: 'ccc3333', behindBy: 4 }))).toBe(false);
    expect(stillApplies('deployment_outdated', 'bbb2222', dep({ status: 'inactive' }))).toBe(false);
  });

  it('deployment_down stays open for the same down spell and closes when the site answers again', () => {
    const since = '2026-10-28T03:10:00.000Z';
    expect(stillApplies('deployment_down', since, dep({ uptimeState: 'down', uptimeChangedAt: since }))).toBe(true);
    expect(stillApplies('deployment_down', since, dep({ uptimeState: 'up', uptimeChangedAt: '2026-10-28T03:20:00.000Z' }))).toBe(false);
  });

  it('ranks a site that is down above code that is behind, and more commits behind higher', () => {
    const down = priorityOf('deployment_down', dep({ uptimeState: 'down' }), '2026-10-28').score;
    const behind3 = priorityOf('deployment_outdated', dep(), '2026-10-28').score;
    const behind30 = priorityOf('deployment_outdated', dep({ behindBy: 30 }), '2026-10-28').score;
    expect(down).toBeGreaterThan(behind30);
    expect(behind30).toBeGreaterThan(behind3);
    expect(priorityOf('deployment_outdated', dep({ behindBy: 500 }), '2026-10-28').score).toBe(priorityOf('deployment_outdated', dep({ behindBy: 50 }), '2026-10-28').score);
  });
});
