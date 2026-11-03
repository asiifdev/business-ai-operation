import { useState } from 'react';
import type { ProfileSuggestion } from '../../domain/org/profile-autofill';
import { SOCIAL_KEYS } from '../../domain/org/profile-rules';
import { ApiError, api, errorKey } from '../../lib/api-client';
import { useT } from '../../lib/use-t';
import { Checkbox } from '../forms/Checkbox';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorBox } from '../ui/states';

type Fields = ProfileSuggestion['fields'];
type Answer = (ProfileSuggestion & { ok: true }) | { ok: false; message: string };

/** What the form currently holds, so the suggestion fills only what is still empty unless the person says to replace it. */
export type AutofillCurrent = Omit<Fields, 'socials'> & { socials: Record<string, string> };
export type AutofillPatch = { fields: Partial<Omit<Fields, 'socials'>>; socials: Record<string, string> };

/**
 * "Fill in with AI" from the company's website (D-095). The server reads the page and its about, services and contact
 * pages; contacts and links come straight from the pages, the descriptive text is written by the model from them. The
 * result only lands in the form, where the person edits it and saves it like any other entry.
 */
export function ProfileAutofill({ current, onApply, onServicesAdded, initialUrl = '' }: { current: AutofillCurrent; onApply: (patch: AutofillPatch) => void; onServicesAdded?: () => void; initialUrl?: string }) {
  const t = useT();
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ProfileSuggestion & { ok: true }) | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<string | null>(null);

  // This block sits inside the profile form, and a form cannot hold another form: a nested one is dropped by the
  // browser and its button then submits the OUTER form, which reloads the page. So there is no <form> here: a plain
  // button and the Enter key start the reading.
  async function run() {
    if (busy || url.trim().length < 4) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setApplied(null);
    try {
      const r = await api<Answer>('POST', '/api/settings/company/autofill', { url });
      if (!r.ok) setError(r.message);
      else {
        setResult(r);
        setPicked(new Set(r.services.map((s) => s.name)));
      }
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'validation' ? t('afBadUrl') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!result) return;
    const patch: AutofillPatch = { fields: {}, socials: {} };
    let count = 0;
    for (const [key, value] of Object.entries(result.fields) as Array<[keyof Fields, Fields[keyof Fields]]>) {
      if (key === 'socials') continue;
      if (typeof value === 'string' && value && (overwrite || !current[key as keyof AutofillCurrent])) {
        (patch.fields as Record<string, string>)[key] = value;
        count += 1;
      }
    }
    for (const key of SOCIAL_KEYS) {
      const value = result.fields.socials[key];
      if (value && (overwrite || !current.socials[key])) {
        patch.socials[key] = value;
        count += 1;
      }
    }
    let added = 0;
    for (const s of result.services.filter((x) => picked.has(x.name))) {
      try {
        await api('POST', '/api/settings/company/services', s);
        added += 1;
      } catch {
        // A service with the same name is already there: nothing to add.
      }
    }
    onApply(patch);
    if (added) onServicesAdded?.();
    setApplied(count === 0 && added === 0 ? t('afNothing') : t('afApplied', { fields: count, services: added }));
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-accent/40 bg-accent-wash p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="assistant" className="size-5 text-accent" />
        <h3 className="m-0 text-base font-semibold text-ink">{t('afTitle')}</h3>
        <Badge tone="accent">{t('afAiBadge')}</Badge>
      </div>
      <p className="m-0 max-w-prose text-sm text-ink-2">{t('afHelp')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <FormField label={t('afUrl')}>
            <TextInput
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void run();
              }}
              maxLength={300}
              placeholder="https://"
              autoComplete="off"
            />
          </FormField>
        </div>
        <Button type="button" variant="primary" onClick={() => void run()} loading={busy} disabled={url.trim().length < 4}>{busy ? t('afRunning') : t('afRun')}</Button>
      </div>
      {busy && <p role="status" className="m-0 text-sm text-muted">{t('afRunningNote')}</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      {applied && <p role="status" className="m-0 text-sm text-success">{applied}</p>}
      {result && (
        <div className="flex flex-col gap-3 border-t border-rule pt-3">
          <p className="m-0 text-sm text-ink">{t('afResult', { n: result.sources.length })}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-muted">
            {result.sources.map((s) => <li key={s} className="[overflow-wrap:anywhere]">{s}</li>)}
          </ul>
          {result.alreadyListed.length > 0 && <p className="m-0 text-xs text-muted">{t('afAlreadyListed', { n: result.alreadyListed.length, names: result.alreadyListed.join(', ') })}</p>}
          {result.services.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">{t('afServices')}</span>
              {result.services.map((s) => (
                <Checkbox
                  key={s.name}
                  label={s.name}
                  description={s.description || undefined}
                  checked={picked.has(s.name)}
                  onChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(s.name); else n.delete(s.name); return n; })}
                />
              ))}
            </div>
          )}
          <Checkbox label={t('afOverwrite')} checked={overwrite} onChange={setOverwrite} />
          <p className="m-0 text-xs text-muted">{t('afCheck')}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={apply}>{t('afApply')}</Button>
            <Button onClick={() => setResult(null)}>{t('cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
