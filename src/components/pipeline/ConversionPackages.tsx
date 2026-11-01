import { useEffect } from 'react';
import type { ConversionPlan } from '../../domain/pipeline/leads';
import { api, errorKey } from '../../lib/api-client';
import { formatRupiah } from '../../lib/format';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Checkbox } from '../forms/Checkbox';
import { ErrorBox, Skeleton } from '../ui/states';

/**
 * The packages of the lead's final proposal that become subscriptions when the lead becomes a client (D-093). All are kept
 * by default; the person can leave any out. Prices are shown as agreed in the proposal and worked out again on the server.
 */
export function ConversionPackages({ leadId, value, onChange }: { leadId: string; value: string[] | null; onChange: (ids: string[]) => void }) {
  const t = useT();
  const load = useLoad(() => api<ConversionPlan>('GET', `/api/leads/${leadId}/conversion-plan`), [leadId]);
  const plan = load.value.state === 'ready' ? load.value.data : null;

  useEffect(() => {
    if (plan && value === null) onChange(plan.lines.map((l) => l.packageId));
  }, [plan, value, onChange]);

  if (load.value.state === 'loading') return <Skeleton rows={2} />;
  if (load.value.state === 'error') return <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>;
  if (!plan?.document || plan.lines.length === 0) return <p className="m-0 max-w-prose text-sm text-muted">{t('convertSubsNone')}</p>;

  const chosen = value ?? [];
  return (
    <fieldset className="m-0 flex w-full max-w-xl flex-col gap-1 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-ink">{t('convertSubsTitle')}</legend>
      <p className="m-0 mb-1 text-sm text-muted">
        {t('convertSubsFrom')} <a href={`/app/dokumen/${plan.document.id}`} className="text-accent underline underline-offset-4">{plan.document.number ?? plan.document.title}</a>
      </p>
      {plan.lines.map((l) => (
        <Checkbox
          key={l.packageId}
          label={l.label}
          description={t('convertSubLine', { qty: l.quantity, price: formatRupiah(l.unitPrice), amount: formatRupiah(l.amount) })}
          checked={chosen.includes(l.packageId)}
          onChange={(on) => onChange(on ? [...chosen, l.packageId] : chosen.filter((id) => id !== l.packageId))}
        />
      ))}
      <p className="m-0 mt-1 text-sm text-muted">{t('convertSubsHelp')}</p>
    </fieldset>
  );
}
