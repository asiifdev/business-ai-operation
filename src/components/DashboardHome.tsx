import type { CalendarEvent } from '../domain/billing/summary';
import type { DashboardOverview, InvoiceBriefLike } from '../domain/dashboard/overview';
import type { Role } from '../domain/permissions';
import { AUDIT_LABEL } from '../lib/audit-labels';
import { cx } from '../lib/cx';
import { formatDateTime, formatDayMonth, formatMonthYear, formatNumber, formatRupiah } from '../lib/format';
import type { MessageKey } from '../lib/i18n';
import { BILLING_PAGES_READY } from '../lib/nav';
import { formatUsd } from '../lib/usd';
import { useT } from '../lib/use-t';
import { CalendarCard } from './dashboard/CalendarCard';
import { Composition } from './dashboard/Composition';
import { CountPill, MaybeLink, SectionHeading, Stat, stagger } from './dashboard/primitives';
import { RevenueChart } from './dashboard/RevenueChart';
import { Icon } from './shell/Icon';
import { buttonClasses } from './ui/Button';
import { Meter } from './ui/Meter';
import { PageHeader } from './ui/PageHeader';
import { Panel } from './ui/Panel';

const ACTOR_KEY = { user: 'actorUser', ai: 'actorAi', system: 'actorSystem' } as const satisfies Record<string, MessageKey>;

interface Props {
  name: string;
  role: Role;
  overview: DashboardOverview;
  timezone: string;
  calendar: { month: string; today: string; events: CalendarEvent[] } | null;
}

/**
 * The home screen. For managers it leads with money (received, recurring, unpaid, overdue), then what is late, then the
 * trend, the calendar and the to-do list. Staff see the portfolio side only. Every number comes from the data.
 */
export function DashboardHome({ name, role, overview, timezone, calendar }: Props) {
  const t = useT();
  const { counts, finance } = overview;
  const greet = overview.localHour < 11 ? 'greetMorning' : overview.localHour < 18 ? 'greetAfternoon' : 'greetEvening';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(greet, { name: name.split(' ')[0] })}
        action={
          <div className="flex flex-wrap gap-2">
            <a href="/app/klien?new=1" className={buttonClasses('primary')}>
              <Icon name="plus" className="size-4" />
              {t('cmdNewClient')}
            </a>
            {role !== 'staff' && <a href="/app/produk?new=1" className={buttonClasses('secondary')}>{t('cmdNewProduct')}</a>}
          </div>
        }
      />

      {finance ? (
        <section aria-label={t('financeTitle', { month: formatMonthYear(finance.month) })} className="flex flex-col gap-3">
          <SectionHeading title={t('financeTitle', { month: formatMonthYear(finance.month) })} />
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 xl:grid-cols-4">
            <Stat index={0} label={t('financeReceived')} value={formatRupiah(finance.receivedThisMonth)} note={t('financeReceivedNote')} tone="good" />
            <Stat index={1} label={t('financeMrr')} value={formatRupiah(finance.mrr)} note={t('financeMrrNote', { n: finance.activeSubscriptions })} />
            <Stat index={2} label={t('financeOutstanding')} value={formatRupiah(finance.outstanding.amount)} note={t('financeOutstandingNote', { n: finance.outstanding.count })} />
            <Stat
              index={3}
              label={t('financeOverdue')}
              value={formatRupiah(finance.overdue.amount)}
              note={finance.overdue.count > 0 ? t('financeOverdueNote', { n: finance.overdue.count }) : t('financeOverdueNone')}
              tone={finance.overdue.count > 0 ? 'bad' : 'neutral'}
            />
          </ul>
        </section>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 xl:grid-cols-4">
          <Stat index={0} href="/app/klien" icon="clients" label={t('kpiClients')} value={formatNumber(counts.clients)} />
          <Stat index={1} href="/app/produk" icon="products" label={t('kpiProducts')} value={formatNumber(counts.products)} />
          <Stat index={2} icon="pulse" label={t('kpiDeployments')} value={formatNumber(counts.deployments)} />
          <Stat index={3} href="/app/produk" icon="alert" label={t('kpiBehind')} value={formatNumber(counts.behind)} tone={counts.behind > 0 ? 'warn' : 'good'} note={counts.behind === 0 ? t('kpiBehindNone') : undefined} />
        </ul>
      )}

      {finance && finance.overdue.count > 0 && <OverdueBanner items={finance.overdue.items} count={finance.overdue.count} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {finance && (
          <div className="min-w-0 lg:col-span-2">
            <RevenueChart series={finance.series} />
          </div>
        )}
        <div className={cx('min-w-0', !finance && 'lg:col-span-1')}>
          <Composition composition={overview.composition} />
        </div>
        {!finance && (
          <div className="min-w-0 lg:col-span-2">
            <Attention rows={overview.behind} total={counts.behind} />
          </div>
        )}
      </div>

      {finance && (
        <div className="grid gap-6 md:grid-cols-2">
          <DueToday rows={finance.dueToday} />
          <Renewals rows={finance.renewalsSoon} />
        </div>
      )}

      {calendar && <CalendarCard initial={calendar} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {finance && <Actions overview={overview} />}
        {finance && (
          <div className="min-w-0 lg:col-span-2">
            <Attention rows={overview.behind} total={counts.behind} />
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <AssistantCard />
        {overview.ai && <AiCard ai={overview.ai} />}
        {overview.activity && <Recent entries={overview.activity.recent} timezone={timezone} />}
      </div>
    </div>
  );
}

function OverdueBanner({ items, count }: { items: InvoiceBriefLike[]; count: number }) {
  const t = useT();
  return (
    <section role="alert" className="rise rounded-card border border-danger/30 bg-danger-wash p-4" style={stagger(4)}>
      <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-danger">
        <Icon name="alert" className="size-5" />
        {t('overdueBanner', { n: count })}
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {items.slice(0, 3).map((i) => (
          <li key={i.id}>
            <MaybeLink href={`/app/invoice/${i.id}`} ready={BILLING_PAGES_READY} className="flex flex-wrap items-baseline gap-x-3 text-sm text-ink no-underline hover:underline">
              <span className="font-medium">{i.clientName}</span>
              <span className="text-ink-2">{i.number}</span>
              <span className="font-mono tabular-nums">{formatRupiah(i.balance)}</span>
              <span className="text-danger">{t('overdueLate', { n: i.daysOverdue })}</span>
            </MaybeLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ListPanel({ title, index, empty, children }: { title: string; index: number; empty?: string; children?: React.ReactNode }) {
  return (
    <Panel className="rise flex min-w-0 flex-col gap-3" aria-label={title} style={stagger(index)}>
      <SectionHeading title={title} />
      {empty ? <p className="m-0 text-sm text-muted">{empty}</p> : children}
    </Panel>
  );
}

function DueToday({ rows }: { rows: InvoiceBriefLike[] }) {
  const t = useT();
  return (
    <ListPanel title={t('todayDueTitle')} index={7} empty={rows.length === 0 ? t('todayDueEmpty') : undefined}>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((i) => (
          <li key={i.id} className="border-t border-rule first:border-t-0">
            <MaybeLink href={`/app/invoice/${i.id}`} ready={BILLING_PAGES_READY} className="flex items-center gap-3 py-2.5 text-sm no-underline">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{i.clientName}</span><span className="block text-xs text-muted">{i.number}</span></span>
              <span className="font-mono tabular-nums text-ink">{formatRupiah(i.balance)}</span>
            </MaybeLink>
          </li>
        ))}
      </ul>
    </ListPanel>
  );
}

function Renewals({ rows }: { rows: NonNullable<DashboardOverview['finance']>['renewalsSoon'] }) {
  const t = useT();
  return (
    <ListPanel title={t('renewalsTitle')} index={8} empty={rows.length === 0 ? t('renewalsEmpty') : undefined}>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-t border-rule py-2.5 text-sm first:border-t-0">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{r.clientName}</span><span className="block truncate text-xs text-muted">{r.productName}</span></span>
            <span className="text-xs text-muted">{formatDayMonth(r.nextDueDate)}</span>
            <span className="font-mono tabular-nums text-ink">{formatRupiah(r.amount)}</span>
          </li>
        ))}
      </ul>
    </ListPanel>
  );
}

function Actions({ overview }: { overview: DashboardOverview }) {
  const t = useT();
  const f = overview.finance!;
  const rows = [
    { n: f.overdue.count, label: t('actionsOverdue'), tone: 'bad' as const, href: '/app/invoice?overdue=1', ready: BILLING_PAGES_READY },
    { n: f.draftsToReview, label: t('actionsDrafts'), tone: 'accent' as const, href: '/app/invoice?status=draft', ready: BILLING_PAGES_READY },
    { n: overview.pendingApprovals ?? 0, label: t('actionsApprovals'), tone: 'accent' as const, href: '/app', ready: false },
    { n: overview.counts.behind, label: t('actionsBehind'), tone: 'warn' as const, href: '/app/produk', ready: true },
  ].filter((r) => r.n > 0);
  return (
    <Panel className="rise flex min-w-0 flex-col gap-3" aria-label={t('actionsTitle')} style={stagger(10)}>
      <SectionHeading title={t('actionsTitle')} />
      {rows.length === 0 ? (
        <p className="m-0 flex items-center gap-2 text-sm text-success"><Icon name="check" className="size-4" />{t('actionsNone')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.label} className="border-t border-rule first:border-t-0">
              <MaybeLink href={r.href} ready={r.ready} className="flex items-center gap-3 py-2.5 text-sm text-ink no-underline">
                <span className="flex-1">{r.label}</span>
                <CountPill n={r.n} tone={r.tone} />
              </MaybeLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Attention({ rows, total }: { rows: DashboardOverview['behind']; total: number }) {
  const t = useT();
  return (
    <Panel className="rise flex flex-col gap-3" aria-label={t('attentionTitle')} style={stagger(11)}>
      <SectionHeading title={t('attentionTitle')} intro={t('attentionIntro')} aside={total > rows.length ? <a href="/app/produk" className="text-sm whitespace-nowrap text-accent no-underline hover:underline">{t('attentionAll')} ({total})</a> : undefined} />
      {rows.length === 0 ? (
        <p className="m-0 flex items-center gap-2 text-sm text-success"><Icon name="check" className="size-4" />{t('attentionEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.id} className="border-t border-rule first:border-t-0">
              <a href={`/app/klien/${r.clientId}`} className="group flex min-h-12 items-center gap-3 py-2 no-underline">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warm/20 text-warm-ink"><Icon name="alert" className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{r.clientName}</span>
                  <span className="block truncate text-xs text-muted">{r.productName} · {r.environment}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-2">{t('attentionRow', { installed: r.installedVersion ?? '—', current: r.productVersion ?? '—' })}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AssistantCard() {
  const t = useT();
  return (
    <Panel className="rise relative flex flex-col items-start overflow-hidden" style={stagger(12)}>
      <div aria-hidden="true" className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-accent/15 blur-2xl" />
      <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-ink"><Icon name="assistant" className="size-5" /></span>
      <h2 className="mt-3 mb-1 text-base font-semibold text-ink">{t('assistantCardTitle')}</h2>
      <p className="m-0 text-sm text-muted">{t('dashboardAssistantHint')}</p>
      <a href="/app/asisten" className={buttonClasses('primary', 'sm', 'mt-4')}>
        {t('askAssistantCta')}
        <Icon name="arrow" className="size-4" />
      </a>
    </Panel>
  );
}

function AiCard({ ai }: { ai: NonNullable<DashboardOverview['ai']> }) {
  const t = useT();
  return (
    <Panel className="rise flex flex-col gap-3" style={stagger(13)}>
      <SectionHeading title={t('kpiAi')} aside={<a href="/app/ai" className="text-sm text-accent no-underline hover:underline">{t('navAi')}</a>} />
      <p className="m-0 font-mono text-2xl font-semibold tabular-nums text-ink">{formatUsd(ai.spentMicroUsd)}</p>
      <Meter value={ai.spentMicroUsd} max={ai.limitMicroUsd} label={t('kpiAi')} danger={ai.limitMicroUsd > 0 && ai.spentMicroUsd >= ai.limitMicroUsd} />
      <p className="m-0 text-xs text-muted">{t('kpiAiOf', { limit: formatUsd(ai.limitMicroUsd), runs: ai.runsToday })}</p>
    </Panel>
  );
}

function Recent({ entries, timezone }: { entries: NonNullable<DashboardOverview['activity']>['recent']; timezone: string }) {
  const t = useT();
  return (
    <Panel className="rise flex flex-col gap-3" aria-label={t('activityRecent')} style={stagger(14)}>
      <SectionHeading title={t('activityRecent')} />
      {entries.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('activityEmpty')}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {entries.slice(0, 4).map((e) => (
            <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0">
              <span aria-hidden="true" className="absolute top-3 bottom-0 left-[5px] w-px bg-rule" />
              <span aria-hidden="true" className={cx('relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-key-face', e.actor === 'ai' ? 'bg-accent' : e.actor === 'system' ? 'bg-warm' : 'bg-rule-2')} />
              <div className="min-w-0">
                <p className="m-0 text-sm text-ink">{AUDIT_LABEL[e.action] ? t(AUDIT_LABEL[e.action]) : e.action.replace('.', ' ').replace(/_/g, ' ')}</p>
                <p className="m-0 text-xs text-muted">{t(ACTOR_KEY[e.actor])} · <time dateTime={e.at}>{formatDateTime(e.at, timezone)}</time></p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
