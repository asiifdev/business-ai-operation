import { useState } from 'react';
import { api, errorKey, upload } from '../../lib/api-client';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { FileInput } from '../forms/FileInput';
import { ConfirmButton } from '../ui/ConfirmButton';

import type { MessageKey } from '../../lib/i18n';

/** Where a suggested product version came from, in words. */
export const SOURCE_LABEL: Record<'release' | 'tag' | 'commit', MessageKey> = { release: 'pVersionSourceRelease', tag: 'pVersionSourceTag', commit: 'pVersionSourceCommit' };

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** The product's logo, or its first letter when it has none (or the picture cannot load). Decorative: the name beside it says what it is. */
export function ProductLogo({ id, name, hasLogo, size = 'md', version = 0 }: { id: string; name: string; hasLogo: boolean; size?: 'sm' | 'md' | 'lg'; version?: number }) {
  const [broken, setBroken] = useState(false);
  const box = size === 'lg' ? 'size-16 text-2xl' : size === 'md' ? 'size-10 text-base' : 'size-8 text-sm';
  if (hasLogo && !broken) return <img src={`/api/products/${id}/logo?v=${version}`} alt="" onError={() => setBroken(true)} className={cx('shrink-0 rounded-input border border-rule-2 bg-paper object-contain', box)} />;
  return <span aria-hidden="true" className={cx('grid shrink-0 place-items-center rounded-input bg-accent-wash font-display font-semibold text-accent', box)}>{(name.trim()[0] ?? '?').toUpperCase()}</span>;
}

/** Sets, replaces or removes the logo of an existing product. The picture goes up as soon as it is chosen. */
export function LogoEditor({ productId, name, hasLogo, onChanged }: { productId: string; name: string; hasLogo: boolean; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      await upload(`/api/products/${productId}/logo`, form);
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setError(/validation/.test(String((err as { code?: string }).code)) ? t('pLogoBad') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/api/products/${productId}/logo`);
      onChanged();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ProductLogo id={productId} name={name} hasLogo={hasLogo} size="lg" version={version} />
        {hasLogo && <ConfirmButton message={t('cfmRemoveLogo')} variant="danger" busy={busy} onConfirm={remove}>{t('pLogoRemove')}</ConfirmButton>}
      </div>
      <FileInput accept={LOGO_TYPES} maxSize={LOGO_MAX_BYTES} disabled={busy} onChange={(files) => files[0] && void send(files[0])} onReject={() => setError(t('pLogoBad'))} />
      <p className="m-0 text-sm text-muted">{t('pLogoHelp')}</p>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}
