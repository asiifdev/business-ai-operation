import { useState, type FormEvent } from 'react';
import { api, badFields, errorKey } from '../../lib/api-client';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';

export interface LeadValues {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  source: string;
  needsSummary: string;
  estimatedValue: number | null;
}

export const emptyLead: LeadValues = { name: '', contactName: '', email: '', phone: '', source: '', needsSummary: '', estimatedValue: null };

/** The lead fields, used to add a lead and to edit one. */
export function LeadForm({ initial = emptyLead, submitLabel, request, onDone, onCancel }: { initial?: LeadValues; submitLabel: string; request: (values: LeadValues) => Promise<unknown>; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [values, setValues] = useState<LeadValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const set = (key: Exclude<keyof LeadValues, 'estimatedValue'>) => (e: { currentTarget: { value: string } }) => setValues({ ...values, [key]: e.currentTarget.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(values);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      <FormField label={t('fName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
        <TextInput value={values.name} onChange={set('name')} maxLength={120} required autoComplete="off" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fContact')}>
          <TextInput value={values.contactName} onChange={set('contactName')} maxLength={120} autoComplete="off" />
        </FormField>
        <FormField label={t('fEmail')} error={bad.email ? t('errValidation') : null}>
          <TextInput type="email" value={values.email} onChange={set('email')} maxLength={254} autoComplete="off" />
        </FormField>
        <FormField label={t('fPhone')}>
          <TextInput type="tel" value={values.phone} onChange={set('phone')} maxLength={40} autoComplete="off" />
        </FormField>
        <FormField label={t('fSource')}>
          <TextInput value={values.source} onChange={set('source')} maxLength={80} autoComplete="off" />
        </FormField>
      </div>
      <FormField label={t('fEstimatedValue')}>
        <MoneyInput value={values.estimatedValue} onChange={(v) => setValues({ ...values, estimatedValue: v })} min={0} />
      </FormField>
      <FormField label={t('fNeeds')}>
        <Textarea value={values.needsSummary} onChange={set('needsSummary')} rows={3} maxLength={4000} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}

/** What the API takes: empty text becomes "nothing" rather than an empty string. */
export const leadPayload = (v: LeadValues) => ({ ...v, estimatedValue: v.estimatedValue ?? null });
