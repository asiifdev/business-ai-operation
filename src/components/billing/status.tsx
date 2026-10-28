import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

const LABEL = { draft: 'invStatusDraft', sent: 'invStatusSent', paid: 'invStatusPaid', void: 'invStatusVoid' } as const satisfies Record<InvoiceStatus, MessageKey>;
const TONE = { draft: 'neutral', sent: 'accent', paid: 'success', void: 'neutral' } as const;

/** The state of an invoice as a word. An overdue invoice says so as well: the word, not only a colour. */
export function InvoiceStatusBadge({ status, overdue = false, daysOverdue = 0 }: { status: InvoiceStatus; overdue?: boolean; daysOverdue?: number }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={TONE[status]}>{t(LABEL[status])}</Badge>
      {overdue && <Badge tone="danger">{t('invLate', { n: daysOverdue })}</Badge>}
    </span>
  );
}

/** Payment methods offered when recording a payment. The stored value is plain text, so these are only suggestions. */
export const PAYMENT_METHODS = [
  { value: 'transfer', label: 'payMethodTransfer' },
  { value: 'cash', label: 'payMethodCash' },
  { value: 'ewallet', label: 'payMethodEwallet' },
  { value: 'other', label: 'payMethodOther' },
] as const satisfies readonly { value: string; label: MessageKey }[];
