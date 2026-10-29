import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import type { Definition } from '../../domain/flows/definition';
import { api, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { FlowCanvas, toCanvas, toolLabelKey, type Catalog, type NodeStatus } from './shared';

type RunStatus = 'planned' | 'awaiting_approval' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
interface Step { node: string; tool: string; position: number; status: NodeStatus; attempts: number; output: unknown; error: string | null; outputs: Record<string, unknown> | null; startedAt: string | null; finishedAt: string | null }
interface RunDto { id: string; status: RunStatus; error: string | null; summary: unknown; params: Record<string, unknown>; flowId: string | null; flowVersion: number | null; definition: Definition | null; steps: Step[]; createdAt: string; startedAt: string | null; finishedAt: string | null }

export const RUN_TONE: Record<RunStatus, 'neutral' | 'success' | 'warn' | 'danger' | 'accent'> = { planned: 'neutral', awaiting_approval: 'warn', running: 'accent', paused: 'warn', done: 'success', failed: 'danger', cancelled: 'neutral' };
const LIVE: RunStatus[] = ['running'];

/** The diagram of a run with each step coloured by what happened, refreshed while it runs (BR-M17-22). */
export function RunView({ id, canRun }: { id: string; canRun: boolean }) {
  const t = useT();
  const run = useLoad(() => api<RunDto>('GET', `/api/runs/${id}`), [id]);
  const catalog = useLoad(() => api<Catalog>('GET', '/api/flows/catalog'), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const status = run.value.state === 'ready' ? run.value.data.status : null;

  useEffect(() => {
    if (!status || !LIVE.includes(status)) return;
    const timer = setInterval(() => void run.reload(), 2000);
    return () => clearInterval(timer);
  }, [status]);

  const data = run.value.state === 'ready' ? run.value.data : null;
  const cat = catalog.value.state === 'ready' ? catalog.value.data : null;
  const statuses = useMemo(() => Object.fromEntries((data?.steps ?? []).map((s) => [s.node, s.status])), [data]);
  const canvas = useMemo(() => (data?.definition && cat ? toCanvas(data.definition, cat, statuses) : null), [data, cat, statuses]);

  async function act(path: string) {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/api/runs/${id}/${path}`, {});
      await run.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (run.value.state === 'loading' || catalog.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={8} /></Panel>;
  if (run.value.state === 'error') return <Panel><ErrorBox onRetry={run.retry}>{t(errorKey(run.value.error))}</ErrorBox></Panel>;
  if (catalog.value.state === 'error') return <Panel><ErrorBox onRetry={catalog.retry}>{t(errorKey(catalog.value.error))}</ErrorBox></Panel>;
  if (!data || !canvas) return null;
  const step = data.steps.find((s) => s.node === picked) ?? data.steps.find((s) => s.status === 'failed') ?? null;
  const done = data.steps.filter((s) => s.status === 'done').length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <a href="/app/setup" className="w-fit text-sm text-accent no-underline hover:underline">{t('navRuns')}</a>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink">
            {String(data.params.domain ?? data.params.slug ?? t('navRuns'))}
            <Badge tone={RUN_TONE[data.status]}>{t(`runStatus_${data.status}` as MessageKey)}</Badge>
          </h1>
          {canRun && (
            <div className="flex flex-wrap gap-2">
              {data.status === 'paused' && <Button variant="primary" size="sm" onClick={() => act('retry')} loading={busy}>{t('runRetry')}</Button>}
              {['paused', 'running', 'awaiting_approval'].includes(data.status) && <ConfirmButton variant="danger" busy={busy} onConfirm={() => act('cancel')}>{t('runCancel')}</ConfirmButton>}
            </div>
          )}
        </div>
        <p className="m-0 text-sm text-muted">{t('runProgress', { done, total: data.steps.length })}</p>
        {data.error && <p role="alert" className="m-0 text-danger [overflow-wrap:anywhere]">{data.error}</p>}
        {data.status === 'paused' && <p className="m-0 text-sm text-muted">{t('runPausedHelp')}</p>}
        {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <ReactFlowProvider>
          <FlowCanvas label={t('flowCanvas')} nodes={canvas.nodes} edges={canvas.edges} readOnly onNodeClick={setPicked} />
        </ReactFlowProvider>
        <Panel className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto !p-3" aria-live="polite">
          {step ? (
            <>
              <div>
                <h2 className="m-0 text-base font-semibold text-ink">{t(toolLabelKey(step.tool))}</h2>
                <p className="m-0 font-mono text-xs text-muted">{step.node}</p>
              </div>
              <Badge tone={step.status === 'done' ? 'success' : step.status === 'failed' ? 'danger' : step.status === 'running' ? 'accent' : 'neutral'}>{t(`flowStatus_${step.status}` as MessageKey)}</Badge>
              {step.attempts > 1 && <p className="m-0 text-xs text-muted">{t('runAttempts', { n: step.attempts })}</p>}
              {step.error && <pre className="m-0 whitespace-pre-wrap rounded-input border border-danger p-2 font-mono text-xs text-danger [overflow-wrap:anywhere]">{step.error}</pre>}
              {step.output != null && <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap rounded-input border border-rule bg-paper-2 p-2 font-mono text-xs text-ink [overflow-wrap:anywhere]">{typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}</pre>}
            </>
          ) : <p className="m-0 text-sm text-muted">{t('runPickStep')}</p>}
        </Panel>
      </div>
    </div>
  );
}
