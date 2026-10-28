import { describe, expect, it } from 'vitest';
import { compareVersions, isBehind, parseSemver, versionState } from '../semver';

describe('semantic versions (BR-M02-05, BR-M02-06)', () => {
  it('compares by number, not by text', () => {
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('ranks a pre-release below its release and orders pre-release parts the SemVer way', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBeLessThan(0);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
  });

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+build5', '1.0.0+build9')).toBe(0);
  });

  it.each(['2026-10-28', '1.2', '1.2.3.4', 'latest', '', '01.2.3', 'v', '1.2.x'])('cannot compare %j', (bad) => {
    expect(parseSemver(bad)).toBeNull();
    expect(compareVersions(bad, '1.0.0')).toBeNull();
    expect(versionState(bad, '1.0.0')).toBe('unknown');
  });

  it('says behind only when both versions can be compared', () => {
    expect(versionState('1.2.0', '1.3.0')).toBe('behind');
    expect(versionState('1.3.0', '1.3.0')).toBe('current');
    expect(versionState('1.4.0', '1.3.0')).toBe('ahead');
    expect(versionState(null, '1.3.0')).toBe('unknown');
    expect(versionState('1.3.0', null)).toBe('unknown');
    expect(isBehind('1.2.0', '1.3.0')).toBe(true);
    expect(isBehind('2026.10', '1.3.0')).toBe(false);
  });
});
