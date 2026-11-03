import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { CompanyProfile } from '../../domain/org/profile';
import { SOCIAL_KEYS, type SocialKey } from '../../domain/org/profile-rules';
import { ApiError, api, badFields, errorKey, upload } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FileInput } from '../forms/FileInput';
import { FormField } from '../forms/FormField';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { LOGO_MAX_BYTES, LOGO_TYPES } from '../portfolio/ProductLogo';
import { Icon } from '../shell/Icon';
import { ProfileAutofill } from './ProfileAutofill';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { ErrorBox, Skeleton } from '../ui/states';

type Service = { id: string; name: string; description: string | null };
/** What `GET /api/settings/company` answers: the profile and its services. */
export type CompanyData = { profile: Jsonify<CompanyProfile>; services: Service[] };
/** The onboarding step (D-095): what to do once the profile is saved. */
export type EditorStep = { onSaved: () => Promise<void> };

const SOCIAL_LABEL: Record<SocialKey, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', x: 'X' };

/** The company profile (D-079): identity, contact, customers and strengths, and services. The AI reads all of it as facts. */
export function CompanyProfilePage({ canEdit }: { canEdit: boolean }) {
  return (
    <ErrorBoundary>
      <CompanyProfile canEdit={canEdit} />
    </ErrorBoundary>
  );
}

function CompanyProfile({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const load = useLoad(() => api<CompanyData>('GET', '/api/settings/company'), []);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('companyTitle')} intro={canEdit ? t('companyIntro') : t('companyReadOnly')} />
      {load.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={6} /></Panel>}
      {load.value.state === 'error' && <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>}
      {load.value.state === 'ready' && <CompanyProfileEditor data={load.value.data} canEdit={canEdit} onChanged={() => void load.reload()} />}
    </div>
  );
}

type SectionProps = { title: string; children: ReactNode };

const PanelSection = ({ title, children }: SectionProps) => (
  <Panel className="flex flex-col gap-4">
    <h2 className="m-0 text-lg font-semibold text-ink">{title}</h2>
    {children}
  </Panel>
);

/** Inside an onboarding step, which is already a panel: a rule and a smaller heading, never a panel in a panel. */
const StepSection = ({ title, children }: SectionProps) => (
  <section className="flex flex-col gap-4 border-t border-rule pt-5">
    <h3 className="m-0 text-base font-semibold text-ink">{title}</h3>
    {children}
  </section>
);

const valuesOf = (p: CompanyData['profile']) => ({
  tagline: p.tagline ?? '',
  namePronunciation: p.namePronunciation ?? '',
  description: p.description ?? '',
  industry: p.industry ?? '',
  website: p.website ?? '',
  contactEmail: p.contactEmail ?? '',
  contactPhone: p.contactPhone ?? '',
  address: p.address ?? '',
  targetAudience: p.targetAudience ?? '',
  valueProps: p.valueProps ?? '',
  socials: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, p.socials[k] ?? ''])) as Record<SocialKey, string>,
});
type TextKey = Exclude<keyof ReturnType<typeof valuesOf>, 'socials'>;

/**
 * The whole company profile editor: fill in from the website with AI, identity with the logo, contact and social media,
 * customers and strengths, and services. The settings page and the onboarding profile step (D-095) both show this one
 * component, so the autofill fills the same fields and services in both. As a `step` it sits inside the step's panel:
 * sections are divided by a rule, the field of business and the description are marked as needed (they make the step
 * done), and one "Save and continue" comes after the services, so nothing is left unseen before moving on.
 */
export function CompanyProfileEditor({ data, canEdit, onChanged, step }: { data: CompanyData; canEdit: boolean; onChanged: () => void; step?: EditorStep }) {
  const t = useT();
  const formId = useId();
  const Section = step ? StepSection : PanelSection;
  const [v, setV] = useState(() => valuesOf(data.profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<'saved' | 'nothing' | null>(null);
  const bad = badFields(error);
  const needed = (key: TextKey) => Boolean(step) && (key === 'industry' || key === 'description');
  // The value is read now: React empties `currentTarget` once the handler returns, and a state updater may run later.
  const set = (key: TextKey) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setV((p) => ({ ...p, [key]: value }));
  };
  const setSocial = (key: SocialKey) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setV((p) => ({ ...p, socials: { ...p.socials, [key]: value } }));
  };
  const badSocial = (key: string) => bad[key] || bad[`socials.${key}`];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ changed: string[] }>('POST', '/api/settings/company', v);
      if (step) await step.onSaved();
      else setDone(r.changed.length ? 'saved' : 'nothing');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: TextKey, label: MessageKey, max: number, help?: MessageKey, extra?: { type?: 'email' | 'tel' | 'url'; inputMode?: 'email' | 'url' }) => (
    <FormField label={t(label)} help={help ? t(help) : undefined} required={needed(key)} error={bad[key] ? t('errValidation') : null}>
      <TextInput value={v[key]} onChange={set(key)} maxLength={max} disabled={!canEdit} autoComplete="off" {...extra} />
    </FormField>
  );
  const area = (key: TextKey, label: MessageKey, max: number, help: MessageKey, rows = 3) => (
    <FormField label={t(label)} help={t(help)} required={needed(key)} error={bad[key] ? t('errValidation') : null}>
      <Textarea value={v[key]} onChange={set(key)} maxLength={max} rows={rows} disabled={!canEdit} />
    </FormField>
  );

  // The button names the form, so in a step it can stand after the services (a form cannot hold their forms).
  const actions = canEdit && (
    <div className="flex flex-col gap-3">
      {error !== null && !Object.keys(bad).length && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
      {Object.keys(bad).length > 0 && <ErrorBox>{t('errValidation')}</ErrorBox>}
      <div className="flex items-center gap-3">
        <Button type="submit" form={formId} variant="primary" loading={busy} disabled={Boolean(step) && !(v.industry.trim() && v.description.trim())}>
          {step ? t('obSaveNext') : t('companySave')}
        </Button>
        {done && <span role="status" className="text-sm text-success">{done === 'saved' ? t('companySaved') : t('companyNothing')}</span>}
      </div>
    </div>
  );

  return (
    <>
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-6">
        {canEdit && (
          <ProfileAutofill
            initialUrl={v.website}
            current={{ tagline: v.tagline, industry: v.industry, description: v.description, targetAudience: v.targetAudience, valueProps: v.valueProps, website: v.website, contactEmail: v.contactEmail, contactPhone: v.contactPhone, address: v.address, socials: v.socials }}
            onServicesAdded={onChanged}
            onApply={(patch) => { setDone(null); setV((p) => ({ ...p, ...patch.fields, socials: { ...p.socials, ...patch.socials } })); }}
          />
        )}
        <Section title={t('companySectionIdentity')}>
          <LogoEditor hasLogo={data.profile.hasLogo} canEdit={canEdit} onChanged={onChanged} />
          <div className="grid gap-4 sm:grid-cols-2">
            {field('tagline', 'companyTagline', 160, 'companyTaglineHelp')}
            {field('industry', 'companyIndustry', 120)}
          </div>
          {field('namePronunciation', 'companyPronunciation', 120, 'companyPronunciationHelp')}
          {area('description', 'companyDescription', 2000, 'companyDescriptionHelp', 4)}
          {field('website', 'companyWebsite', 300, 'companyWebsiteHelp', { type: 'url', inputMode: 'url' })}
        </Section>

        <Section title={t('companySectionContact')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('contactEmail', 'companyEmail', 254, undefined, { type: 'email', inputMode: 'email' })}
            {field('contactPhone', 'companyPhone', 40, undefined, { type: 'tel' })}
          </div>
          {field('address', 'companyAddress', 500)}
          <div className="grid gap-4 sm:grid-cols-2">
            {SOCIAL_KEYS.map((k) => (
              <FormField key={k} label={SOCIAL_LABEL[k]} help={t('companyWebsiteHelp')} error={badSocial(k) ? t('errValidation') : null}>
                <TextInput value={v.socials[k]} onChange={setSocial(k)} maxLength={300} disabled={!canEdit} autoComplete="off" type="url" inputMode="url" />
              </FormField>
            ))}
          </div>
        </Section>

        <Section title={t('companySectionPositioning')}>
          {area('targetAudience', 'companyAudience', 1000, 'companyAudienceHelp')}
          {area('valueProps', 'companyValueProps', 1000, 'companyValuePropsHelp')}
        </Section>

        {!step && actions}
      </form>
      <Services Section={Section} services={data.services} canEdit={canEdit} onChanged={onChanged} />
      <p className="m-0 max-w-prose text-sm text-muted">{t('companyAiNote')}</p>
      {step && actions}
    </>
  );
}

/** The company logo: shown, replaced or removed. It lives on the profile and is laid onto posters (D-066, D-079). */
function LogoEditor({ hasLogo, canEdit, onChanged }: { hasLogo: boolean; canEdit: boolean; onChanged: () => void }) {
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
      await upload('/api/settings/company/logo', form);
      setVersion((x) => x + 1);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'validation' ? t('pLogoBad') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', '/api/settings/company/logo');
      onChanged();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-ink">{t('companyLogo')}</span>
      {hasLogo && (
        <div className="flex items-center gap-3">
          <img src={`/api/settings/company/logo?v=${version}`} alt="" className="size-20 rounded-input border border-rule-2 bg-paper object-contain" />
          {canEdit && <ConfirmButton message={t('cfmRemoveLogo')} variant="danger" busy={busy} onConfirm={remove}>{t('pLogoRemove')}</ConfirmButton>}
        </div>
      )}
      {canEdit && <FileInput accept={LOGO_TYPES} maxSize={LOGO_MAX_BYTES} disabled={busy} onChange={(files) => files[0] && void send(files[0])} onReject={() => setError(t('pLogoBad'))} />}
      <p className="m-0 text-sm text-muted">{t('companyLogoHelp')}</p>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Services beyond the products in Portfolio. Products are shared with the AI on their own and not repeated here. */
function Services({ Section, services, canEdit, onChanged }: { Section: (p: SectionProps) => ReactNode; services: Service[]; canEdit: boolean; onChanged: () => void }) {
  const t = useT();
  return (
    <Section title={t('companySectionServices')}>
      <p className="m-0 max-w-prose text-sm text-muted">{t('companyProductsNote')}</p>
      {services.length === 0 && <p className="m-0 text-ink-2">{t('companyServiceEmpty')}</p>}
      {services.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {services.map((s) => <ServiceRow key={s.id} service={s} canEdit={canEdit} onChanged={onChanged} />)}
        </ul>
      )}
      {canEdit && <ServiceForm onDone={onChanged} />}
    </Section>
  );
}

function ServiceRow({ service, canEdit, onChanged }: { service: Service; canEdit: boolean; onChanged: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/settings/company/services/${service.id}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  if (editing) {
    return (
      <li className="rounded-card border border-rule p-3">
        <ServiceForm service={service} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-card border border-rule px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium text-ink [overflow-wrap:anywhere]">{service.name}</p>
        {service.description && <p className="m-0 mt-1 text-sm text-muted [overflow-wrap:anywhere]">{service.description}</p>}
      </div>
      {canEdit && (
        <span className="flex gap-2">
          <Button size="sm" onClick={() => setEditing(true)}><Icon name="edit" className="size-4" />{t('companyServiceEdit')}</Button>
          <ConfirmButton message={t('cfmRemoveService')} variant="danger" busy={busy} onConfirm={remove}>{t('delete')}</ConfirmButton>
        </span>
      )}
    </li>
  );
}

function ServiceForm({ service, onDone, onCancel }: { service?: Service; onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const duplicate = error instanceof ApiError && error.code === 'duplicate';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (service) await api('PATCH', `/api/settings/company/services/${service.id}`, { name, description });
      else await api('POST', '/api/settings/company/services', { name, description });
      if (!service) {
        setName('');
        setDescription('');
      }
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <FormField label={t('companyServiceName')} required error={duplicate ? t('companyServiceDuplicate') : bad.name ? t('errValidation') : null}>
        <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} autoComplete="off" />
      </FormField>
      <FormField label={t('companyServiceDescription')} error={bad.description ? t('errValidation') : null}>
        <Textarea value={description} onChange={(e) => setDescription(e.currentTarget.value)} maxLength={600} rows={2} />
      </FormField>
      {error !== null && !Object.keys(bad).length && !duplicate && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={name.trim().length < 2}>{service ? t('save') : t('companyServiceAdd')}</Button>
        {onCancel && <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>}
      </div>
    </form>
  );
}
