import { useEffect, useState, type FormEvent } from 'react';
import type { ConnectionView, TestResult } from '../../domain/connections/service';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { NumberInput } from '../forms/NumberInput';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';

type Conn = Jsonify<ConnectionView>;
type Kind = 'github' | 'ssh' | 'aapanel';

const KIND_LABEL: Record<Kind, MessageKey> = { github: 'connKindGithub', ssh: 'connKindSsh', aapanel: 'connKindAapanel' };
const FAIL: Record<string, MessageKey> = {
  unreachable: 'connErrUnreachable',
  host_key_mismatch: 'connErrHostKeyMismatch',
  auth_failed: 'connErrAuthFailed',
  bad_key: 'connErrBadKey',
  timeout: 'connErrTimeout',
  rejected: 'connErrRejected',
  unexpected: 'connErrUnexpected',
  unauthorized: 'connErrUnauthorized',
  not_found: 'connErrNotFound',
  rate_limited: 'connErrRateLimited',
  not_configured: 'connErrNotConfigured',
};
const SOON: MessageKey[] = ['connKindCyberpanel', 'connKindCpanel'];

/** The organization's connections: GitHub, SSH and aaPanel, each standing on its own. Only the owner changes them; no secret is ever shown. */
interface Verification {
  token: string;
  installations: Array<{ id: number; account: string }>;
}

export function ConnectionsPage({ canWrite, githubReady, githubSlug, verification, githubError, githubLinked }: { canWrite: boolean; githubReady: boolean; githubSlug: string | null; verification: Verification | null; githubError: string | null; githubLinked: boolean }) {
  const t = useT();
  const list = useLoad(() => api<{ connections: Conn[] }>('GET', '/api/connections'), []);
  const [adding, setAdding] = useState<Kind | null>(verification || githubError ? 'github' : null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('connTitle')} intro={t('connIntro')} />
      {!canWrite && <p className="m-0 text-sm text-muted">{t('connOwnerOnly')}</p>}
      {githubLinked && <p role="status" className="m-0 text-sm text-success">{t('connGithubLinked')}</p>}
      {canWrite && (
        <Panel className="flex flex-wrap items-center gap-2" aria-label={t('connAdd')}>
          {(['github', 'ssh', 'aapanel'] as const).map((k) => (
            <Button key={k} size="sm" variant={adding === k ? 'primary' : 'secondary'} onClick={() => setAdding(adding === k ? null : k)}>
              <Icon name="plus" className="size-4" />
              {t(KIND_LABEL[k])}
            </Button>
          ))}
          {SOON.map((k) => (
            <Button key={k} size="sm" disabled aria-label={`${t(k)}: ${t('connComingSoon')}`}>
              {t(k)} · {t('connComingSoon')}
            </Button>
          ))}
        </Panel>
      )}
      {canWrite && adding && <AddForm kind={adding} githubReady={githubReady} githubSlug={githubSlug} verification={verification} githubError={githubError} onDone={() => { setAdding(null); void list.reload(); }} />}

      {list.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={3} /></Panel>}
      {list.value.state === 'error' && <Panel><ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox></Panel>}
      {list.value.state === 'ready' && list.value.data.connections.length === 0 && <EmptyState>{t('connEmpty')}</EmptyState>}
      {list.value.state === 'ready' &&
        list.value.data.connections.map((c) => <ConnectionCard key={c.id} c={c} canWrite={canWrite} onChange={() => list.reload()} />)}
    </div>
  );
}

function StatusBadge({ status }: { status: Conn['testStatus'] }) {
  const t = useT();
  return <Badge tone={status === 'ok' ? 'success' : status === 'failed' ? 'danger' : 'neutral'}>{t(status === 'ok' ? 'connStatusOk' : status === 'failed' ? 'connStatusFailed' : 'connStatusUntested')}</Badge>;
}

function ConnectionCard({ c, canWrite, onChange }: { c: Conn; canWrite: boolean; onChange: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  async function test(acceptHostKey?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Jsonify<TestResult>>('POST', `/api/connections/${c.id}/test`, acceptHostKey ? { acceptHostKey } : {});
      setFingerprint(r.status === 'needs_host_key' ? r.fingerprint : null);
      await onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const failure = c.testStatus === 'failed' && c.testMessage ? t(FAIL[c.testMessage] ?? 'connErrFailed') : null;
  const where = c.kind === 'ssh' ? `${String(c.config.username)}@${String(c.config.host)}:${String(c.config.port)}` : c.kind === 'aapanel' ? String(c.config.url) : c.config.account ? `@${String(c.config.account)}` : `#${String(c.config.installationId)}`;
  return (
    <Panel className="flex flex-col gap-3" aria-label={c.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
            {c.name}
            <StatusBadge status={c.testStatus} />
          </h2>
          <p className="mt-1 mb-0 text-sm text-muted">
            {t(KIND_LABEL[c.kind])} · <span className="font-mono">{where}</span>
            {c.hasSecret && c.secretHint ? ` · ${t('connSecretHint', { hint: c.secretHint })}` : ''}
          </p>
          {c.hostKeyFingerprint && <p className="mt-1 mb-0 font-mono text-xs text-muted [overflow-wrap:anywhere]">{t('connFingerprint')}: {c.hostKeyFingerprint}</p>}
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => test()} loading={busy}>{busy ? t('connTesting') : t('connTest')}</Button>
            <ConfirmButton variant="danger" busy={busy} onConfirm={async () => { setBusy(true); try { await api('DELETE', `/api/connections/${c.id}`); await onChange(); } catch (e) { setError(e); } finally { setBusy(false); } }}>{t('connDelete')}</ConfirmButton>
          </div>
        )}
      </div>
      {failure && <p role="status" className="m-0 text-sm text-danger">{failure}</p>}
      {error ? <p role="alert" className="m-0 text-sm text-danger">{t(errorKey(error))}</p> : null}
      {fingerprint && (
        <div className="flex flex-col gap-2 rounded-input border border-rule p-3">
          <p className="m-0 text-sm text-ink">{t('connConfirmHostKeyHelp')}</p>
          <code className="font-mono text-sm text-ink [overflow-wrap:anywhere]">{fingerprint}</code>
          <div><Button size="sm" variant="primary" loading={busy} onClick={() => test(fingerprint)}>{t('connConfirmHostKey')}</Button></div>
        </div>
      )}
    </Panel>
  );
}

function AddForm({ kind, githubReady, githubSlug, verification, githubError, onDone }: { kind: Kind; githubReady: boolean; githubSlug: string | null; verification: Verification | null; githubError: string | null; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number | null>(22);
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'private_key' | 'key_and_password'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tlsInsecure, setTlsInsecure] = useState(false);
  const [installation, setInstallation] = useState(verification?.installations[0] ? String(verification.installations[0].id) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  useEffect(() => setError(null), [kind]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      kind === 'github'
        ? { kind, installationId: Number(installation), verification: verification?.token ?? '' }
        : kind === 'ssh'
          ? { kind, name, host, port: port ?? 22, username, authMethod, ...(authMethod !== 'private_key' ? { password } : {}), ...(authMethod !== 'password' ? { privateKey, ...(passphrase ? { passphrase } : {}) } : {}) }
          : { kind, name, url, apiKey, tlsInsecure };
    try {
      await api('POST', '/api/connections', body);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const generic = error && !Object.keys(bad).length ? t(errorKey(error)) : null;
  return (
    <form onSubmit={submit} noValidate>
      <Panel className="flex max-w-3xl flex-col gap-4" aria-label={t(KIND_LABEL[kind])}>
        <h2 className="m-0 text-lg font-semibold text-ink">{t(KIND_LABEL[kind])}</h2>
        {kind !== 'github' && (
          <FormField label={t('fConnName')} required error={bad.name ? t('errValidation') : null}>
            <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} autoComplete="off" />
          </FormField>
        )}

        {kind === 'github' && (
          <>
            <p className="m-0 text-sm text-muted">{t('connGithubHelp')}</p>
            {githubError && <p role="status" className="m-0 text-sm text-danger">{t(githubError === 'cancelled' ? 'connGithubCancelled' : githubError === 'none' ? 'connGithubNone' : 'connGithubFailed')}</p>}
            {!githubReady && <p className="m-0 text-sm text-danger">{t('connErrNotConfigured')}</p>}
            {verification && verification.installations.length > 1 ? (
              <>
                <FormField label={t('connGithubChoose')}>
                  <SelectMenu value={installation} onChange={setInstallation} searchable={false} options={verification.installations.map((i) => ({ value: String(i.id), label: `@${i.account}` }))} />
                </FormField>
                <div><Button type="submit" variant="primary" loading={busy} disabled={!installation}>{t('connAdd')}</Button></div>
              </>
            ) : (
              githubReady && <div><a href="/api/github/start" className={buttonClasses('primary', 'sm')}>{t('connGithubConnect')}</a></div>
            )}
          </>
        )}

        {kind === 'ssh' && (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField label={t('fConnHost')} required error={bad.host ? t('connErrValidation') : null}>
                <TextInput value={host} onChange={(e) => setHost(e.currentTarget.value)} autoComplete="off" />
              </FormField>
              <FormField label={t('fConnPort')}>
                <NumberInput value={port} onChange={setPort} min={1} max={65535} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('fConnUser')} required error={bad.username ? t('errValidation') : null}>
                <TextInput value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoComplete="off" />
              </FormField>
              <FormField label={t('fConnAuth')}>
                <SelectMenu value={authMethod} onChange={(v) => setAuthMethod(v as typeof authMethod)} searchable={false} options={[{ value: 'password', label: t('connAuthPassword') }, { value: 'private_key', label: t('connAuthKey') }, { value: 'key_and_password', label: t('connAuthBoth') }]} />
              </FormField>
            </div>
            {authMethod !== 'private_key' && (
              <FormField label={t('fConnPassword')} required error={bad.password ? t('errValidation') : null}>
                <TextInput type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="off" />
              </FormField>
            )}
            {authMethod !== 'password' && (
              <>
                <FormField label={t('fConnPrivateKey')} required error={bad.privateKey ? t('errValidation') : null}>
                  <Textarea value={privateKey} onChange={(e) => setPrivateKey(e.currentTarget.value)} rows={5} spellCheck={false} autoComplete="off" />
                </FormField>
                <FormField label={t('fConnPassphrase')}>
                  <TextInput type="password" value={passphrase} onChange={(e) => setPassphrase(e.currentTarget.value)} autoComplete="off" />
                </FormField>
              </>
            )}
          </>
        )}

        {kind === 'aapanel' && (
          <>
            <p className="m-0 text-sm text-muted">{t('connPanelHelp')}</p>
            <FormField label={t('fConnUrl')} required error={bad.url ? t('connErrValidation') : null}>
              <TextInput value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://1.2.3.4:7800" autoComplete="off" />
            </FormField>
            <FormField label={t('fConnApiKey')} required error={bad.apiKey ? t('errValidation') : null}>
              <TextInput type="password" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} autoComplete="off" />
            </FormField>
            <Toggle label={t('fConnTlsInsecure')} description={t('connTlsInsecureHelp')} checked={tlsInsecure} onChange={setTlsInsecure} />
          </>
        )}

        {kind !== 'github' && <p className="m-0 text-xs text-muted">{t('connSecretNote')}</p>}
        {generic && <p role="alert" className="m-0 text-danger">{generic === t('errValidation') ? t('connErrValidation') : generic}</p>}
        {kind !== 'github' && (
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>{t('connAdd')}</Button>
          </div>
        )}
      </Panel>
    </form>
  );
}
