import { useEffect, useMemo, useState } from 'react';
import type { Definition } from '../../domain/flows/definition';
import { api, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { toolLabelKey } from './shared';

interface FlowRow { id: string; name: string; kind: 'setup' | 'update' }
interface FlowFull { definition: Definition; version: number }
interface ProductRow { id: string; name: string }
interface ConnRow { id: string; kind: 'github' | 'ssh' | 'aapanel'; name: string; testStatus: 'untested' | 'ok' | 'failed' }
interface Plan { runId: string; approvalId: string; planHash: string; changes: Array<{ node: string; tool: string; label: string | null; config: Record<string, string | number | boolean> }>; params: Record<string, unknown> }
interface SetupDto { profile: { serverConnectionId?: string | null; githubConnectionId?: string | null; domainPattern?: string | null } | null }

/** Asks what the flow needs, turns the answers into a plan, and starts it only after a person approves (BR-M17-21). */
export function RunPlanner({ initialFlowId, initialProductId }: { initialFlowId: string | null; initialProductId: string | null }) {
  const t = useT();
  const flows = useLoad(() => api<{ flows: FlowRow[] }>('GET', '/api/flows'), []);
  const products = useLoad(() => api<{ products: ProductRow[] }>('GET', '/api/products'), []);
  const clientList = useLoad(() => api<{ clients: Array<{ id: string; name: string }> }>('GET', '/api/clients'), []);
  const conns = useLoad(() => api<{ connections: ConnRow[] }>('GET', '/api/connections'), []);
  const [flowId, setFlowId] = useState(initialFlowId ?? '');
  const [productId, setProductId] = useState(initialProductId ?? '');
  const flow = useLoad(() => (flowId ? api<FlowFull>('GET', `/api/flows/${flowId}`) : Promise.resolve(null)), [flowId]);
  const setup = useLoad(() => (productId ? api<SetupDto>('GET', `/api/products/${productId}/setup`) : Promise.resolve(null)), [productId]);
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const def = flow.value.state === 'ready' ? flow.value.data?.definition ?? null : null;
  /** `product_id` comes from the product chosen above; asking again only invites a typo. */
  const askedParams = def ? def.params.filter((p) => p.name !== 'product_id') : [];
  const profile = setup.value.state === 'ready' ? setup.value.data?.profile ?? null : null;
  useEffect(() => {
    if (!def) return;
    setPlan(null);
    setParams((cur) => Object.fromEntries(def.params.map((p) => [p.name, cur[p.name] ?? (p.default === undefined ? (p.type === 'boolean' ? false : '') : (p.default as string | boolean))])));
  }, [def]);
  // Default connections come from the product profile; the person may still change them.
  useEffect(() => {
    if (!def || !conns.value || conns.value.state !== 'ready') return;
    const fromProfile: Record<string, string | null | undefined> = { ssh: profile?.serverConnectionId, github: profile?.githubConnectionId };
    const list = conns.value.data.connections;
    setBindings((cur) => {
      const next: Record<string, string> = {};
      for (const s of def.slots) {
        const wanted = cur[s.name] ?? fromProfile[s.kind] ?? '';
        const usable = list.find((c) => c.id === wanted && c.kind === s.kind);
        next[s.name] = usable ? usable.id : (list.filter((c) => c.kind === s.kind && c.testStatus === 'ok').length === 1 ? list.find((c) => c.kind === s.kind && c.testStatus === 'ok')!.id : '');
      }
      return next;
    });
  }, [def, profile, conns.value]);

  const ready = useMemo(() => !!def && !!productId && def.slots.every((s) => bindings[s.name]) && askedParams.every((p) => !p.required || p.type === 'boolean' || String(params[p.name] ?? '') !== ''), [def, productId, bindings, params]);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api<Plan>('POST', '/api/runs', { flowId, productId, params, bindings }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/api/approvals/${plan.approvalId}/decide`, { decision: 'approve' });
      window.location.assign(`/app/setup/${plan.runId}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  async function discard() {
    if (!plan) return;
    setBusy(true);
    try {
      await api('POST', `/api/runs/${plan.runId}/cancel`, {});
    } catch {
      /* the plan expires by itself */
    }
    setPlan(null);
    setBusy(false);
  }

  const loading = [flows, products, conns].some((x) => x.value.state === 'loading');
  const failed = [flows, products, conns].find((x) => x.value.state === 'error');
  if (loading) return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (failed && failed.value.state === 'error') return <Panel><ErrorBox onRetry={failed.retry}>{t(errorKey(failed.value.error))}</ErrorBox></Panel>;
  if (flows.value.state !== 'ready' || products.value.state !== 'ready' || conns.value.state !== 'ready') return null;
  const connections = conns.value.data.connections;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={t('runNewTitle')} intro={t('runNewIntro')} />
      {flows.value.data.flows.length === 0 ? <EmptyState action={<a href="/app/flow" className="text-accent">{t('navFlows')}</a>}>{t('runNoFlows')}</EmptyState> : (
        <Panel className="flex flex-col gap-4">
          <FormField label={t('runFlow')} required>
            <SelectMenu value={flowId} onChange={(v) => { setFlowId(v); setPlan(null); }} placeholder={t('choose')} options={flows.value.data.flows.map((f) => ({ value: f.id, label: f.name }))} />
          </FormField>
          <FormField label={t('runProduct')} required>
            <SelectMenu value={productId} onChange={(v) => { setProductId(v); setPlan(null); }} placeholder={t('choose')} options={products.value.data.products.map((p) => ({ value: p.id, label: p.name }))} />
          </FormField>

          {def && def.slots.map((s) => {
            const options = connections.filter((c) => c.kind === s.kind);
            return (
              <FormField key={s.name} label={s.label ?? t(`flowSlot_${s.kind}` as MessageKey)} required help={options.length === 0 ? t('runNoConnection') : undefined}>
                <SelectMenu value={bindings[s.name] ?? ''} onChange={(v) => { setBindings({ ...bindings, [s.name]: v }); setPlan(null); }} placeholder={t('choose')} options={options.map((c) => ({ value: c.id, label: c.testStatus === 'ok' ? c.name : `${c.name} (${t(c.testStatus === 'failed' ? 'runConnFailed' : 'runConnUntested')})`, disabled: c.testStatus !== 'ok' }))} />
              </FormField>
            );
          })}

          {def && askedParams.map((p) => p.name === 'client_id'
            ? (
              <FormField key={p.name} label={p.label ?? p.name} required>
                <SelectMenu value={String(params[p.name] ?? '')} onChange={(v) => { setParams({ ...params, [p.name]: v }); setPlan(null); }} placeholder={t('choose')} options={(clientList.value.state === 'ready' ? clientList.value.data.clients : []).map((c) => ({ value: c.id, label: c.name }))} />
              </FormField>
            )
            : p.type === 'boolean'
            ? <Toggle key={p.name} label={p.label ?? p.name} checked={params[p.name] === true} onChange={(v) => { setParams({ ...params, [p.name]: v }); setPlan(null); }} />
            : (
              <FormField key={p.name} label={p.label ?? p.name} required={p.required}>
                <TextInput value={String(params[p.name] ?? '')} inputMode={p.type === 'number' ? 'numeric' : undefined} onChange={(e) => { setParams({ ...params, [p.name]: e.currentTarget.value }); setPlan(null); }} autoComplete="off" spellCheck={false} />
              </FormField>
            ))}

          {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
          {!plan && <div><Button variant="primary" onClick={propose} loading={busy} disabled={!ready}>{t('runPlan')}</Button></div>}
        </Panel>
      )}

      {plan && (
        <Panel className="flex flex-col gap-3" aria-label={t('runPlanTitle')}>
          <h2 className="m-0 text-lg font-semibold text-ink">{t('runPlanTitle')}</h2>
          <p className="m-0 text-sm text-muted">{t('runPlanHelp')}</p>
          {plan.changes.length === 0 ? <p className="m-0 text-sm text-muted">{t('runPlanNoChange')}</p> : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {plan.changes.map((c, i) => (
                <li key={c.node} className="rounded-input border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">{i + 1}.</span>
                    <span className="font-medium text-ink">{c.label || t(toolLabelKey(c.tool))}</span>
                    <Badge tone="warn">{t('flowTierChange')}</Badge>
                  </div>
                  <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {Object.entries(c.config).map(([k, v]) => (
                      <div key={k} className="contents"><dt className="font-mono text-muted">{k}</dt><dd className="m-0 font-mono text-ink [overflow-wrap:anywhere]">{String(v)}</dd></div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={approve} loading={busy}>{t('runApprove')}</Button>
            <Button onClick={discard} disabled={busy}>{t('runDiscard')}</Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
