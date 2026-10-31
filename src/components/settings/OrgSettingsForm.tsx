import { useState, type FormEvent, type ReactNode } from 'react';
import type { getOrgSettings } from '../../domain/org/settings';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { NumberInput } from '../forms/NumberInput';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Button, buttonClasses } from '../ui/Button';
import { AutonomyCard } from './AutonomyCard';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';

type Settings = Jsonify<Awaited<ReturnType<typeof getOrgSettings>>>;

export function OrgSettingsForm({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const load = useLoad(() => api<Settings>('GET', '/api/settings/org'), []);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('orgTitle')} intro={canEdit ? t('orgIntro') : t('orgOwnerOnly')} />
      {load.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={6} /></Panel>}
      {load.value.state === 'error' && <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>}
      {load.value.state === 'ready' && <Form initial={load.value.data} canEdit={canEdit} />}
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Panel className="flex flex-col gap-4">
    <h2 className="m-0 text-lg font-semibold text-ink">{title}</h2>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  </Panel>
);

function Form({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const t = useT();
  const [v, setV] = useState({ ...initial, bankName: initial.bankName ?? '', bankAccountName: initial.bankAccountName ?? '', bankAccountNumber: initial.bankAccountNumber ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<'saved' | 'nothing' | null>(null);
  const bad = badFields(error);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [key]: value }));
  const num = (key: 'graceDays' | 'draftOffsetDays' | 'schedulerHour' | 'briefingHour' | 'stagnantDays' | 'approvalTtlHours', min: number, max: number, label: Parameters<typeof t>[0], help: Parameters<typeof t>[0]) => (
    <FormField label={t(label)} help={t(help)} error={bad[key] ? t('errValidation') : null}>
      <NumberInput value={v[key]} onChange={(n) => set(key, n ?? 0)} min={min} max={max} disabled={!canEdit} />
    </FormField>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { currency: _currency, ...body } = v;
      const r = await api<{ changed: string[] }>('POST', '/api/settings/org', body);
      setDone(r.changed.length ? 'saved' : 'nothing');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Section title={t('orgSectionGeneral')}>
        <FormField label={t('orgName')} required error={bad.name ? t('errValidation') : null}>
          <TextInput value={v.name} onChange={(e) => set('name', e.currentTarget.value)} maxLength={120} disabled={!canEdit} />
        </FormField>
        <FormField label={t('orgTimezone')} help={t('orgTimezoneHelp')} error={bad.timezone ? t('errValidation') : null}>
          <TextInput value={v.timezone} onChange={(e) => set('timezone', e.currentTarget.value)} maxLength={60} disabled={!canEdit} />
        </FormField>
        <FormField label={t('orgLocale')}>
          <SelectMenu value={v.locale} onChange={(x) => set('locale', x as 'id' | 'en')} searchable={false} disabled={!canEdit} options={[{ value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} />
        </FormField>
        <FormField label={t('orgCurrency')} help={t('orgCurrencyHelp')}>
          <TextInput value={v.currency} disabled readOnly />
        </FormField>
      </Section>
      <Section title={t('orgSectionBilling')}>
        <FormField label={t('orgNumberFormat')} help={t('orgNumberFormatHelp')} error={bad.invoiceNumberFormat ? t('errValidation') : null}>
          <TextInput value={v.invoiceNumberFormat} onChange={(e) => set('invoiceNumberFormat', e.currentTarget.value)} maxLength={40} disabled={!canEdit} />
        </FormField>
        <FormField label={t('orgTax')} help={t('orgTaxHelp')} error={bad.taxRateBps ? t('errValidation') : null}>
          <NumberInput value={v.taxRateBps / 100} onChange={(n) => set('taxRateBps', Math.round((n ?? 0) * 100))} min={0} max={100} step={0.01} disabled={!canEdit} />
        </FormField>
        {num('graceDays', 0, 365, 'orgGraceDays', 'orgGraceDaysHelp')}
        {num('draftOffsetDays', 0, 90, 'orgDraftOffset', 'orgDraftOffsetHelp')}
        <FormField label={t('orgBankName')} help={t('orgBankHelp')}>
          <TextInput value={v.bankName} onChange={(e) => set('bankName', e.currentTarget.value)} maxLength={80} disabled={!canEdit} />
        </FormField>
        <FormField label={t('orgBankAccountName')}>
          <TextInput value={v.bankAccountName} onChange={(e) => set('bankAccountName', e.currentTarget.value)} maxLength={120} disabled={!canEdit} />
        </FormField>
        <FormField label={t('orgBankAccountNumber')}>
          <TextInput value={v.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.currentTarget.value)} maxLength={40} inputMode="numeric" disabled={!canEdit} />
        </FormField>
      </Section>
      <Section title={t('orgSectionAutomation')}>
        {num('schedulerHour', 0, 23, 'orgSchedulerHour', 'orgSchedulerHourHelp')}
        {num('briefingHour', 0, 23, 'orgBriefingHour', 'orgBriefingHourHelp')}
        {num('stagnantDays', 1, 365, 'orgStagnantDays', 'orgStagnantDaysHelp')}
        {num('approvalTtlHours', 1, 720, 'orgApprovalTtl', 'orgApprovalTtlHelp')}
      </Section>
      <Panel className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('orgSectionAi')}</h2>
        <p className="m-0 max-w-prose text-sm text-muted">{t('orgAiBudgetHelp')}</p>
        <a href="/app/ai?tab=budget" className={buttonClasses('secondary') + ' self-start'}>{t('orgAiBudgetLink')}</a>
      </Panel>
      <AutonomyCard canEdit={canEdit} />
      {error !== null && !Object.keys(bad).length && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
      {Object.keys(bad).length > 0 && <ErrorBox>{t('errValidation')}</ErrorBox>}
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={busy}>{t('orgSave')}</Button>
          {done && <span role="status" className="text-sm text-success">{done === 'saved' ? t('orgSaved') : t('orgNothing')}</span>}
        </div>
      )}
    </form>
  );
}
