import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';

export type DocumentKind = 'proposal' | 'quotation' | 'minutes';
export type DocumentStatus = 'draft' | 'final';

export const KIND_LABEL = { proposal: 'docKindProposal', quotation: 'docKindQuotation', minutes: 'docKindMinutes' } as const satisfies Record<DocumentKind, MessageKey>;
const STATUS_LABEL = { draft: 'docStatusDraft', final: 'docStatusFinal' } as const satisfies Record<DocumentStatus, MessageKey>;

/** The state of a document as a word, with a note when an assistant wrote it and no one has reviewed it yet. */
export function DocumentStatusBadge({ status, aiDraft = false }: { status: DocumentStatus; aiDraft?: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={status === 'final' ? 'success' : 'neutral'}>{t(STATUS_LABEL[status])}</Badge>
      {aiDraft && <Badge tone="accent">{t('aiAssistedLabel')}</Badge>}
    </span>
  );
}
