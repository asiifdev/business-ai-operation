import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { ACT_TOOL_LABEL } from '../../lib/act-tool-labels';
import type { AssistantReply } from '../../ai/assistant';
import { parseAnswer, type Run } from '../../lib/answer';
import { cx } from '../../lib/cx';
import type { MessageKey } from '../../lib/i18n';
import { formatUsd } from '../../lib/usd';
import { useLocale, useT } from '../../lib/use-t';
import { LogoMark } from '../brand/LogoMark';
import { Textarea } from '../forms/Textarea';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';
import { MAX_LENGTH, type Turn } from './useAssistant';

type Role = 'owner' | 'admin' | 'staff';

const SOURCE_LABEL: Record<string, MessageKey> = {
  get_ai_usage: 'srcGetAiUsage',
  get_business_summary: 'srcGetBusinessSummary',
  list_leads: 'srcListLeads',
  get_code_status: 'toolGetCodeStatus',
  get_pipeline_summary: 'srcGetPipelineSummary',
  list_team_members: 'srcListTeamMembers',
  list_recent_activity: 'srcListRecentActivity',
  list_pending_approvals: 'srcListPendingApprovals',
  describe_capabilities: 'srcDescribeCapabilities',
  list_clients: 'srcListClients',
  get_client_overview: 'srcGetClientOverview',
  list_products: 'srcListProducts',
  get_product_packages: 'srcGetProductPackages',
  list_deployments: 'srcListDeployments',
  list_tasks: 'srcListTasks',
  find_similar_tasks: 'srcFindSimilarTasks',
  draft_task: 'srcDraftTask',
  get_billing_summary: 'srcGetBillingSummary',
  list_invoices: 'srcListInvoices',
  get_invoice: 'srcGetInvoice',
  list_subscriptions: 'srcListSubscriptions',
  draft_invoice: 'srcDraftInvoice',
  list_documents: 'srcListDocuments',
  draft_proposal: 'srcDraftProposal',
  draft_lead: 'srcDraftLead',
  list_flows: 'srcListFlows',
  get_flow: 'srcGetFlow',
  draft_flow: 'srcDraftFlow',
  plan_flow_run: 'srcPlanFlowRun',
  list_setup_runs: 'srcListSetupRuns',
  get_setup_run: 'srcGetSetupRun',
  list_connections: 'srcListConnections',
  list_marketing_assets: 'srcListMarketingAssets',
  generate_marketing_asset: 'srcGenerateAsset',
  draft_marketing_caption: 'srcDraftCaption',
  list_meetings: 'srcListMeetings',
  get_finding_facts: 'srcGetFindingFacts',
};

/** Questions worth asking next, by what the answer rested on. Plain suggestions, not generated: they never promise a tool that is not there. */
const FOLLOW_UP: Record<string, MessageKey[]> = {
  list_invoices: ['fuBilling', 'fuTasks'],
  get_billing_summary: ['fuInvoices', 'fuPipeline'],
  get_invoice: ['fuInvoices', 'fuBilling'],
  list_subscriptions: ['fuInvoices', 'fuBilling'],
  list_tasks: ['fuApprovals', 'fuInvoices'],
  list_leads: ['fuPipeline', 'fuProducts'],
  get_pipeline_summary: ['fuTasks', 'fuInvoices'],
  list_clients: ['fuClients', 'fuInvoices'],
  list_deployments: ['fuClients', 'fuTasks'],
  list_products: ['fuClients', 'fuProducts'],
  get_product_packages: ['fuClients', 'fuInvoices'],
  get_business_summary: ['fuInvoices', 'fuTasks', 'fuPipeline'],
  list_pending_approvals: ['fuInvoices', 'fuTasks'],
};
const followUps = (reply: AssistantReply): MessageKey[] => {
  if (reply.pendingApprovals.length > 0) return ['fuApprovals'];
  return [...new Set(reply.sources.flatMap((s) => FOLLOW_UP[s] ?? []))].slice(0, 3);
};

/** Where a draft the assistant made can be reviewed. */
const DRAFT_HREF: Record<string, (id: string) => string> = {
  draft_invoice: (id) => `/app/invoice/${id}`,
  draft_lead: (id) => `/app/lead/${id}`,
  draft_task: (id) => `/app/task/${id}`,
  draft_proposal: (id) => `/app/dokumen/${id}`,
  draft_flow: (id) => `/app/flow/${id}`,
  plan_flow_run: (id) => `/app/setup/${id}`,
};

/** Every tool name becomes a business word; a name nobody labelled is never shown as it is. */
const sourceLabel = (name: string, t: (key: MessageKey) => string) => (SOURCE_LABEL[name] ? t(SOURCE_LABEL[name]) : ACT_TOOL_LABEL[name] ? t(ACT_TOOL_LABEL[name]) : t('srcOther'));

export const STARTERS: Record<'manager' | 'staff', MessageKey[]> = {
  manager: ['starterBehind', 'starterLateTasks', 'starterPackages', 'starterClients', 'starterUsage', 'starterTeam', 'starterApprovals', 'starterCapabilities'],
  staff: ['starterBehind', 'starterLateTasks', 'starterPackages', 'starterClients', 'starterApprovals', 'starterCapabilities'],
};

export const startersFor = (role: Role) => STARTERS[role === 'staff' ? 'staff' : 'manager'];

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) =>
        run.code ? <code key={i} className="rounded bg-paper-3 px-1 py-0.5 font-mono text-sm">{run.text}</code>
        : run.bold ? <strong key={i} className="font-semibold text-ink">{run.text}</strong>
        : <span key={i}>{run.text}</span>,
      )}
    </>
  );
}

/** The answer as text blocks only: the model never gets to put markup into the page. */
function Answer({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-base text-ink">
      {parseAnswer(text).map((block, i) =>
        block.kind === 'p' ? (
          <p key={i} className="m-0"><Runs runs={block.runs} /></p>
        ) : (
          <ul key={i} className="m-0 list-disc pl-5">
            {block.items.map((item, j) => <li key={j}><Runs runs={item} /></li>)}
          </ul>
        ),
      )}
    </div>
  );
}

/** The assistant's avatar: the same mark everywhere it speaks. */
export function AssistantMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx('grid size-8 shrink-0 place-items-center rounded-full border border-rule bg-key-face shadow-btn', className)}>
      <LogoMark size={20} />
    </span>
  );
}

/**
 * The conversation: the turns, the starters when it is empty, and a waiting row while the assistant works. Shared by the
 * full page and the side panel, so both look and behave the same.
 */
export function Conversation({ turns, busy, role, onAsk, onRetry, compact = false }: {
  turns: Turn[];
  busy: boolean;
  role: Role;
  onAsk: (question: string) => void;
  onRetry: (turn: Extract<Turn, { kind: 'error' }>) => void;
  /** The side panel: narrower bubbles, fewer starters. */
  compact?: boolean;
}) {
  const t = useT();
  const endRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const isManager = role !== 'staff';
  const lastAssistantId = [...turns].reverse().find((x) => x.kind === 'assistant')?.id;

  useEffect(() => {
    // An empty conversation starts at its greeting, whatever the scroll position of the one before it was.
    if (turns.length === 0 && !busy) startRef.current?.scrollIntoView({ block: 'start' });
    else endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  if (turns.length === 0 && !busy) {
    const starters = startersFor(role);
    return (
      <div ref={startRef} className={cx('m-auto flex w-full flex-col gap-4', compact ? 'py-2' : 'max-w-xl py-8')}>
        <div className="flex items-start gap-3">
          <AssistantMark />
          <div className="min-w-0">
            <p className="m-0 font-display text-lg font-semibold text-ink">{t('assistantHello')}</p>
            <p className="m-0 text-sm text-muted">{t('assistantNote')}</p>
          </div>
        </div>
        <p className="m-0 text-sm font-medium text-ink">{t('assistantTryAsking')}</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(compact ? starters.slice(0, 5) : starters).map((key) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onAsk(t(key))}
                className="group flex min-h-11 w-full items-center gap-3 rounded-card border border-rule bg-key-face px-3 py-2 text-left text-sm text-ink shadow-btn transition-[border-color,background-color] duration-(--duration-micro) hover:border-accent/50 hover:bg-accent-wash active:bg-paper-3"
              >
                <span className="flex-1">{t(key)}</span>
                <Icon name="arrow" className="size-4 text-muted transition-transform duration-(--duration-micro) group-hover:text-accent motion-safe:group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const width = compact ? 'max-w-[92%]' : 'max-w-[85%]';
  return (
    <ol className="m-0 flex list-none flex-col gap-5 p-0">
      {turns.map((turn) => (
        <li key={turn.id} className={cx('turn-in flex', turn.kind === 'user' && 'justify-end')}>
          {turn.kind === 'user' && (
            <div className={cx(width, 'rounded-card rounded-br-sm bg-accent px-4 py-2.5 text-accent-ink')}>
              <p className="sr-only">{t('assistantYou')}</p>
              <p className="m-0 whitespace-pre-wrap text-base">{turn.text}</p>
              {turn.at && <p className="m-0 mt-1 text-right text-xs text-accent-ink/70">{timeOf(turn.at, locale)}</p>}
            </div>
          )}
          {turn.kind === 'assistant' && (
            <AssistantTurn
              reply={turn.reply}
              at={turn.at}
              isManager={isManager}
              width={width}
              last={turn.id === lastAssistantId}
              disabled={busy}
              onAsk={onAsk}
              askAgain={previousQuestion(turns, turn.id)}
            />
          )}
          {turn.kind === 'error' && (
            <div className={cx(width, 'rounded-card border border-danger bg-danger-wash px-4 py-3')} role="alert">
              <p className="m-0 text-base text-ink">{turn.text}</p>
              <Button className="mt-2" size="sm" onClick={() => onRetry(turn)} disabled={busy}>{t('assistantRetry')}</Button>
            </div>
          )}
        </li>
      ))}
      {busy && (
        <li className="flex gap-3" aria-live="polite">
          <AssistantMark />
          <div className="flex items-center gap-3 rounded-card rounded-tl-sm border border-rule bg-key-face px-4 py-3">
            <span aria-hidden="true" className="typing flex gap-1"><span /><span /><span /></span>
            <p className="m-0 text-sm text-muted">{t('assistantThinking')}</p>
          </div>
        </li>
      )}
      <li aria-hidden="true"><div ref={endRef} /></li>
    </ol>
  );
}

/** The question an answer replied to, so it can be asked again. */
function previousQuestion(turns: Turn[], answerId: number): string | null {
  const index = turns.findIndex((x) => x.id === answerId);
  for (let i = index - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.kind === 'user') return turn.text;
  }
  return null;
}

const timeOf = (iso: string, locale: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function AssistantTurn({ reply, at, isManager, width, last, disabled, onAsk, askAgain }: { reply: AssistantReply; at?: string; isManager: boolean; width: string; last: boolean; disabled: boolean; onAsk: (question: string) => void; askAgain: string | null }) {
  const t = useT();
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  // Never suggest the question that was just asked.
  const chips = last && !(!reply.ok || reply.refused) ? followUps(reply).filter((key) => t(key) !== askAgain) : [];
  const text = reply.text ?? reply.message ?? '';
  const failed = !reply.ok || reply.refused;
  return (
    <div className={cx('flex gap-3', width)}>
      <AssistantMark className={failed ? 'opacity-60 grayscale' : undefined} />
      <div className={cx('flex min-w-0 flex-1 flex-col gap-3 rounded-card rounded-tl-sm px-4 py-3', failed ? 'border border-rule bg-paper' : 'border border-rule bg-key-face shadow-card')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{t('assistantName')}</span>
          <span className={cx('rounded-full px-2 py-0.5 text-xs', failed ? 'border border-rule-2 text-muted' : 'bg-mint-wash text-mint-ink')}>{reply.label}</span>
          {at && <span className="ml-auto text-xs text-muted">{timeOf(at, locale)}</span>}
        </div>
        <Answer text={text} />
        {reply.pendingApprovals.length > 0 && (
          <a href="/app/action-center" className="flex w-fit items-center gap-2 rounded-input border border-warm px-3 py-1.5 text-sm text-warm-ink no-underline hover:bg-paper">
            {t('assistantApprovalPending', { count: reply.pendingApprovals.length })}
            <Icon name="arrow" className="size-4" />
          </a>
        )}
        {reply.drafts?.filter((d) => DRAFT_HREF[d.tool]).map((d) => (
          <a key={`${d.tool}-${d.id}`} href={DRAFT_HREF[d.tool](d.id)} className="flex w-fit items-center gap-2 rounded-input border border-rule px-3 py-1.5 text-sm text-ink no-underline hover:bg-paper">
            {t('assistantOpenDraft', { what: sourceLabel(d.tool, t) })}
            <Icon name="arrow" className="size-4" />
          </a>
        ))}
        {reply.sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-2">
            <span className="text-sm text-muted">{t('assistantSources')}</span>
            {reply.sources.map((source) => (
              <span key={source} className="rounded-input border border-rule bg-paper px-2 py-0.5 text-sm text-ink">
                {sourceLabel(source, t)}
              </span>
            ))}
            {isManager && reply.costMicroUsd !== null && (
              <span className="ml-auto text-sm text-muted tabular-nums">{t('assistantCost')} {formatUsd(reply.costMicroUsd)}</span>
            )}
          </div>
        )}
        {text && (
          <div className="-mb-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-input px-2 text-xs text-muted hover:bg-paper-2 hover:text-ink"
            >
              <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
              {copied ? t('assistantCopied') : t('assistantCopy')}
            </button>
            {last && askAgain && (
              <button type="button" disabled={disabled} onClick={() => onAsk(askAgain)} className="inline-flex min-h-8 items-center gap-1.5 rounded-input px-2 text-xs text-muted hover:bg-paper-2 hover:text-ink disabled:opacity-50">
                <Icon name="repeat" className="size-3.5" />
                {t('assistantAskAgain')}
              </button>
            )}
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-rule pt-2">
            <span className="text-xs text-muted">{t('assistantFollowUp')}</span>
            <div className="flex flex-wrap gap-2">
              {chips.map((key) => (
                <button key={key} type="button" disabled={disabled} onClick={() => onAsk(t(key))} className="min-h-8 rounded-full border border-rule bg-paper px-3 text-sm text-ink hover:border-accent/50 hover:bg-accent-wash disabled:opacity-50">
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Where a question is typed. Enter sends, Shift+Enter adds a line; the send button sits inside the field's row. */
export function Composer({ busy, onSend, rows = 2, ref }: { busy: boolean; onSend: (question: string) => void; rows?: number; ref?: Ref<HTMLTextAreaElement> }) {
  const t = useT();
  const [draft, setDraft] = useState('');

  function send() {
    if (!draft.trim() || busy) return;
    onSend(draft);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="shrink-0"
    >
      <Textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        maxHeight={160}
        maxLength={MAX_LENGTH}
        placeholder={t('assistantPlaceholder')}
        aria-label={t('assistantPlaceholder')}
        disabled={busy}
        footer={
          <>
            <span className="flex items-center gap-1.5 text-xs text-mint-ink"><LogoMark size={14} />{t('assistantName')}</span>
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={draft.trim() === ''} aria-label={t('assistantSend')} className="ml-auto size-8 !px-0">
              {!busy && <Icon name="arrow" className="size-4 -rotate-90" />}
            </Button>
          </>
        }
      />
    </form>
  );
}
