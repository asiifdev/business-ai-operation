import { useState } from 'react';
import type { AssistantReply } from '../../ai/assistant';
import { api, errorKey } from '../../lib/api-client';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';

type Item = NonNullable<AssistantReply['autoRan']>[number];
type State = 'idle' | 'busy' | 'undone' | 'changed' | 'refused';

/**
 * What the assistant did by itself (D-082): one line of what happened and, while it can be taken back, a Batalkan button.
 * Undoing needs no confirmation dialog: it is the confirmation. A refusal says why in plain words.
 */
export function AutoRanCard({ items }: { items: Item[] }) {
  return (
    <div className="flex flex-col gap-2" aria-label="auto-ran">
      {items.map((item) => (
        <AutoRanItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function AutoRanItem({ item }: { item: Item }) {
  const t = useT();
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    setState('busy');
    setError(null);
    try {
      const r = await api<{ undone: boolean; reason?: string }>('POST', `/api/approvals/${item.id}/undo`);
      setState(r.undone ? 'undone' : r.reason === 'changed_since' ? 'changed' : 'refused');
    } catch (err) {
      setState('idle');
      setError(t(errorKey(err)));
    }
  }

  if (!item.executed) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-input border border-rule bg-paper px-3 py-2 text-sm text-muted">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>{t('autoNotRun')}</span>
      </div>
    );
  }
  const undone = state === 'undone';
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-input border px-3 py-2 text-sm', undone ? 'border-rule bg-paper text-muted' : 'border-mint-ink/30 bg-mint-wash text-mint-ink')}>
      <Icon name={undone ? 'history' : 'check'} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{undone ? t('autoUndone') : t('autoRanTitle')}</span>
        <span className="ml-2 text-ink-2">{item.summary}</span>
      </span>
      {state === 'changed' && <span role="status" className="w-full text-warm-ink">{t('autoUndoChanged')}</span>}
      {state === 'refused' && <span role="status" className="w-full text-warm-ink">{t('autoUndoRefused')}</span>}
      {error && <span role="alert" className="w-full text-danger">{error}</span>}
      {item.undoable && !undone && state !== 'changed' && state !== 'refused' && (
        <Button size="sm" onClick={() => void undo()} loading={state === 'busy'}>
          {t('autoUndo')}
        </Button>
      )}
      {!item.undoable && <span className="text-xs text-muted">{t('autoNotUndoable')}</span>}
    </div>
  );
}
