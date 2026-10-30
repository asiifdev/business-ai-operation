import type { FinanceSummary } from '../../domain/billing/summary';
import { cx } from '../../lib/cx';
import { formatCompactRupiah, formatMonthShort, formatRupiah } from '../../lib/format';
import { useT } from '../../lib/use-t';
import { Panel } from '../ui/Panel';
import { SectionHeading, stagger } from './primitives';

/** A "nice" ceiling for the axis (1, 2, 2.5 or 5 times a power of ten) so gridlines land on round figures. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= value) ?? 10;
  return step * pow;
}

/**
 * Received vs invoiced for six months, with a labelled scale and gridlines. Drawn with plain boxes, not SVG, so the text
 * stays sharp at every width. The same numbers are offered as a table for anyone who cannot read bars.
 */
export function RevenueChart({ series }: { series: FinanceSummary['series'] }) {
  const t = useT();
  const max = niceMax(Math.max(...series.flatMap((s) => [s.received, s.invoiced])));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const empty = series.every((s) => s.received === 0 && s.invoiced === 0);
  const last = series.length - 1;
  const pct = (v: number) => `${(v / max) * 100}%`;

  return (
    <Panel className="rise flex flex-col gap-4" aria-label={t('chartTitle')} style={stagger(5)}>
      <SectionHeading title={t('chartTitle')} intro={t('chartIntro')} />
      <ul className="m-0 flex list-none gap-4 p-0 text-sm text-ink-2">
        <li className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-accent" />{t('legendReceived')}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-brand-node" />{t('legendInvoiced')}</li>
      </ul>
      {empty ? (
        <p className="m-0 py-10 text-center text-muted">{t('chartEmpty')}</p>
      ) : (
        <div className="flex gap-2" role="img" aria-label={`${t('chartTitle')}: ${series.map((s) => `${formatMonthShort(s.month)} ${formatRupiah(s.received)} / ${formatRupiah(s.invoiced)}`).join('; ')}`}>
          <div aria-hidden="true" className="flex h-52 w-12 shrink-0 flex-col justify-between text-right font-mono text-xs text-muted">
            {ticks.map((f) => (
              <span key={f} className="-my-1.5 leading-none">{f === 0 ? '0' : formatCompactRupiah(max * f)}</span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-52">
              {ticks.map((f) => (
                <span key={f} aria-hidden="true" className="absolute inset-x-0 border-t border-rule" style={{ bottom: `${f * 100}%` }} />
              ))}
              <ol aria-hidden="true" className="absolute inset-0 m-0 flex list-none items-end gap-1 p-0 sm:gap-3">
                {series.map((s, i) => (
                  <li key={s.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 sm:gap-1">
                    {([['received', s.received, 'bg-accent'], ['invoiced', s.invoiced, 'bg-brand-node']] as const).map(([k, v, color]) => (
                      <span key={k} className="relative flex h-full w-1/2 max-w-9 items-end">
                        {i === last && v > 0 && <span className="absolute left-1/2 mb-1 -translate-x-1/2 font-mono text-[11px] whitespace-nowrap text-ink" style={{ bottom: pct(v) }}>{formatCompactRupiah(v)}</span>}
                        <span className={cx('bar block w-full rounded-t', color, v === 0 && 'hidden')} style={{ height: pct(v), '--i': i } as React.CSSProperties} />
                      </span>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
            <ol aria-hidden="true" className="m-0 mt-2 flex list-none gap-1 p-0 sm:gap-3">
              {series.map((s) => (
                <li key={s.month} className="min-w-0 flex-1 text-center text-xs text-muted">{formatMonthShort(s.month)}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted hover:text-ink">{t('chartTable')}</summary>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">{t('colMonth')}</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">{t('legendReceived')}</th>
              <th scope="col" className="py-1 text-right font-medium">{t('legendInvoiced')}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.month} className="border-t border-rule">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">{s.month}</th>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatRupiah(s.received)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{formatRupiah(s.invoiced)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Panel>
  );
}
