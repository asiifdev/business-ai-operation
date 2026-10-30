import { useState, type FormEvent } from 'react';
import type { listUsers } from '../../domain/users/service';
import { api, badFields, errorKey } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';

type Row = Jsonify<Awaited<ReturnType<typeof listUsers>>[number]>;
type RoleName = 'owner' | 'admin' | 'staff';
const ROLE_LABEL: Record<RoleName, MessageKey> = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' };

/** Colleagues and their roles (BRD-M01). Only an Owner can hand out or take away the Owner role. */
export function UsersPage({ currentUserId, isOwner }: { currentUserId: string; isOwner: boolean }) {
  const t = useT();
  const list = useLoad(() => api<{ users: Row[] }>('GET', '/api/users'), []);
  const [adding, setAdding] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; error: unknown } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const roles = (isOwner ? ['owner', 'admin', 'staff'] : ['admin', 'staff']) as RoleName[];
  const roleOptions = (r: RoleName[]) => r.map((v) => ({ value: v, label: t(ROLE_LABEL[v]) }));

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setRowError(null);
    try {
      await fn();
      await list.reload();
    } catch (error) {
      setRowError({ id, error });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('usersTitle')} intro={t('usersIntro')} action={!adding ? <Button variant="primary" onClick={() => setAdding(true)}>{t('usersAdd')}</Button> : undefined} />
      {adding && <AddUser roles={roles} onDone={() => { setAdding(false); void list.reload(); }} onCancel={() => setAdding(false)} />}
      <Panel aria-busy={list.value.state === 'loading'}>
        {list.value.state === 'loading' && <Skeleton rows={5} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[44rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('usersName')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('usersRole')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('usersColJoined')}</th>
                  <th scope="col" className="py-2 font-medium"><span className="sr-only">{t('usersDeactivate')}</span></th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {list.value.data.users.map((u) => {
                  // An Admin cannot touch an Owner at all, so that row is plain text for them.
                  const locked = u.role === 'owner' && !isOwner;
                  return (
                    <tr key={u.id} role="row" className={tbl.row}>
                      <td data-label={t('usersName')} className={`py-3 pr-3 ${tbl.label} ${tbl.full}`}>
                        <span className="font-medium text-ink">{u.name}</span>
                        {u.id === currentUserId && <Badge className="ml-2" tone="accent">{t('usersYou')}</Badge>}
                        {!u.isActive && <Badge className="ml-2" tone="warn">{t('usersInactive')}</Badge>}
                        <div className="text-sm text-muted">{u.email}</div>
                        {rowError?.id === u.id && <div className="mt-1 text-sm text-danger" role="alert">{t(errorKey(rowError.error))}</div>}
                      </td>
                      <td data-label={t('usersRole')} className={`py-3 pr-3 ${tbl.label}`}>
                        {locked || !u.isActive ? t(ROLE_LABEL[u.role]) : (
                          <div className="min-w-36"><SelectMenu value={u.role} searchable={false} options={roleOptions(roles)} onChange={(v) => v !== u.role && act(u.id, () => api('PATCH', `/api/users/${u.id}`, { role: v }))} disabled={busyId === u.id} /></div>
                        )}
                      </td>
                      <td data-label={t('usersColJoined')} className={`py-3 pr-3 ${tbl.label}`}>{formatDate(u.createdAt.slice(0, 10))}</td>
                      <td className="py-3 sm:text-right">
                        {u.isActive && !locked && <ConfirmButton message={t('cfmDeactivateUser')} variant="danger" busy={busyId === u.id} onConfirm={() => act(u.id, () => api('POST', `/api/users/${u.id}/deactivate`))}>{t('usersDeactivate')}</ConfirmButton>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AddUser({ roles, onDone, onCancel }: { roles: RoleName[]; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleName>('staff');
  const [password, setPassword] = useState('');
  const [locale, setLocale] = useState('id');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/users', { name, email, role, password, locale });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('usersName')} required error={bad.name ? t('errValidation') : null}>
            <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} autoComplete="off" />
          </FormField>
          <FormField label={t('usersEmail')} required error={bad.email ? t('errValidation') : null}>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} maxLength={254} autoComplete="off" />
          </FormField>
          <FormField label={t('usersRole')} required>
            <SelectMenu value={role} onChange={(v) => setRole(v as RoleName)} searchable={false} options={roles.map((v) => ({ value: v, label: t(ROLE_LABEL[v]) }))} />
          </FormField>
          <FormField label={t('usersLanguage')}>
            <SelectMenu value={locale} onChange={setLocale} searchable={false} options={[{ value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} />
          </FormField>
          <FormField label={t('usersInitialPassword')} required help={t('usersInitialPasswordHelp')} error={bad.password ? t('errValidation') : null}>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} maxLength={128} autoComplete="new-password" />
          </FormField>
        </div>
        {error !== null && !Object.keys(bad).length && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
        <div className="flex gap-3">
          <Button type="submit" variant="primary" loading={busy}>{t('usersCreate')}</Button>
          <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
        </div>
      </form>
    </Panel>
  );
}
