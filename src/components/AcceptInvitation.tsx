import { useState, type FormEvent } from 'react';
import type { MessageKey } from '../lib/i18n';
import { useT } from '../lib/use-t';
import { FormField } from './forms/FormField';
import { TextInput } from './forms/TextInput';
import { Button, buttonClasses } from './ui/Button';
import { LocaleSwitch } from './ui/LocaleSwitch';
import { ThemeToggle } from './ui/ThemeToggle';

const ROLE: Record<string, MessageKey> = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' };

type Props =
  | { state: 'valid'; token: string; organizationName: string; email: string; name: string | null; role: string }
  | { state: 'expired' | 'used' | 'invalid' };

/** The page behind the emailed link: the person chooses their name and password and is signed in. A dead link says why. */
export function AcceptInvitation(props: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (props.state !== 'valid') return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: props.token, name: form.get('name'), password: form.get('password') }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        window.location.assign('/app');
        return;
      }
      const code = data?.error?.code as string | undefined;
      if (res.status === 429 || code === 'rate_limited') setError(t('rateLimited'));
      else if (code === 'expired' || code === 'not_found') setError(t('invExpired'));
      else if (code === 'email_taken') setError(t('emailTaken'));
      else if (code === 'validation') {
        const bad: string[] = data?.error?.fields ?? [];
        setFields(Object.fromEntries(bad.map((f) => [f, f === 'password' ? t('passwordTooShort') : t('fieldInvalid')])));
        if (bad.length === 0) setError(t('genericError'));
      } else setError(t('genericError'));
    } catch {
      setError(t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-end gap-2">
        <LocaleSwitch />
        <ThemeToggle />
      </div>
      <div className="rounded-card border border-rule bg-paper p-6 shadow-card">
        {props.state === 'valid' ? (
          <>
            <h1 className="m-0 text-2xl font-semibold text-ink">{t('invTitle', { org: props.organizationName })}</h1>
            <p className="mt-1 mb-0 text-sm text-muted">{t('invIntro', { email: props.email, role: t(ROLE[props.role] ?? 'roleStaff') })}</p>
            <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
              <FormField label={t('nameLabel')} required error={fields.name}>
                <TextInput name="name" defaultValue={props.name ?? ''} autoComplete="name" required />
              </FormField>
              <FormField label={t('passwordLabel')} required help={t('passwordHelp')} error={fields.password}>
                <TextInput name="password" type="password" autoComplete="new-password" required />
              </FormField>
              {error && <p role="alert" className="m-0 rounded-input border border-danger bg-danger-wash p-3 text-sm text-danger">{error}</p>}
              <Button type="submit" variant="primary" loading={busy}>{busy ? t('invAccepting') : t('invAccept')}</Button>
            </form>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <p role="alert" className="m-0 text-ink">{t(props.state === 'expired' ? 'invExpired' : props.state === 'used' ? 'invUsed' : 'invInvalid')}</p>
            <a href="/login" className={buttonClasses('primary')}>{t('signIn')}</a>
          </div>
        )}
      </div>
    </main>
  );
}
