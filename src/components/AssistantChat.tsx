import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AssistantReply } from '../ai/assistant';
import { parseAnswer, type Run } from '../lib/answer';
import type { MessageKey } from '../lib/i18n';
import { formatUsd } from '../lib/usd';
import { useLocale, useT } from '../lib/use-t';
import { Textarea } from './forms/Textarea';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';

type Role = 'owner' | 'admin' | 'staff';

type Turn =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; reply: AssistantReply }
  | { id: number; kind: 'error'; text: string; retry: string };

const SOURCE_LABEL: Record<string, MessageKey> = {
  get_ai_usage: 'srcGetAiUsage',
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
};

const STARTERS: Record<'manager' | 'staff', MessageKey[]> = {
  manager: ['starterBehind', 'starterLateTasks', 'starterPackages', 'starterClients', 'starterUsage', 'starterTeam', 'starterApprovals', 'starterCapabilities'],
  staff: ['starterBehind', 'starterLateTasks', 'starterPackages', 'starterClients', 'starterApprovals', 'starterCapabilities'],
};

const MAX_LENGTH = 2000;
let nextId = 1;

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

/**
 * The assistant page. It is not a general chatbot: every answer comes from the tools behind `/api/ai/chat`, the sources
 * are shown under it, and a question with no data behind it is refused with a fixed message.
 */
export function AssistantChat({ role }: { role: Role }) {
  const t = useT();
  const locale = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const isManager = role !== 'staff';

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  async function ask(raw: string, history: Turn[]) {
    const question = raw.trim();
    if (!question || busy) return;
    const withQuestion: Turn[] = [...history, { id: nextId++, kind: 'user', text: question }];
    setTurns(withQuestion);
    setDraft('');
    setBusy(true);
    const all: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const turn of withQuestion) {
      if (turn.kind === 'user') all.push({ role: 'user', content: turn.text });
      else if (turn.kind === 'assistant') {
        const text = turn.reply.text ?? turn.reply.message;
        if (text) all.push({ role: 'assistant', content: text });
      }
    }
    const messages = all.slice(-10);
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ messages, locale }) });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) setTurns([...withQuestion, { id: nextId++, kind: 'assistant', reply: body.data as AssistantReply }]);
      else setTurns([...withQuestion, { id: nextId++, kind: 'error', text: res.status === 429 ? t('rateLimited') : t('genericError'), retry: question }]);
    } catch {
      setTurns([...withQuestion, { id: nextId++, kind: 'error', text: t('genericError'), retry: question }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(draft, turns);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:gap-5">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h1 className="m-0 text-2xl font-semibold text-ink lg:text-3xl">{t('assistantTitle')}</h1>
          <p className="mt-2 mb-0 hidden text-muted md:block">{t('assistantIntro')}</p>
        </div>
        {turns.length > 0 && (
          <Button size="sm" onClick={() => setTurns([])} disabled={busy}>{t('assistantClear')}</Button>
        )}
      </header>

      <Panel className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto" aria-label={t('assistantTitle')}>
        {turns.length === 0 && !busy ? (
          <div className="m-auto flex max-w-xl flex-col items-start gap-3 py-8">
            <p className="m-0 text-sm font-medium text-ink">{t('assistantTryAsking')}</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS[isManager ? 'manager' : 'staff'].map((key) => (
                <Button key={key} size="sm" onClick={() => void ask(t(key), [])}>{t(key)}</Button>
              ))}
            </div>
            <p className="m-0 text-sm text-muted">{t('assistantNote')}</p>
          </div>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-5 p-0">
            {turns.map((turn) => (
              <li key={turn.id} className={turn.kind === 'user' ? 'flex justify-end' : 'flex'}>
                {turn.kind === 'user' && (
                  <div className="max-w-[85%] rounded-card bg-accent-wash px-4 py-3">
                    <p className="m-0 mb-1 text-xs text-muted">{t('assistantYou')}</p>
                    <p className="m-0 whitespace-pre-wrap text-base text-ink">{turn.text}</p>
                  </div>
                )}
                {turn.kind === 'assistant' && <AssistantTurn reply={turn.reply} isManager={isManager} />}
                {turn.kind === 'error' && (
                  <div className="max-w-[85%] rounded-card border border-danger px-4 py-3" role="alert">
                    <p className="m-0 text-base text-ink">{turn.text}</p>
                    <Button className="mt-2" size="sm" onClick={() => void ask(turn.retry, turns.filter((x) => x.id !== turn.id).slice(0, -1))} disabled={busy}>{t('assistantRetry')}</Button>
                  </div>
                )}
              </li>
            ))}
            {busy && (
              <li className="flex" aria-live="polite">
                <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-card bg-paper-2 px-4 py-3">
                  <p className="m-0 text-sm text-muted">{t('assistantThinking')}</p>
                  <div aria-hidden="true" className="h-3 w-3/4 rounded bg-paper-3" />
                  <div aria-hidden="true" className="h-3 w-1/2 rounded bg-paper-3" />
                </div>
              </li>
            )}
          </ol>
        )}
        <div ref={endRef} />
      </Panel>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft, turns);
        }}
        className="flex shrink-0 flex-col gap-2"
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxHeight={160}
          maxLength={MAX_LENGTH}
          counter
          placeholder={t('assistantPlaceholder')}
          aria-label={t('assistantPlaceholder')}
          disabled={busy}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={draft.trim() === ''}>{t('assistantSend')}</Button>
        </div>
      </form>
    </div>
  );
}

function AssistantTurn({ reply, isManager }: { reply: AssistantReply; isManager: boolean }) {
  const t = useT();
  const text = reply.text ?? reply.message ?? '';
  const failed = !reply.ok || reply.refused;
  return (
    <div className={'flex max-w-[85%] flex-col gap-3 rounded-card px-4 py-3 ' + (failed ? 'border border-rule bg-paper' : 'bg-paper-2')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{t('assistantName')}</span>
        <span className={'rounded-full border px-2 py-0.5 text-xs ' + (failed ? 'border-rule-2 text-muted' : 'border-accent text-accent')}>{reply.label}</span>
      </div>
      <Answer text={text} />
      {reply.pendingApprovals.length > 0 && <p className="m-0 text-sm text-warm-ink">{t('assistantApprovalPending', { count: reply.pendingApprovals.length })}</p>}
      {reply.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-2">
          <span className="text-sm text-muted">{t('assistantSources')}</span>
          {reply.sources.map((source) => (
            <span key={source} title={source} className="rounded-input border border-rule bg-paper px-2 py-0.5 text-sm text-ink">
              {SOURCE_LABEL[source] ? t(SOURCE_LABEL[source]) : source}
            </span>
          ))}
          {isManager && reply.costMicroUsd !== null && (
            <span className="ml-auto text-sm text-muted tabular-nums">{t('assistantCost')} {formatUsd(reply.costMicroUsd)}</span>
          )}
        </div>
      )}
    </div>
  );
}
