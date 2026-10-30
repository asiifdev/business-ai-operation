import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';

/**
 * What the M17 checks last saw on a deployment: code behind its branch, and whether the site answers. Shows nothing until a
 * check has run, so an unconnected deployment stays quiet instead of looking broken.
 */
export function OpsBadges({ behindBy, uptimeState }: { behindBy: number | null; uptimeState: 'up' | 'down' | null }) {
  const t = useT();
  return (
    <>
      {behindBy != null && behindBy > 0 && <Badge tone="warn">{t('codeBehind', { n: behindBy })}</Badge>}
      {uptimeState === 'down' && <Badge tone="danger">{t('uptimeDown')}</Badge>}
      {uptimeState === 'up' && <Badge tone="success">{t('uptimeUp')}</Badge>}
    </>
  );
}
