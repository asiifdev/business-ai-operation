import { useState } from 'react';
import { api, errorKey } from '../../lib/api-client';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';

interface FlowRow { id: string; name: string; kind: 'setup' | 'update'; description: string | null; currentVersion: number; hasCommandNode: boolean; nodeCount: number }
interface TemplateRow { key: string; name: string; description: string; kind: 'setup' | 'update'; nodeCount: number }

/** The deploy flows of the organization, and the ready-made ones to start from (BRD-M17 section 13). */
export function FlowsPage({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const flows = useLoad(() => api<{ flows: FlowRow[] }>('GET', '/api/flows'), []);
  const templates = useLoad(() => api<{ templates: TemplateRow[] }>('GET', '/api/flows/templates'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function open(key: string, call: () => Promise<{ id: string }>) {
    setBusy(key);
    setError(null);
    try {
      const { id } = await call();
      window.location.assign(`/app/flow/${id}`);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }
  const taken = new Set(flows.value.state === 'ready' ? flows.value.data.flows.map((f) => f.name.toLowerCase()) : []);
  const freshName = () => {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? t('flowNewName') : `${t('flowNewName')} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  };
  const blank = () => open('blank', () => api('POST', '/api/flows', { name: freshName(), kind: 'setup', definition: { slots: [], params: [], nodes: [], edges: [] } }));
  const fromTemplate = (key: string) => open(key, () => api('POST', `/api/flows/templates/${key}`, {}));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('navFlows')} intro={t('flowsIntro')} action={canWrite ? <Button variant="primary" onClick={blank} loading={busy === 'blank'}><Icon name="plus" className="size-4" />{t('flowNew')}</Button> : undefined} />
      {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}

      <section aria-label={t('flowsYours')} className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('flowsYours')}</h2>
        {flows.value.state === 'loading' ? <Panel aria-busy="true"><Skeleton rows={3} /></Panel>
          : flows.value.state === 'error' ? <Panel><ErrorBox onRetry={flows.retry}>{t(errorKey(flows.value.error))}</ErrorBox></Panel>
          : flows.value.data.flows.length === 0 ? <EmptyState>{t('flowsEmpty')}</EmptyState>
          : (
            <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {flows.value.data.flows.map((f) => (
                <li key={f.id}>
                  <a href={`/app/flow/${f.id}`} className="block h-full rounded-card border border-rule bg-paper p-4 no-underline shadow-card transition-colors hover:border-rule-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{f.name}</span>
                      <Badge tone="neutral">{t(f.kind === 'setup' ? 'flowKindSetup' : 'flowKindUpdate')}</Badge>
                    </div>
                    {f.description && <p className="mt-1 mb-0 text-sm text-muted">{f.description}</p>}
                    <p className="mt-3 mb-0 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>{t('flowVersionN', { n: f.currentVersion })}</span>
                      <span>{t('flowStepsN', { n: f.nodeCount })}</span>
                      {f.hasCommandNode && <span className="text-warm-ink">{t('flowOwnerOnly')}</span>}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
      </section>

      {canWrite && (
        <section aria-label={t('flowsTemplates')} className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('flowsTemplates')}</h2>
          {templates.value.state === 'ready' && (
            <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
              {templates.value.data.templates.map((x) => (
                <li key={x.key}>
                  <Panel className="flex h-full flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-base font-semibold text-ink">{x.name}</span>
                      <Badge tone="neutral">{t(x.kind === 'setup' ? 'flowKindSetup' : 'flowKindUpdate')}</Badge>
                    </div>
                    <p className="m-0 flex-1 text-sm text-muted">{x.description}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">{t('flowStepsN', { n: x.nodeCount })}</span>
                      <Button size="sm" onClick={() => fromTemplate(x.key)} loading={busy === x.key}>{t('flowUseTemplate')}</Button>
                    </div>
                  </Panel>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
