import type { VersionState } from '../../domain/portfolio/semver';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';

/** "Behind" is a derived state (BR-M02-05): shown here, never stored. */
export function VersionBadge({ state }: { state: VersionState }) {
  const t = useT();
  if (state === 'behind') return <Badge tone="warn">{t('versionBehind')}</Badge>;
  if (state === 'current') return <Badge tone="success">{t('versionCurrent')}</Badge>;
  if (state === 'ahead') return <Badge tone="accent">{t('versionAhead')}</Badge>;
  return <Badge>{t('versionUnknown')}</Badge>;
}
