import { useCallback, useEffect, useState } from 'react';
import type { FeatureUsage, AiRunRow } from '../domain/ai/service';
import type { MessageKey } from '../lib/i18n';
import { formatUsd } from '../lib/usd';
import { useLocale, useT } from '../lib/use-t';
import { NumberInput } from './forms/NumberInput';
import { Button } from './ui/Button';
import { Meter } from './ui/Meter';
import { Panel } from './ui/Panel';
import { ErrorBox, Skeleton } from './ui/states';
import * as tbl from './ui/table';
import { Tabs } from './ui/Tabs';

type Role = 'owner' | 'admin' | 'staff';
type Tab = 'budget' | 'runs';
type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T };

type RunView = Omit<AiRunRow, 'startedAt' | 'finishedAt'> & { startedAt: string; finishedAt: string | null };

const FEATURE_LABEL: Record<string, MessageKey> = { agent: 'featAgent', minutes: 'featMinutes', transcribe: 'featTranscribe', image: 'featImage' };
const STATUS_LABEL: Record<string, MessageKey> = { ok: 'statusOk', error: 'statusError', blocked_budget: 'statusBlocked', rejected_tool: 'statusRejected' };
const STATUS_STYLE: Record<string, string> = {
  ok: 'border-success text-success',
  error: 'border-danger text-danger',
  blocked_budget: 'border-warm text-warm-ink',
  rejected_tool: 'border-warm text-warm-ink',
};
const PAGE = 25;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(String(res.status));
  return body.data as T;
}

function readTab(isManager: boolean): Tab {
  const wanted = new URLSearchParams(window.location.search).get('tab');
  return isManager && wanted !== 'runs' ? 'budget' : 'runs';
}

/** AI spend, daily caps (Owner edits them) and the run log. The selected tab lives in the URL (`?tab=`). */
export function AiUsage({ role }: { role: Role }) {
  const t = useT();
  const isManager = role !== 'staff';
  const [tab, setTab] = useState<Tab>(isManager ? 'budget' : 'runs');

  useEffect(() => setTab(readTab(isManager)), [isManager]);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }

  const tabs: Array<{ id: Tab; label: MessageKey }> = [...(isManager ? [{ id: 'budget' as const, label: 'aiTabBudget' as const }] : []), { id: 'runs', label: 'aiTabRuns' }];

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-prose">
        <h1 className="m-0 text-3xl font-semibold text-ink">{t('aiTitle')}</h1>
        <p className="mt-2 mb-0 text-muted">{t('aiIntro')}</p>
      </header>

      {tabs.length > 1 && (
        <Tabs label={t('aiTabs')} items={tabs.map((item) => ({ id: item.id, label: t(item.label) }))} value={tab} onChange={choose} />
      )}

      {tab === 'budget' && isManager ? <BudgetTable isOwner={role === 'owner'} /> : <RunLog isManager={isManager} />}
    </div>
  );
}

function BudgetTable({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const [load, setLoad] = useState<Load<FeatureUsage[]>>({ state: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<{ features: FeatureUsage[] }>('/api/ai/overview');
      setLoad({ state: 'ready', data: data.features });
    } catch {
      setLoad({ state: 'error' });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Panel aria-busy={load.state === 'loading'}>
      {load.state === 'loading' && <Skeleton rows={4} />}
      {load.state === 'error' && <ErrorBox onRetry={() => { setLoad({ state: 'loading' }); void refresh(); }} />}
      {load.state === 'ready' && (
        <>
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[40rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colFeature')}</th>
                  <th scope="col" className="w-48 py-2 pr-3 font-medium">{t('colSpent')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colLimit')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colRemaining')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('colRuns')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={tbl.tbody}>
                {load.data.map((row) => <BudgetRow key={row.feature} row={row} isOwner={isOwner} onSaved={refresh} />)}
              </tbody>
            </table>
          </div>
          {!isOwner && <p className="mt-4 mb-0 text-sm text-muted">{t('budgetOwnerOnly')}</p>}
        </>
      )}
    </Panel>
  );
}

function BudgetRow({ row, isOwner, onSaved }: { row: FeatureUsage; isOwner: boolean; onSaved: () => Promise<void> }) {
  const t = useT();
  const current = row.limitMicroUsd / 1_000_000;
  const [value, setValue] = useState<number | null>(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const label = t(FEATURE_LABEL[row.feature]);
  const dirty = value !== null && Math.round(value * 1_000_000) !== row.limitMicroUsd;

  async function save() {
    if (value === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ai/budgets', { method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ feature: row.feature, limitUsd: value }) });
      if (!res.ok) throw new Error(String(res.status));
      setMessage({ text: t('saved'), bad: false });
      await onSaved();
    } catch {
      setMessage({ text: t('genericError'), bad: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr role="row" className={tbl.row + ' align-middle'}>
      <th scope="row" role="rowheader" className={'py-3 pr-3 text-left font-medium text-ink max-sm:p-0 ' + tbl.full}>{label}</th>
      <td role="cell" data-label={t('colSpent')} className={'py-3 pr-3 max-sm:p-0 ' + tbl.full + ' ' + tbl.label}>
        <Meter value={row.spentMicroUsd} max={row.limitMicroUsd} label={label} danger={row.exhausted} />
        <p className="mt-1 mb-0 tabular-nums text-ink">
          {formatUsd(row.spentMicroUsd)}
          {row.exhausted && <span className="ml-2 text-danger">{t('budgetExhausted')}</span>}
        </p>
      </td>
      <td role="cell" data-label={t('colLimit')} className={'py-3 pr-3 max-sm:p-0 ' + tbl.full + ' ' + tbl.label}>
        {isOwner ? (
          <div className="flex items-center gap-2">
            <div className="w-28">
              <NumberInput value={value} onChange={setValue} min={0} max={100} step={0.01} aria-label={`${label}: ${t('colLimit')}`} />
            </div>
            <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>{t('save')}</Button>
            <span role="status" className={'text-sm ' + (message?.bad ? 'text-danger' : 'text-success')}>{message?.text}</span>
          </div>
        ) : (
          <span className="tabular-nums text-ink">{formatUsd(row.limitMicroUsd)}</span>
        )}
      </td>
      <td role="cell" data-label={t('colRemaining')} className={'py-3 pr-3 text-right tabular-nums text-ink max-sm:p-0 max-sm:text-left ' + tbl.label}>{formatUsd(row.remainingMicroUsd)}</td>
      <td role="cell" data-label={t('colRuns')} className={'py-3 text-right tabular-nums text-ink max-sm:p-0 max-sm:text-left ' + tbl.label}>{row.runsToday}</td>
    </tr>
  );
}

function RunLog({ isManager }: { isManager: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [load, setLoad] = useState<Load<RunView[]>>({ state: 'loading' });
  const [more, setMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const fetchPage = useCallback(async (before?: string) => {
    const query = new URLSearchParams({ limit: String(PAGE) });
    if (before) query.set('before', before);
    return (await getJson<{ runs: RunView[] }>(`/api/ai/runs?${query}`)).runs;
  }, []);

  const first = useCallback(async () => {
    try {
      const runs = await fetchPage();
      setExhausted(runs.length < PAGE);
      setLoad({ state: 'ready', data: runs });
    } catch {
      setLoad({ state: 'error' });
    }
  }, [fetchPage]);
  useEffect(() => {
    void first();
  }, [first]);

  async function loadMore() {
    if (load.state !== 'ready' || load.data.length === 0) return;
    setMore(true);
    try {
      const runs = await fetchPage(load.data[load.data.length - 1].startedAt);
      setExhausted(runs.length < PAGE);
      setLoad({ state: 'ready', data: [...load.data, ...runs] });
    } catch {
      setLoad({ state: 'error' });
    } finally {
      setMore(false);
    }
  }

  return (
    <Panel aria-busy={load.state === 'loading'}>
      {load.state === 'loading' && <Skeleton rows={6} />}
      {load.state === 'error' && <ErrorBox onRetry={() => { setLoad({ state: 'loading' }); void first(); }} />}
      {load.state === 'ready' && load.data.length === 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 max-w-prose text-ink">{t('emptyRuns')}</p>
          <a href="/app/asisten" className="text-accent underline underline-offset-4">{t('askAssistantCta')}</a>
        </div>
      )}
      {load.state === 'ready' && load.data.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[44rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colWhen')}</th>
                  {isManager && <th scope="col" className="py-2 pr-3 font-medium">{t('colUser')}</th>}
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colFeature')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colStatus')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colTokens')}</th>
                  {isManager && <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colCost')}</th>}
                  <th scope="col" className="py-2 font-medium">{t('colTools')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={tbl.tbody}>
                {load.data.map((run) => (
                  <tr key={run.id} role="row" className={tbl.row + ' align-top'}>
                    <td role="cell" data-label={t('colWhen')} className={'py-3 pr-3 whitespace-nowrap text-ink tabular-nums max-sm:p-0 ' + tbl.full + ' ' + tbl.label}>{when.format(new Date(run.startedAt))}</td>
                    {isManager && <td role="cell" data-label={t('colUser')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{run.userName ?? ''}</td>}
                    <td role="cell" data-label={t('colFeature')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{t(FEATURE_LABEL[run.feature])}</td>
                    <td role="cell" data-label={t('colStatus')} className={'py-3 pr-3 max-sm:p-0 ' + tbl.label}>
                      <span title={run.error ?? undefined} className={'inline-block rounded-full border px-2 py-0.5 text-xs ' + STATUS_STYLE[run.status]}>{t(STATUS_LABEL[run.status])}</span>
                    </td>
                    <td role="cell" data-label={t('colTokens')} className={'py-3 pr-3 text-right text-ink tabular-nums max-sm:p-0 max-sm:text-left ' + tbl.label}>{(run.inputTokens + run.outputTokens).toLocaleString(locale)}</td>
                    {isManager && <td role="cell" data-label={t('colCost')} className={'py-3 pr-3 text-right text-ink tabular-nums max-sm:p-0 max-sm:text-left ' + tbl.label}>{formatUsd(Number(run.costMicroUsd))}</td>}
                    <td role="cell" data-label={t('colTools')} className={'py-3 text-ink max-sm:p-0 ' + tbl.full + ' ' + tbl.label}>{[...new Set(run.tools.map((tool) => tool.name))].join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!exhausted && (
            <div className="mt-4">
              <Button size="sm" onClick={() => void loadMore()} loading={more}>{t('loadMore')}</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
