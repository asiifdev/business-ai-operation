import { useEffect, useState } from 'react';
import { stamp } from '../../domain/meetings/rules';
import type { MeetingDetail as Detail } from '../../domain/meetings/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { MeetingStatusBadge, minutesOf } from './MeetingsPage';

type Meeting = Jsonify<Detail>;

const POLL_MS = 4000;

/** One recording: progress while it is processed, then the transcript by speaker, the minutes and the drafts (PRD M09). */
export function MeetingDetail({ id, timezone }: { id: string; timezone: string }) {
  const t = useT();
  const load = useLoad(() => api<Meeting>('GET', `/api/meetings/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const working = load.value.state === 'ready' && (load.value.data.status === 'uploaded' || load.value.data.status === 'processing') && !load.value.data.contentDeleted;

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load.reload(), POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;
  const m = load.value.data;
  const length = minutesOf(m.durationMs);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/rapat" className="w-fit text-sm text-accent underline underline-offset-4">{t('mtBack')}</a>
        <h1 className="m-0 flex min-w-0 flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
          <span className="[overflow-wrap:anywhere]">{m.title}</span>
          <MeetingStatusBadge status={m.status} contentDeleted={m.contentDeleted} />
        </h1>
        <p className="m-0 text-sm text-muted">
          {[m.createdByName, formatDateTime(m.createdAt, timezone), length != null ? t('mtMinutesShort', { n: length }) : null, m.source === 'telegram' ? t('mtSourceTelegram') : m.fileName].filter(Boolean).join(' · ')}
        </p>
        {error != null && <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p>}
      </header>

      {working && (
        <Panel aria-live="polite" className="flex flex-col gap-1">
          <p className="m-0 text-ink">{t(m.status === 'uploaded' ? 'mtProgressWaiting' : 'mtProgressRunning')}</p>
          {m.job && m.job.attempts > 1 && <p className="m-0 text-sm text-muted">{t('mtProgressAttempt', { n: m.job.attempts, max: m.job.maxAttempts })}</p>}
          {m.error && <p className="m-0 text-sm text-warm-ink">{m.error}</p>}
        </Panel>
      )}

      {m.status === 'failed' && !m.contentDeleted && (
        <Panel className="flex flex-col items-start gap-3">
          <h2 className="m-0 text-lg font-semibold text-danger">{t('mtFailed')}</h2>
          {m.error && <p className="m-0 max-w-prose text-ink">{m.error}</p>}
          {m.canChange && <Button loading={busy === 'retry'} disabled={busy !== null} onClick={() => act('retry', () => api('POST', `/api/meetings/${id}/retry`))}>{t('mtRetry')}</Button>}
        </Panel>
      )}

      {m.contentDeleted && <Panel><p className="m-0 text-ink">{t('mtDeletedNote')}</p></Panel>}

      {m.minutes && (
        <Panel aria-label={t('mtMinutes')} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-lg font-semibold text-ink">{t('mtMinutes')}</h2>
            {m.minutes.isAiDraft && <Badge tone="accent">{t('aiAssistedLabel')}</Badge>}
          </div>
          <p className="m-0 max-w-prose text-sm text-muted">{t('mtMinutesHelp')}</p>
          <div className="max-w-prose text-ink whitespace-pre-line [overflow-wrap:anywhere]">{m.minutes.narrative}</div>
        </Panel>
      )}

      {m.status === 'done' && <Drafts meeting={m} />}

      {m.speakers.length > 0 && m.canChange && !m.contentDeleted && (
        <Speakers key={JSON.stringify(m.speakerMap)} meeting={m} busy={busy === 'names'} onSave={(map) => act('names', () => api('PATCH', `/api/meetings/${id}`, { speakerMap: map }))} />
      )}

      {m.turns.length > 0 && (
        <Panel aria-label={t('mtTranscript')} className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('mtTranscript')}</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {m.turns.map((turn) => (
              <li key={turn.seq} className="grid gap-x-3 sm:grid-cols-[9rem_1fr]">
                <span className="text-sm text-muted">
                  <span className="font-mono tabular-nums">{stamp(turn.startMs)}</span>{' '}
                  <span className="font-medium text-ink-2">{turn.speaker ? (m.speakerMap[turn.speaker] ?? t('mtSpeakerLabel', { label: turn.speaker })) : ''}</span>
                </span>
                <span className="text-ink [overflow-wrap:anywhere]">{turn.text}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {m.canChange && !m.contentDeleted && m.status !== 'processing' && (
        <Panel className="flex flex-col items-start gap-2">
          <p className="m-0 max-w-prose text-sm text-muted">{t('mtDeleteHelp')}</p>
          <ConfirmButton variant="danger" busy={busy === 'delete'} disabled={busy !== null} onConfirm={() => act('delete', () => api('DELETE', `/api/meetings/${id}/content`))}>{t('mtDeleteContent')}</ConfirmButton>
        </Panel>
      )}
    </div>
  );
}

function Drafts({ meeting }: { meeting: Meeting }) {
  const t = useT();
  const empty = meeting.tasks.length === 0 && meeting.leads.length === 0;
  return (
    <Panel aria-label={t('mtDrafts')} className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mtDrafts')}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{t('mtDraftsHelp')}</p>
      </div>
      {empty && <p className="m-0 text-muted">{t('mtNoDrafts')}</p>}
      {meeting.tasks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-base font-semibold text-ink">{t('mtDraftTasks')}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {meeting.tasks.map((task) => (
              <li key={task.id} className="flex flex-col gap-1 rounded border border-rule px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <a href={`/app/task/${task.id}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{task.title}</a>
                  <Badge tone={task.isDraft ? 'accent' : 'success'}>{task.isDraft ? t('taskAiDraft') : t('mtAccepted')}</Badge>
                </span>
                {task.sourceQuote && <q className="text-sm text-ink-2 italic">{task.sourceQuote}</q>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {meeting.leads.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-base font-semibold text-ink">{t('mtDraftLeads')}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {meeting.leads.map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center gap-2 rounded border border-rule px-3 py-2">
                <a href={`/app/lead/${lead.id}`} className="font-medium text-ink no-underline hover:text-accent">{lead.name}</a>
                <Badge tone={lead.isDraft ? 'accent' : 'success'}>{lead.isDraft ? t('leadAiDraft') : t('mtAccepted')}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Panel>
  );
}

function Speakers({ meeting, busy, onSave }: { meeting: Meeting; busy: boolean; onSave: (map: Record<string, string>) => void }) {
  const t = useT();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(meeting.speakers.map((s) => [s, meeting.speakerMap[s] ?? ''])));
  return (
    <Panel aria-label={t('mtSpeakers')} className="flex flex-col gap-3">
      <div className="max-w-prose">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mtSpeakers')}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{t('mtSpeakersHelp')}</p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSave(names); }}>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          {meeting.speakers.map((label) => (
            <FormField key={label} label={t('mtSpeakerLabel', { label })}>
              <TextInput value={names[label] ?? ''} onChange={(e) => setNames({ ...names, [label]: e.currentTarget.value })} maxLength={80} autoComplete="off" />
            </FormField>
          ))}
        </div>
        <Button type="submit" className="w-fit" loading={busy}>{t('mtSaveNames')}</Button>
      </form>
    </Panel>
  );
}
