import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/use-t';
import { HistoryList } from './assistant/HistoryList';
import { Composer, Conversation } from './assistant/Conversation';
import { useAssistant } from './assistant/useAssistant';
import { Icon } from './shell/Icon';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

type Role = 'owner' | 'admin' | 'staff';

/**
 * The assistant page, full screen: the person's earlier conversations on the left (a drawer on a phone) and the open
 * conversation on the right. It talks only about the organization: facts come from the tools behind `/api/ai/chat`, the
 * sources are shown under each answer, and anything outside the business gets a fixed refusal (D-049). Every conversation
 * is kept for its owner (D-078); the same one is open in the side panel on every other page.
 */
export function AssistantChat({ role }: { role: Role }) {
  const t = useT();
  const a = useAssistant();
  const composer = useRef<HTMLTextAreaElement>(null);
  const query = useRef('');
  const [drawer, setDrawer] = useState(false);

  // The drawer is the phone's way to the history; on a wide screen the list is beside the conversation, so the drawer closes.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const onChange = () => wide.matches && setDrawer(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  // The list is fetched on arrival and again whenever a new answer made it stale.
  useEffect(() => {
    if (a.sessions === null) void a.loadSessions(query.current);
  }, [a.sessions]);

  // `/app/asisten?q=…` arrives with a question (from the dashboard or the command palette): ask it once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('q');
    if (!q) return;
    url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
    a.ask(q);
  }, []);

  const history = (onDone?: () => void) => (
    <HistoryList
      sessions={a.sessions}
      currentId={a.sessionId}
      onOpen={(id) => void a.open(id)}
      onNew={() => { a.newChat(); composer.current?.focus(); }}
      onSearch={(q) => { query.current = q; void a.loadSessions(q); }}
      onRename={(id, title) => void a.rename(id, title)}
      onDelete={(id) => void a.remove(id)}
      onDone={onDone}
    />
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-6">
      <aside aria-label={t('historyTitle')} className="hidden w-72 shrink-0 flex-col gap-3 lg:flex">
        <h2 className="m-0 text-sm font-medium text-muted">{t('historyTitle')}</h2>
        {history()}
      </aside>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 lg:gap-4">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 max-w-prose">
            <h1 className="m-0 truncate text-2xl font-semibold text-ink lg:text-3xl">{a.title ?? t('assistantTitle')}</h1>
            <p className="mt-1 mb-0 hidden text-muted md:block">{t('assistantIntro')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="lg:hidden" onClick={() => { void a.loadSessions(query.current); setDrawer(true); }}>
              <Icon name="history" className="size-4" />
              {t('historyTitle')}
            </Button>
            {a.turns.length > 0 && (
              <Button size="sm" onClick={() => { a.newChat(); composer.current?.focus(); }} disabled={a.busy}>{t('assistantClear')}</Button>
            )}
          </div>
        </header>

        <section className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2" aria-label={t('assistantTitle')} aria-busy={a.opening}>
          <Conversation turns={a.turns} busy={a.busy || a.opening} role={role} onAsk={a.ask} onRetry={a.retry} />
        </section>

        <Composer ref={composer} busy={a.busy} onSend={a.ask} />
      </div>

      <Modal open={drawer} onClose={() => setDrawer(false)} title={t('historyTitle')} placement="bottom" bodyClassName="flex min-h-[50dvh] flex-col">
        {history(() => setDrawer(false))}
      </Modal>
    </div>
  );
}
