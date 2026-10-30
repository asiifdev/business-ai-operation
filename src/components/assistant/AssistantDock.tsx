import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/use-t';
import { LogoMark } from '../brand/LogoMark';
import { Icon } from '../shell/Icon';
import { buttonClasses } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Composer, Conversation } from './Conversation';
import { ASK_EVENT, useAssistant } from './useAssistant';

type Role = 'owner' | 'admin' | 'staff';

/**
 * The assistant beside every page (chat-first, BRD-M14 amendment 2026-10-29): a panel from the right on a wide screen
 * and full width on a phone. It opens from the "Ask Orbyte" buttons, from Ctrl/⌘+J, and from `askAssistant()` anywhere
 * in the app (the dashboard's question bar), and keeps the same conversation as the full assistant page.
 */
export function AssistantDock({ role, open, onOpenChange }: { role: Role; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { turns, busy, ask, retry, clear } = useAssistant();
  const composer = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string }>).detail?.question?.trim();
      onOpenChange(true);
      if (question) setPending(question);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [onOpenChange]);

  // Ask once the panel is open, so the question lands in the conversation the person is looking at.
  useEffect(() => {
    if (!open || !pending) return;
    ask(pending);
    setPending(null);
  }, [open, pending]);

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={t('assistantName')}
      placement="right"
      initialFocus={composer}
      bodyClassName="flex flex-col gap-4 !p-0"
      actions={
        <>
          {turns.length > 0 && (
            <button type="button" onClick={() => { clear(); composer.current?.focus(); }} disabled={busy} className={buttonClasses('secondary', 'sm')}>
              {t('assistantClear')}
            </button>
          )}
          <a href="/app/asisten" aria-label={t('dockOpenFull')} title={t('dockOpenFull')} className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors duration-(--duration-micro) hover:bg-paper-2 hover:text-ink">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg>
          </a>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4">
        <Conversation turns={turns} busy={busy} role={role} onAsk={ask} onRetry={retry} compact />
      </div>
      <div className="shrink-0 border-t border-rule bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Composer ref={composer} busy={busy} onSend={ask} rows={1} />
        <p className="mt-2 mb-0 text-xs text-muted">{t('dockHint')}</p>
      </div>
    </Modal>
  );
}

/** The launcher: a wide "Ask Orbyte" field in the top bar and the sidebar, so a question is one click from anywhere. */
export function AskLauncher({ onOpen, className, variant = 'field' }: { onOpen: () => void; className?: string; variant?: 'field' | 'fab' }) {
  const t = useT();
  if (variant === 'fab') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('askOrbyte')}
        aria-haspopup="dialog"
        className="fab fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full border border-rule bg-key-face shadow-pop transition-transform duration-(--duration-micro) motion-safe:active:scale-95 lg:hidden"
      >
        <LogoMark size={28} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+J Meta+J"
      className={'group flex h-9 items-center gap-2 rounded-input border border-rule bg-key-face pr-1.5 pl-2 text-sm text-ink shadow-btn transition-[border-color,background-color] duration-(--duration-micro) hover:border-mint-ink/50 active:bg-paper-2 ' + (className ?? '')}
    >
      <LogoMark size={18} />
      <span className="flex-1 truncate text-left font-medium">{t('askOrbyte')}</span>
      <kbd className="hidden rounded border border-rule bg-paper-2 px-1.5 font-mono text-xs text-muted sm:inline">⌘J</kbd>
    </button>
  );
}
