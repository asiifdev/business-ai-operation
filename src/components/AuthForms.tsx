import { useState, type FormEvent } from 'react';
import { useT } from '../lib/use-t';
import { Button } from './ui/Button';
import { FormField } from './forms/FormField';
import { TextInput } from './forms/TextInput';
import { LocaleSwitch } from './ui/LocaleSwitch';
import { ThemeToggle } from './ui/ThemeToggle';

type Mode = 'login' | 'register';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

/** Sign-in and registration forms. They call the API and never see passwords again after submit. */
export function AuthForms({ mode }: { mode: Mode }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isRegister = mode === 'register';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    const locale = document.documentElement.lang === 'en' ? 'en' : 'id';
    try {
      const email = String(form.get('email') ?? '');
      const password = String(form.get('password') ?? '');
      const result = isRegister
        ? await post('/api/register', { organizationName: form.get('organizationName'), name: form.get('name'), email, password, locale })
        : await post('/api/auth/sign-in/email', { email, password });

      if (result.ok) {
        window.location.assign('/app');
        return;
      }
      const code = result.data?.error?.code as string | undefined;
      if (result.status === 429 || code === 'rate_limited') setFormError(t('rateLimited'));
      else if (code === 'email_taken') setFieldErrors({ email: t('emailTaken') });
      else if (code === 'validation') {
        const bad: string[] = result.data?.error?.fields ?? [];
        setFieldErrors(Object.fromEntries(bad.map((f) => [f, f === 'password' ? t('passwordTooShort') : t('fieldInvalid')])));
        if (bad.length === 0) setFormError(t('genericError'));
      } else if (!isRegister && result.status >= 400 && result.status < 500) setFormError(t('loginFailed'));
      else setFormError(t('genericError'));
    } catch {
      setFormError(t('genericError'));
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
        <h1 className="m-0 text-2xl font-semibold text-ink">{isRegister ? t('registerTitle') : t('signInTitle')}</h1>
        {isRegister && <p className="mt-1 mb-0 text-sm text-muted">{t('registerIntro')}</p>}

        <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
          {isRegister && (
            <>
              <FormField label={t('organizationLabel')} required help={t('organizationHelp')} error={fieldErrors.organizationName}>
                <TextInput name="organizationName" autoComplete="organization" required />
              </FormField>
              <FormField label={t('nameLabel')} required error={fieldErrors.name}>
                <TextInput name="name" autoComplete="name" required />
              </FormField>
            </>
          )}
          <FormField label={t('emailLabel')} required error={fieldErrors.email}>
            <TextInput name="email" type="email" autoComplete="email" required />
          </FormField>
          <FormField label={t('passwordLabel')} required help={isRegister ? t('passwordHelp') : undefined} error={fieldErrors.password}>
            <TextInput name="password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} required />
          </FormField>

          {formError && (
            <p role="alert" className="m-0 rounded-input border border-danger bg-danger-wash p-3 text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy}>
            {isRegister ? (busy ? t('creatingAccount') : t('createAccount')) : busy ? t('signingIn') : t('signIn')}
          </Button>
        </form>

        <p className="mt-5 mb-0 text-sm text-muted">
          {isRegister ? t('haveAccount') : t('noAccount')}{' '}
          <a href={isRegister ? '/login' : '/register'} className="text-accent underline underline-offset-4">
            {isRegister ? t('signIn') : t('createAccount')}
          </a>
        </p>
      </div>
    </main>
  );
}
