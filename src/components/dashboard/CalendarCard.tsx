import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths } from '../../domain/billing/dates';
import type { CalendarEvent, CalendarKind } from '../../domain/billing/summary';
import { api } from '../../lib/api-client';
import { cx } from '../../lib/cx';
import { formatFullDate, formatMonthYear, formatRupiah, weekdayShort } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import { BILLING_PAGES_READY } from '../../lib/nav';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { Panel } from '../ui/Panel';
import { MaybeLink, SectionHeading, stagger } from './primitives';

interface MonthData {
  month: string;
  today: string;
  events: CalendarEvent[];
}

const KIND: Record<CalendarKind, { label: MessageKey; chip: string; dot: string }> = {
  invoice_due: { label: 'calDue', chip: 'bg-accent-wash text-accent', dot: 'bg-accent' },
  invoice_overdue: { label: 'calOverdue', chip: 'bg-danger-wash text-danger', dot: 'bg-danger' },
  invoice_paid: { label: 'calPaid', chip: 'bg-success/15 text-success', dot: 'bg-success' },
  invoice_draft: { label: 'calDraft', chip: 'border border-dashed border-rule-2 text-muted', dot: 'bg-rule-2' },
  renewal: { label: 'calRenewal', chip: 'bg-warm/20 text-warm-ink', dot: 'bg-warm' },
};
const LEGEND: CalendarKind[] = ['invoice_due', 'invoice_overdue', 'invoice_paid', 'invoice_draft', 'renewal'];

/** Monday-first grid of one month: 5 or 6 rows of ISO dates, including the muted days of the neighbouring months. */
export function monthGrid(monthKey: string): string[] {
  const [y, m] = monthKey.split('-').map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((offset + length) / 7);
  const start = new Date(Date.UTC(y, m - 1, 1 - offset));
  return Array.from({ length: rows * 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

/**
 * The operations calendar: invoices by due date and subscription renewals, month by month. The first month arrives with
 * the page; moving to another month asks the server. Choosing a day lists that day's items below the grid, which is also
 * how a phone reads it (the cells there only show coloured dots).
 */
export function CalendarCard({ initial }: { initial: MonthData }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [month, setMonth] = useState(initial.month);
  const [selected, setSelected] = useState(initial.today);
  const [failed, setFailed] = useState(false);
  const cache = useRef(new Map([[initial.month, initial]]));

  useEffect(() => {
    const hit = cache.current.get(month);
    if (hit) {
      setData(hit);
      setFailed(false);
      return;
    }
    let stale = false;
    api<MonthData>('GET', `/api/dashboard/calendar?month=${month}`)
      .then((r) => {
        if (stale) return;
        cache.current.set(month, r);
        setData(r);
        setFailed(false);
      })
      .catch(() => !stale && setFailed(true));
    return () => {
      stale = true;
    };
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of data.month === month ? data.events : []) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [data, month]);
  const days = useMonthDays(month);
  const dayEvents = byDay.get(selected) ?? [];
  const move = (by: number) => setMonth((m) => addMonths(`${m}-01`, by).slice(0, 7));

  return (
    <Panel className="rise flex flex-col gap-4" aria-label={t('calTitle')} style={stagger(9)}>
      <SectionHeading title={t('calTitle')} intro={t('calIntro')} />
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-ink-2">
        {LEGEND.map((k) => (
          <li key={k} className="flex items-center gap-1.5"><span aria-hidden="true" className={cx('size-2 rounded-full', KIND[k].dot)} />{t(KIND[k].label)}</li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(-1)} aria-label={t('previousMonth')} className="grid size-9 place-items-center rounded-input border border-rule bg-key-face text-ink hover:bg-paper-2">
            <Icon name="chevron" className="size-4 rotate-90" />
          </button>
          <button type="button" onClick={() => move(1)} aria-label={t('nextMonth')} className="grid size-9 place-items-center rounded-input border border-rule bg-key-face text-ink hover:bg-paper-2">
            <Icon name="chevron" className="size-4 -rotate-90" />
          </button>
          <button type="button" onClick={() => (setMonth(initial.today.slice(0, 7)), setSelected(initial.today))} className="ml-1 h-9 rounded-input border border-rule bg-key-face px-3 text-sm text-ink hover:bg-paper-2">{t('calToday')}</button>
        </div>
        <h3 aria-live="polite" className="m-0 font-display text-lg font-semibold text-ink">{formatMonthYear(month)}</h3>
        <span className="w-[9.5rem] max-sm:hidden" aria-hidden="true" />
      </div>
      {failed && <p role="alert" className="m-0 text-sm text-danger">{t('calLoadError')}</p>}
      <div role="grid" aria-label={formatMonthYear(month)} className="overflow-hidden rounded-card border border-rule">
        <div role="row" className="grid grid-cols-7 border-b border-rule bg-paper-2">
          {weekdayShort().map((d) => (
            <span key={d} role="columnheader" className="py-2 text-center text-xs font-medium text-muted">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const inMonth = d.startsWith(month);
            const events = byDay.get(d) ?? [];
            const isToday = d === data.today;
            const isSelected = d === selected;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={`${formatFullDate(d)}${events.length ? `, ${events.length}` : ''}`}
                onClick={() => setSelected(d)}
                className={cx(
                  'flex min-h-14 flex-col items-stretch gap-1 border-rule p-1.5 text-left transition-colors md:min-h-24',
                  i % 7 !== 6 && 'border-r',
                  i < days.length - 7 && 'border-b',
                  inMonth ? 'bg-key-face hover:bg-paper-2' : 'bg-paper-2/60',
                  isSelected && 'bg-accent-wash hover:bg-accent-wash',
                )}
              >
                <span className={cx('grid size-6 place-items-center self-end rounded-full font-mono text-xs tabular-nums max-md:self-center', isToday ? 'bg-accent text-accent-ink' : inMonth ? 'text-ink' : 'text-muted/60')}>{Number(d.slice(8))}</span>
                <span className="flex flex-wrap justify-center gap-0.5 md:hidden">
                  {events.slice(0, 3).map((e, j) => <span key={j} aria-hidden="true" className={cx('size-1.5 rounded-full', KIND[e.kind].dot)} />)}
                </span>
                <span className="hidden flex-col gap-0.5 md:flex">
                  {events.slice(0, 2).map((e, j) => (
                    <span key={j} className={cx('truncate rounded px-1.5 py-0.5 text-[11px] leading-tight', KIND[e.kind].chip)}>{e.label}</span>
                  ))}
                  {events.length > 2 && <span className="px-1 text-[11px] text-muted">{t('calMore', { n: events.length - 2 })}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        <p className="m-0 text-sm font-medium text-ink">{formatFullDate(selected)}</p>
        {dayEvents.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('calDayEmpty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {dayEvents.map((e, i) => (
              <li key={i}>
                <MaybeLink href={e.href} ready={BILLING_PAGES_READY} className="flex items-center gap-3 rounded-input border border-rule bg-key-face px-3 py-2 text-sm no-underline hover:bg-paper-2">
                  <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', KIND[e.kind].dot)} />
                  <span className="min-w-0 flex-1 truncate text-ink">{e.label}</span>
                  <span className="hidden text-xs text-muted sm:inline">{t(KIND[e.kind].label)}</span>
                  <span className="font-mono text-sm tabular-nums text-ink">{formatRupiah(e.amount)}</span>
                </MaybeLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

const useMonthDays = (month: string) => useMemo(() => monthGrid(month), [month]);
