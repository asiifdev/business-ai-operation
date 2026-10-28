import type { DashboardOverview } from '../../domain/dashboard/overview';
import { formatNumber, formatPercent } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Panel } from '../ui/Panel';
import { SectionHeading, stagger } from './primitives';

const PARTS = [
  { key: 'current', label: 'compCurrent', color: 'bg-success' },
  { key: 'behind', label: 'compBehind', color: 'bg-warm' },
  { key: 'unknown', label: 'compUnknown', color: 'bg-rule-2' },
  { key: 'inactive', label: 'compInactive', color: 'bg-muted' },
] as const satisfies readonly { key: keyof DashboardOverview['composition']; label: MessageKey; color: string }[];

/** How the deployments split by version state: one stacked bar plus a legend that gives each count and share. */
export function Composition({ composition }: { composition: DashboardOverview['composition'] }) {
  const t = useT();
  const total = PARTS.reduce((s, p) => s + composition[p.key], 0);
  return (
    <Panel className="rise flex flex-col gap-4" aria-label={t('compTitle')} style={stagger(6)}>
      <SectionHeading title={t('compTitle')} />
      <p className="m-0 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-semibold tabular-nums text-ink">{formatNumber(total)}</span>
        <span className="text-sm text-muted">{t('compTotal')}</span>
      </p>
      <div role="img" aria-label={PARTS.map((p) => `${t(p.label)} ${composition[p.key]}`).join(', ')} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-paper-3">
        {PARTS.filter((p) => composition[p.key] > 0).map((p) => (
          <span key={p.key} className={`${p.color} block h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${(composition[p.key] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className={`${p.color} size-2.5 shrink-0 rounded-full`} />
            <span className="flex-1 text-ink-2">{t(p.label)}</span>
            <span className="font-mono tabular-nums text-ink">{composition[p.key]}</span>
            <span className="w-12 text-right font-mono text-xs tabular-nums text-muted">{total ? formatPercent(composition[p.key] / total) : '0%'}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
