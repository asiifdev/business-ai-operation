import { useState, type FormEvent } from 'react';
import { api, badFields, errorKey } from '../../lib/api-client';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export interface NewClient {
  id: string;
  name: string;
}

/**
 * Adds a client from inside another form (an invoice, a subscription, a task) so nobody has to leave the page and lose
 * what they typed. The client is the same record the Clients page makes; on success the caller selects it.
 */
export function QuickClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (client: NewClient) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // this form sits inside another one in the React tree; its submit must not reach it
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('POST', '/api/clients', { name, contactName, email, phone });
      onCreated({ id: created.id, name: name.trim() });
      setName('');
      setContactName('');
      setEmail('');
      setPhone('');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('quickClientTitle')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label={t('fName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
          <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} required autoComplete="off" />
        </FormField>
        <FormField label={t('fContact')} showOptional>
          <TextInput value={contactName} onChange={(e) => setContactName(e.currentTarget.value)} maxLength={120} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('fEmail')} showOptional error={bad.email ? t('errValidation') : null}>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} maxLength={254} autoComplete="off" />
          </FormField>
          <FormField label={t('fPhone')} showOptional>
            <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} maxLength={40} autoComplete="off" />
          </FormField>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy}>{t('quickClientSave')}</Button>
          <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        </div>
      </form>
    </Modal>
  );
}
