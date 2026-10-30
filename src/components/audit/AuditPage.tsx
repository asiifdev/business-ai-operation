import { useState } from 'react';
import type { listAudit } from '../../domain/audit/read';
import { api, errorKey } from '../../lib/api-client';
import { ACT_TOOL_LABEL } from '../../lib/act-tool-labels';
import { AUDIT_DETAIL_HIDDEN, AUDIT_DETAIL_KEY, AUDIT_ENTITY_LABEL, AUDIT_LABEL } from '../../lib/audit-labels';
import { formatRupiah } from '../../lib/format';
import { STAGE_LABEL } from '../pipeline/stages';
import type { MessageKey } from '../../lib/i18n';
import { formatDateTime } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { DateInput } from '../forms/DateInput';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';

type Page = Jsonify<Awaited<ReturnType<typeof listAudit>>> & { entityTypes: string[] };
type Entry = Page['entries'][number];

/** A short, readable line from an entry's summary: labelled pairs, nested changes as `from → to`, internal ids left out. */
function detail(summary: unknown, t: (key: MessageKey) => string): string {
  if (!summary || typeof summary !== 'object') return '';
  const words = (key: string) => (AUDIT_DETAIL_KEY[key] ? t(AUDIT_DETAIL_KEY[key]) : key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  const show = (key: string, v: unknown): string => (typeof v === 'number' && (key === 'total' || key === 'amount') ? formatRupiah(v) : typeof v === 'string' && v in STAGE_LABEL && (key === 'to' || key === 'from') ? t(STAGE_LABEL[v as keyof typeof STAGE_LABEL]) : key === 'tool' && typeof v === 'string' && ACT_TOOL_LABEL[v] ? t(ACT_TOOL_LABEL[v]) : typeof v === 'boolean' ? (v ? '✓' : '–') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return Object.entries(summary as Record<string, unknown>)
    .filter(([k, v]) => !AUDIT_DETAIL_HIDDEN.has(k) && !/Id$/.test(k) && v !== null && v !== '')
    .map(([k, v]) => {
      if (v && typeof v === 'object' && 'from' in v && 'to' in v) return `${words(k)}: ${String((v as { from: unknown }).from)} → ${String((v as { to: unknown }).to)}`;
      return `${words(k)}: ${show(k, v)}`;
    })
    .join(' · ')
    .slice(0, 240);
}

/** The log of changes, newest first (BRD-M15). Read only: nothing here edits or deletes an entry. */
export function AuditPage({ timezone, isOwner }: { timezone: string; isOwner: boolean }) {
  const t = useT();
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [more, setMore] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  const qs = new URLSearchParams();
  if (actor) qs.set('actor', actor);
  if (entityType) qs.set('entityType', entityType);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const base = qs.toString();
  const first = useLoad(async () => {
    setMore([]);
    const page = await api<Page>('GET', `/api/audit${base ? `?${base}` : ''}`);
    setCursor(page.nextCursor);
    return page;
  }, [base]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const q = new URLSearchParams(base);
      q.set('cursor', cursor);
      const page = await api<Page>('GET', `/api/audit?${q}`);
      setMore((m) => [...m, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const who = (e: Entry) => e.actorName ?? (e.actor.startsWith('ai:') ? t('auditActorAi') : e.actor.startsWith('system:') ? t('auditActorSystem') : e.actor);
  const label = (action: string) => (AUDIT_LABEL[action] ? t(AUDIT_LABEL[action]) : action);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('auditTitle')} intro={t('auditIntro')} />
      <Panel className="flex flex-col gap-4" aria-busy={first.value.state === 'loading'}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('auditActor')}>
            <SelectMenu value={actor} onChange={setActor} includeAll={t('auditActorAny')} searchable={false} options={[{ value: 'user', label: t('auditActorUser') }, { value: 'ai', label: t('auditActorAi') }, { value: 'system', label: t('auditActorSystem') }]} />
          </FormField>
          <FormField label={t('auditEntity')}>
            <SelectMenu value={entityType} onChange={setEntityType} includeAll={t('auditEntityAny')} options={(first.value.state === 'ready' ? first.value.data.entityTypes : []).map((e) => ({ value: e, label: AUDIT_ENTITY_LABEL[e] ? t(AUDIT_ENTITY_LABEL[e]) : e }))} />
          </FormField>
          <FormField label={t('auditFrom')}>
            <DateInput value={from} onChange={setFrom} />
          </FormField>
          <FormField label={t('auditTo')}>
            <DateInput value={to} onChange={setTo} />
          </FormField>
        </div>
        {!isOwner && <p className="m-0 text-sm text-muted">{t('auditFinancialNote')}</p>}
        {first.value.state === 'loading' && <Skeleton rows={8} />}
        {first.value.state === 'error' && <ErrorBox onRetry={first.retry}>{t(errorKey(first.value.error))}</ErrorBox>}
        {first.value.state === 'ready' && first.value.data.entries.length === 0 && <EmptyState>{t('auditEmpty')}</EmptyState>}
        {first.value.state === 'ready' && first.value.data.entries.length > 0 && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[52rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('auditColWhen')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('auditColWho')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('auditColWhat')}</th>
                  <th scope="col" className="py-2 font-medium">{t('auditColDetail')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {[...first.value.data.entries, ...more].map((e) => (
                  <tr key={e.id} role="row" className={tbl.row}>
                    <td data-label={t('auditColWhen')} className={`py-3 pr-3 whitespace-nowrap ${tbl.label}`}>{formatDateTime(e.createdAt, timezone)}</td>
                    <td data-label={t('auditColWho')} className={`py-3 pr-3 ${tbl.label}`}>{who(e)}</td>
                    <td data-label={t('auditColWhat')} className={`py-3 pr-3 ${tbl.label}`}>
                      <span className="text-ink">{label(e.action)}</span>
                      <span className="ml-2 font-mono text-xs text-muted">{AUDIT_ENTITY_LABEL[e.entityType] ? t(AUDIT_ENTITY_LABEL[e.entityType]) : e.entityType}</span>
                    </td>
                    <td data-label={t('auditColDetail')} className={`py-3 text-sm text-muted ${tbl.label} ${tbl.full}`}>{detail(e.summary, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {moreError !== null && <ErrorBox>{t(errorKey(moreError))}</ErrorBox>}
        {cursor && <div><Button loading={loadingMore} onClick={loadMore}>{t('loadMore')}</Button></div>}
      </Panel>
    </div>
  );
}
