import { useState, type FormEvent } from 'react';
import { api, badFields, errorKey } from '../../lib/api-client';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';
import { LocaleSwitch } from '../ui/LocaleSwitch';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox } from '../ui/states';

/** Own password and language. Someone who still has the temporary password lands here first (BRD-M01). */
export function ProfilePage({ mustChange }: { mustChange: boolean }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const bad = badFields(error);
  const mismatch = again !== '' && again !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api('POST', '/api/profile/password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
      if (mustChange) window.location.assign('/app');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('profileTitle')} intro={mustChange ? t('profileMustChange') : t('profileIntro')} />
      <Panel>
        <form onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
          <FormField label={t('profileCurrent')} required>
            <TextInput type="password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} maxLength={128} autoComplete="current-password" />
          </FormField>
          <FormField label={t('profileNew')} required help={t('profileNewHelp')} error={bad.newPassword ? t('profileSame') : null}>
            <TextInput type="password" value={next} onChange={(e) => setNext(e.currentTarget.value)} maxLength={128} autoComplete="new-password" />
          </FormField>
          <FormField label={t('profileConfirm')} required error={mismatch ? t('profileMismatch') : null}>
            <TextInput type="password" value={again} onChange={(e) => setAgain(e.currentTarget.value)} maxLength={128} autoComplete="new-password" />
          </FormField>
          {error !== null && !bad.newPassword && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 10 || mismatch || !again}>{t('profileSave')}</Button>
            {done && <span role="status" className="text-sm text-success">{t('profileSaved')}</span>}
          </div>
        </form>
      </Panel>
      <Panel className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('profileLanguage')}</h2>
        <div><LocaleSwitch /></div>
      </Panel>
    </div>
  );
}
