import { useState, type FormEvent } from 'react';
import { api, badFields, errorKey } from '../../lib/api-client';
import { formatDate, formatDateTime } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import { toast } from '../../lib/toast-bus';
import { useT, useLocale } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { ErrorBox } from '../ui/states';

type RoleName = 'owner' | 'admin' | 'staff';
const ROLE_LABEL: Record<RoleName, MessageKey> = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' };

export interface InviteResult {
  id: string;
  emailed: boolean;
  status: 'sent' | 'failed' | 'not_configured';
  link: string | null;
}

/** When the email did not go out, the inviter gets the link here to hand over personally. */
export function LinkNotice({ email, result }: { email: string; result: InviteResult }) {
  const t = useT();
  if (result.emailed) return <p role="status" className="m-0 text-sm text-success">{t('usersInviteSent', { email })}</p>;
  const absolute = result.link && result.link.startsWith('/') ? `${window.location.origin}${result.link}` : result.link;
  async function copy() {
    try {
      await navigator.clipboard.writeText(absolute ?? '');
      toast(t('usersLinkCopied'), 'success');
    } catch {
      // The link is shown in full below, so it can still be selected by hand.
    }
  }
  return (
    <div role="status" className="flex flex-col gap-2 rounded-card border border-rule p-3">
      <p className="m-0 text-sm text-ink">{t(result.status === 'failed' ? 'usersInviteFailed' : 'usersInviteNoEmail', { email })}</p>
      <code className="text-xs break-all text-ink-2">{absolute}</code>
      <div><Button size="sm" onClick={copy}>{t('usersCopyLink')}</Button></div>
    </div>
  );
}

/** Invite a colleague by email: address, optional name, role. The person chooses their own password from the link. */
export function InviteForm({ roles, onInvited, onCancel }: { roles: RoleName[]; onInvited: (email: string, result: InviteResult) => void; onCancel?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<RoleName>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const taken = error !== null && (error as { code?: string }).code === 'email_taken';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<InviteResult>('POST', '/api/users/invite', { email, name, role, locale });
      onInvited(email.trim().toLowerCase(), result);
      setEmail('');
      setName('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 max-w-prose text-sm text-muted">{t('usersInviteHelp')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('usersEmail')} required error={bad.email ? t('errValidation') : taken ? t(errorKey(error)) : null}>
          <TextInput type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} maxLength={254} autoComplete="off" />
        </FormField>
        <FormField label={t('usersInviteName')} error={bad.name ? t('errValidation') : null}>
          <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} autoComplete="off" />
        </FormField>
        <FormField label={t('usersRole')} required>
          <SelectMenu value={role} onChange={(v) => setRole(v as RoleName)} searchable={false} options={roles.map((v) => ({ value: v, label: t(ROLE_LABEL[v]) }))} />
        </FormField>
      </div>
      {error !== null && !Object.keys(bad).length && !taken && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
      <div className="flex gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!email.includes('@')}>{t('usersInviteSend')}</Button>
        {onCancel && <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>}
      </div>
    </form>
  );
}

export interface PendingRow {
  id: string;
  email: string;
  name: string | null;
  role: RoleName;
  expiresAt: string;
  sendStatus: 'sent' | 'failed' | 'not_configured';
  status: 'waiting' | 'expired' | 'accepted';
  acceptedAt: string | null;
  /** While set, the mail went out recently and cannot be sent again before this moment. */
  resendAt: string | null;
}

/** Every invitation with where it stands: waiting, expired or accepted. A waiting one can be sent again (after two hours) or withdrawn. */
export function PendingInvitations({ rows, timezone, onChanged }: { rows: PendingRow[]; timezone: string; onChanged: () => void }) {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; email: string; result: InviteResult } | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }
  const resend = (row: PendingRow) => run(row.id, async () => {
    const result = await api<InviteResult>('POST', `/api/users/invitations/${row.id}/resend`);
    setNotice({ id: row.id, email: row.email, result });
    if (result.emailed) toast(t('usersResent'), 'success');
  });
  const revoke = (row: PendingRow) => run(row.id, async () => {
    await api('DELETE', `/api/users/invitations/${row.id}`);
  });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-ink">{t('usersPending')}</h2>
      {error !== null && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-card border border-rule px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-medium text-ink [overflow-wrap:anywhere]">{r.name ? `${r.name} · ` : ''}{r.email}</p>
                <p className="m-0 text-sm text-muted">
                  {t(ROLE_LABEL[r.role])} · {r.status === 'accepted' && r.acceptedAt ? t('usersInvAccepted', { date: formatDateTime(r.acceptedAt, timezone) }) : r.status === 'expired' ? t('usersPendingExpired') : t('usersPendingUntil', { date: formatDate(r.expiresAt.slice(0, 10)) })}
                </p>
                {r.status !== 'accepted' && r.resendAt && <p className="m-0 text-xs text-muted">{t('usersResendAt', { time: formatDateTime(r.resendAt, timezone) })}</p>}
              </div>
              {r.status === 'accepted' && <Badge tone="success">{t('usersInvStatusAccepted')}</Badge>}
              {r.status === 'expired' && <Badge tone="warn">{t('usersPendingExpired')}</Badge>}
              {r.status === 'waiting' && <Badge tone="neutral">{t('usersInvStatusWaiting')}</Badge>}
              {r.status !== 'accepted' && r.sendStatus !== 'sent' && <Badge tone="warn">{t('usersPendingNotSent')}</Badge>}
              {r.status !== 'accepted' && (
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => void resend(r)} loading={busyId === r.id} disabled={Boolean(r.resendAt)}>{t('usersResend')}</Button>
                  <ConfirmButton message={t('cfmRevokeInvitation')} variant="danger" busy={busyId === r.id} onConfirm={() => revoke(r)}>{t('usersRevoke')}</ConfirmButton>
                </span>
              )}
            </div>
            {notice?.id === r.id && <LinkNotice email={notice.email} result={notice.result} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
