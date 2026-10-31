import { cx } from '../../lib/cx';
import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import type { Chip } from './attachments';

const KIND: Record<string, MessageKey> = { pdf: 'attKindPdf', image: 'attKindImage', video: 'attKindVideo', audio: 'attKindAudio', document: 'attKindDocument', sheet: 'attKindSheet', slides: 'attKindSlides', text: 'attKindText', link: 'attKindLink' };
const REASON: Record<string, MessageKey> = { format: 'attErrFormat', legacy: 'attErrLegacy', size: 'attErrSize', empty: 'attErrEmpty', url: 'attErrUrl', unreachable: 'attErrUnreachable', limit: 'attErrLimit', ai: 'attErrAi', quota: 'attErrQuota', audio: 'attErrAudio', rate: 'attErrRate' };

/** What is attached: a name, what kind it was read as, and while it is being read a pulse. `onRemove` shows the cross (the composer); the message bubble leaves it out. */
export function AttachmentChips({ chips, onRemove, onDark = false }: { chips: readonly Chip[]; onRemove?: (chip: Chip) => void; onDark?: boolean }) {
  const t = useT();
  if (chips.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t('attHint')}>
      {chips.map((chip) => (
        <li
          key={chip.key}
          className={cx(
            'flex max-w-full items-center gap-1.5 rounded-input border px-2 py-1 text-sm',
            chip.status === 'error' ? 'border-danger bg-danger-wash text-ink' : onDark ? 'border-accent-ink/30 bg-accent-ink/10 text-accent-ink' : 'border-rule-2 bg-paper-2 text-ink',
          )}
          aria-busy={chip.status === 'reading' || undefined}
        >
          <Icon name={chip.kind === 'link' ? 'link' : 'attach'} className={cx('size-4 shrink-0', chip.status === 'reading' && 'animate-pulse')} />
          <span className="truncate" title={chip.name}>{chip.name}</span>
          {chip.status === 'reading' && <span className="shrink-0 text-xs opacity-70">{t('attReading')}</span>}
          {chip.status === 'ready' && chip.kind && KIND[chip.kind] && <span className="shrink-0 text-xs opacity-70">{t(KIND[chip.kind]!)}</span>}
          {chip.status === 'error' && <span role="alert" className="shrink-0 text-xs text-danger">{t(REASON[chip.error ?? ''] ?? 'attErrGeneric')}</span>}
          {onRemove && (
            <button type="button" onClick={() => onRemove(chip)} aria-label={t('attRemove', { name: chip.name })} className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full opacity-70 hover:bg-ink/10 hover:opacity-100">
              <Icon name="close" className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
