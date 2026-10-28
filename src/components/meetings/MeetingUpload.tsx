import { useState, type FormEvent } from 'react';
import { MAX_UPLOAD_BYTES } from '../../domain/meetings/rules';
import { ApiError, errorKey, upload } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Checkbox } from '../forms/Checkbox';
import { FileInput } from '../forms/FileInput';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';

const ACCEPT = ['audio/*', 'video/webm'] as const;

/** Server reasons for a refused file (`file:<reason>`), in plain words (BRD-M09 section 10). */
const FILE_REASON: Record<string, MessageKey> = { 'file:format': 'mtErrUnreadable', 'file:size': 'mtFileHelp', 'file:empty': 'mtNeedFile' };

/**
 * Upload one recording (PRD M09 `/app/rapat/baru`). The consent box is required (BR-M09-11). The server checks the file's
 * real format; the browser check here only saves a wasted upload.
 */
export function MeetingUpload() {
  const t = useT();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError(t('mtNeedFile'));
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('title', title);
    form.set('consent', String(consent));
    form.set('file', file);
    try {
      const { id } = await upload<{ id: string }>('/api/meetings', form);
      window.location.assign(`/app/rapat/${id}`);
    } catch (err) {
      const reason = err instanceof ApiError ? err.fields.find((f) => f.startsWith('file:')) : undefined;
      setError(t(reason ? FILE_REASON[reason] ?? 'mtErrUnreadable' : errorKey(err)));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <a href="/app/rapat" className="w-fit text-sm text-accent underline underline-offset-4">{t('mtBack')}</a>
      <PageHeader title={t('mtUploadTitle')} intro={t('mtUploadIntro')} />
      <Panel>
        <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-5">
          <FormField label={t('fMeetingTitle')} required>
            <TextInput value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={160} required autoComplete="off" />
          </FormField>
          <FormField label={t('mtFileLabel')} help={t('mtFileHelp')} required>
            <FileInput accept={ACCEPT} maxSize={MAX_UPLOAD_BYTES} onChange={(files) => setFile(files[0] ?? null)} disabled={busy} />
          </FormField>
          <Checkbox label={t('mtConsent')} description={t('mtConsentHelp')} checked={consent} onChange={setConsent} disabled={busy} />
          {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" className="w-fit" loading={busy} disabled={!consent || title.trim().length < 2 || !file}>{t('mtUpload')}</Button>
        </form>
      </Panel>
    </div>
  );
}
