import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, badFields, errorKey } from '../../lib/api-client';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export interface NewProduct {
  id: string;
  name: string;
}

/**
 * Adds a product from inside another form (a deployment, a task) so nobody leaves the page and loses what they typed.
 * Packages and prices are set on the product page afterwards, by a person (BR-M07-04).
 */
export function QuickProductModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (product: NewProduct) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [existing, setExisting] = useState<NewProduct | null>(null);
  const bad = badFields(error);

  // A taken name usually means the product is already there: offer to use it.
  useEffect(() => {
    setExisting(null);
    if (!(error instanceof ApiError && error.code === 'duplicate')) return;
    const wanted = name.trim().toLowerCase();
    api<{ products: NewProduct[] }>('GET', '/api/products').then(
      (res) => setExisting(res.products.find((p) => p.name.trim().toLowerCase() === wanted) ?? null),
      () => setExisting(null),
    );
  }, [error]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // this form sits inside another one in the React tree; its submit must not reach it
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('POST', '/api/products', { name, currentVersion });
      onCreated({ id: created.id, name: name.trim() });
      setName('');
      setCurrentVersion('');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('quickProductTitle')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label={t('fName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
          <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} required autoComplete="off" />
        </FormField>
        <FormField label={t('fVersion')} showOptional help={t('quickProductHelp')}>
          <TextInput value={currentVersion} onChange={(e) => setCurrentVersion(e.currentTarget.value)} maxLength={40} autoComplete="off" />
        </FormField>
        {existing && (
          <Button
            onClick={() => {
              onCreated(existing);
              setError(null);
              onClose();
            }}
          >
            {t('quickProductUseExisting')}
          </Button>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy}>{t('quickClientSave')}</Button>
          <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        </div>
      </form>
    </Modal>
  );
}
