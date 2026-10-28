import { useState } from 'react';
import type { TelegramStatus } from '../../domain/telegram/links';
import { api, errorKey } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';

type Status = Jsonify<TelegramStatus> & { enabled: boolean };
type Code = { code: string; link: string; expiresAt: string };

/**
 * Linking the person's own Telegram (PRD section 6): a one-time deep link valid 10 minutes, the current state, and
 * unlinking. The code is shown once and never stored in plain form.
 */
export function TelegramSettings({ timezone }: { timezone: string }) {
  const t = useT();
  const load = useLoad(() => api<Status>('GET', '/api/telegram/link'), []);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState<'code' | 'unlink' | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(key: 'code' | 'unlink', fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const createCode = () => run('code', async () => setCode(await api<Code>('POST', '/api/telegram/link')));
  const unlink = () => run('unlink', async () => {
    await api('DELETE', '/api/telegram/link');
    setCode(null);
    await load.reload();
  });
  const bot = code ? new URL(code.link).pathname.slice(1) : '';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('tgPageTitle')} intro={t('tgPageIntro')} />
      {load.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={3} /></Panel>}
      {load.value.state === 'error' && <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>}
      {load.value.state === 'ready' && (
        <Panel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {load.value.data.linked ? (
              <Badge tone="success">{load.value.data.username ? t('tgStateLinkedAs', { username: load.value.data.username }) : t('tgStateLinked')}</Badge>
            ) : (
              <Badge>{t('tgStateNot')}</Badge>
            )}
            {load.value.data.linked && load.value.data.linkedAt && <span className="text-sm text-muted">{t('tgLinkedSince', { when: formatDateTime(load.value.data.linkedAt, timezone) })}</span>}
          </div>
          <p className="m-0 max-w-prose text-ink-2">{t('tgWhatYouGet')}</p>

          {!load.value.data.enabled ? (
            <p className="m-0 text-sm text-warm-ink">{t('tgNotConfigured')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {code && (
                <div className="flex max-w-xl flex-col gap-3 rounded-card border border-dashed border-accent p-4">
                  <p className="m-0 text-sm text-ink">{t('tgCodeHelp', { when: formatDateTime(code.expiresAt, timezone) })}</p>
                  <a href={code.link} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary') + ' w-fit'}>{t('tgOpenBot')}</a>
                  <p className="m-0 text-sm text-muted">{t('tgCodeManual', { bot })}</p>
                  <code className="w-fit rounded bg-paper-2 px-2 py-1 font-mono text-sm break-all text-ink">/start {code.code}</code>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant={code ? 'secondary' : 'primary'} loading={busy === 'code'} disabled={busy !== null} onClick={createCode}>
                  {code || load.value.data.linked ? t('tgNewCode') : t('tgCreateCode')}
                </Button>
                {load.value.data.linked && <ConfirmButton variant="danger" busy={busy === 'unlink'} disabled={busy !== null} onConfirm={unlink}>{t('tgUnlinkButton')}</ConfirmButton>}
              </div>
            </div>
          )}
          {error != null && <p role="alert" className="m-0 text-sm text-danger">{t(errorKey(error))}</p>}
        </Panel>
      )}
    </div>
  );
}
