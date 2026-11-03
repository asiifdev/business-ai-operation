import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { OnboardingState, OnboardingStep } from '../../domain/org/onboarding-rules';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { NumberInput } from '../forms/NumberInput';
import { RadioGroup } from '../forms/RadioGroup';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { CompanyProfileEditor, type CompanyData } from '../settings/CompanyProfilePage';
import { InviteForm, LinkNotice, type InviteResult } from '../settings/InviteUser';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Meter } from '../ui/Meter';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { Steps, type StepItem, type StepStatus } from '../ui/Steps';

type Role = 'owner' | 'admin';
type Current = OnboardingStep | 'finish';

const ORDER: readonly Current[] = ['profile', 'finance', 'assistant', 'product', 'client', 'team', 'telegram', 'finish'];

const TITLE: Record<Current, MessageKey> = {
  profile: 'obProfile', finance: 'obFinance', assistant: 'obAssistant', product: 'obProduct', client: 'obClient', team: 'obTeam', telegram: 'obTelegram', finish: 'obFinish',
};
const INTRO: Record<OnboardingStep, MessageKey> = {
  profile: 'obProfileIntro', finance: 'obFinanceIntro', assistant: 'obAssistantIntro', product: 'obProductIntro', client: 'obClientIntro', team: 'obTeamIntro', telegram: 'obTelegramIntro',
};
/** The full page each step is a shortcut to, so nothing here is a dead end. */
const PAGE: Record<OnboardingStep, string> = {
  profile: '/app/settings/perusahaan', finance: '/app/settings/organisasi', assistant: '/app/settings/organisasi', product: '/app/produk', client: '/app/klien', team: '/app/settings/pengguna', telegram: '/app/settings/telegram',
};

/** The first-run wizard (D-095). Each step writes through the same service as its settings page; progress is read from real data. */
export function OnboardingWizard({ role, name, organizationName }: { role: Role; name: string; organizationName: string }) {
  const t = useT();
  const load = useLoad(() => api<OnboardingState>('GET', '/api/onboarding'), []);
  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;
  return <Wizard state={load.value.data} reload={load.reload} role={role} name={name} organizationName={organizationName} />;
}

function Wizard({ state, reload, role, name, organizationName }: { state: OnboardingState; reload: () => Promise<void>; role: Role; name: string; organizationName: string }) {
  const t = useT();
  const [current, setCurrent] = useState<Current>(state.next ?? 'finish');
  const index = ORDER.indexOf(current);
  const done = state.steps.filter((s) => s.status === 'done').length;
  const statusOf = (step: OnboardingStep) => state.steps.find((s) => s.step === step)!;

  const items: StepItem[] = ORDER.map((id) => {
    const s = id === 'finish' ? null : statusOf(id);
    const status: StepStatus = id === current ? 'current' : s?.status === 'done' ? 'done' : s?.status === 'skipped' ? 'skipped' : 'upcoming';
    return { id, label: t(TITLE[id]), status, note: s ? (s.required ? t('obRequired') : t('obOptional')) : undefined };
  });

  const go = (to: Current) => {
    setCurrent(to);
    document.getElementById('content')?.scrollIntoView({ block: 'start' });
  };
  const after = async () => {
    await reload();
    go(ORDER[Math.min(index + 1, ORDER.length - 1)]!);
  };
  async function skip(step: OnboardingStep) {
    await api('POST', '/api/onboarding/skip', { step });
    await after();
  }
  async function close() {
    await api('POST', '/api/onboarding/complete');
    window.location.assign('/app');
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('obPageTitle')}
        intro={<>{t('obWelcome', { name, org: organizationName })} {t('obIntro')}</>}
        action={<ConfirmButton message={t('obLaterMessage')} onConfirm={close}>{t('obLater')}</ConfirmButton>}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Panel className="flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm font-medium text-ink">{t('obProgress', { done, total: state.steps.length })}</p>
            <Meter value={done} max={state.steps.length} label={t('obProgress', { done, total: state.steps.length })} />
            <p className="m-0 text-xs text-muted lg:hidden">{t('obStepOf', { n: index + 1, total: ORDER.length })} · {t(TITLE[current])}</p>
          </div>
          <Steps className="max-lg:hidden" steps={items} label={t('obStepsLabel')} selected={current} onSelect={(id) => go(id as Current)} />
        </Panel>
        <Panel className="flex flex-col gap-5" key={current}>
          {current === 'finish' ? (
            <Finish state={state} role={role} onClose={close} onGo={(s) => go(s)} />
          ) : (
            <StepBody
              step={current}
              state={statusOf(current)}
              role={role}
              onSaved={after}
              onSkip={() => skip(current)}
              onBack={index > 0 ? () => go(ORDER[index - 1]!) : undefined}
              onNext={() => go(ORDER[index + 1]!)}
              refresh={reload}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

interface BodyProps {
  step: OnboardingStep;
  state: OnboardingState['steps'][number];
  role: Role;
  onSaved: () => Promise<void>;
  onSkip: () => Promise<void>;
  onBack?: () => void;
  onNext: () => void;
  refresh: () => Promise<void>;
}

/** The title, the one-line reason, the step's form, and the same three exits everywhere: back, skip, continue. */
function StepBody(p: BodyProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const blocked = p.state.ownerOnly && p.role !== 'owner';
  const done = p.state.status === 'done';
  const skipNow = async () => {
    setBusy(true);
    try {
      await p.onSkip();
    } finally {
      setBusy(false);
    }
  };
  const inner = blocked ? (
    <p className="m-0 max-w-prose text-ink-2">{t(p.step === 'finance' ? 'obOwnerOnlyFinance' : 'obOwnerOnlyAssistant')}</p>
  ) : (
    <StepForm {...p} />
  );
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-xl font-semibold text-ink">{t(TITLE[p.step])}</h2>
          <Badge tone={p.state.required ? 'accent' : 'neutral'}>{p.state.required ? t('obRequired') : t('obOptional')}</Badge>
          <Badge tone={done ? 'success' : 'neutral'}>{done ? t('obStatusDone') : p.state.status === 'skipped' ? t('obStatusSkipped') : t('obStatusTodo')}</Badge>
        </div>
        <p className="m-0 max-w-prose text-sm text-muted">{t(INTRO[p.step])}</p>
      </div>
      {inner}
      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        {p.onBack && <Button onClick={p.onBack} disabled={busy}>{t('back')}</Button>}
        {!done && <Button variant="link" onClick={skipNow} loading={busy}>{t('obSkip')}</Button>}
        {(done || blocked) && !busy && <Button variant="primary" onClick={p.onNext}>{t('obNext')}</Button>}
        <a href={PAGE[p.step]} className={buttonClasses('link', 'md', 'ml-auto')}>{t('obOpenPage')}</a>
      </div>
    </>
  );
}

function StepForm(p: BodyProps) {
  switch (p.step) {
    case 'profile': return <ProfileForm {...p} />;
    case 'finance': return <FinanceForm {...p} />;
    case 'assistant': return <AssistantForm {...p} />;
    case 'product': return <ProductForm {...p} />;
    case 'client': return <ClientForm {...p} />;
    case 'team': return <TeamForm {...p} />;
    case 'telegram': return <TelegramForm {...p} />;
  }
}

/** Loads what a form starts from, with the same loading and error states as every screen. */
function Loaded<T>({ fetcher, children }: { fetcher: () => Promise<T>; children: (data: T) => ReactNode }) {
  const t = useT();
  const load = useLoad(fetcher, []);
  if (load.value.state === 'loading') return <Skeleton rows={4} />;
  if (load.value.state === 'error') return <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>;
  return <>{children(load.value.data)}</>;
}

/** One submit routine: busy flag, error, and the "saved, move on" call. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit, bad: badFields(error) };
}

function FormError({ error, bad }: { error: unknown; bad: Record<string, true> }) {
  const t = useT();
  if (error === null) return null;
  return <ErrorBox>{Object.keys(bad).length ? t('errValidation') : t(errorKey(error))}</ErrorBox>;
}

const set = (setter: (v: string) => void) => (e: { currentTarget: { value: string } }) => setter(e.currentTarget.value);

/* ---------------------------------------------------------------- profile */

/**
 * The very editor of the company profile page (autofill, identity and logo, contact and social media, customers and
 * strengths, services), so the AI fills in the same fields and services here as there.
 */
function ProfileForm({ onSaved }: BodyProps) {
  const t = useT();
  const load = useLoad(() => api<CompanyData>('GET', '/api/settings/company'), []);
  if (load.value.state === 'loading') return <Skeleton rows={4} />;
  if (load.value.state === 'error') return <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>;
  return <CompanyProfileEditor data={load.value.data} canEdit onChanged={() => void load.reload()} step={{ onSaved }} />;
}

/* ---------------------------------------------------------------- finance */

type OrgSettings = Record<string, string | number | null> & { timezone: string; taxRateBps: number };
const ZONES = [
  { value: 'Asia/Jakarta', label: 'WIB · Asia/Jakarta' },
  { value: 'Asia/Makassar', label: 'WITA · Asia/Makassar' },
  { value: 'Asia/Jayapura', label: 'WIT · Asia/Jayapura' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
];

function FinanceForm(p: BodyProps) {
  return <Loaded fetcher={() => api<OrgSettings>('GET', '/api/settings/org')}>{(d) => <FinanceFields {...p} initial={d} />}</Loaded>;
}

function FinanceFields({ initial, onSaved }: BodyProps & { initial: OrgSettings }) {
  const t = useT();
  const [v, setV] = useState({ timezone: initial.timezone, taxPct: initial.taxRateBps / 100, invoiceNumberFormat: String(initial.invoiceNumberFormat ?? ''), bankName: String(initial.bankName ?? ''), bankAccountName: String(initial.bankAccountName ?? ''), bankAccountNumber: String(initial.bankAccountNumber ?? '') });
  const up = (k: 'invoiceNumberFormat' | 'bankName' | 'bankAccountName' | 'bankAccountNumber') => set((x) => setV((s) => ({ ...s, [k]: x })));
  const { busy, error, submit, bad } = useSubmit(async () => {
    const { currency: _currency, ...rest } = initial;
    const { taxPct, ...fields } = v;
    await api('POST', '/api/settings/org', { ...rest, ...fields, taxRateBps: Math.round((taxPct ?? 0) * 100) });
    await onSaved();
  });
  const zones = ZONES.some((z) => z.value === v.timezone) ? ZONES : [{ value: v.timezone, label: v.timezone }, ...ZONES];
  const err = (k: string) => (bad[k] ? t('errValidation') : null);
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('orgTimezone')} help={t('orgTimezoneHelp')} error={err('timezone')}><SelectMenu value={v.timezone} options={zones} searchable={false} onChange={(x) => setV((s) => ({ ...s, timezone: x }))} /></FormField>
        <FormField label={t('obTaxPercent')} help={t('obTaxPercentHelp')} error={err('taxRateBps')}><NumberInput value={v.taxPct} onChange={(n) => setV((s) => ({ ...s, taxPct: n ?? 0 }))} min={0} max={100} step={0.5} /></FormField>
      </div>
      <FormField label={t('orgNumberFormat')} help={t('orgNumberFormatHelp')} error={err('invoiceNumberFormat')}><TextInput value={v.invoiceNumberFormat} onChange={up('invoiceNumberFormat')} maxLength={40} autoComplete="off" /></FormField>
      <p className="m-0 max-w-prose text-sm text-muted">{t('orgBankHelp')}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('orgBankName')} error={err('bankName')}><TextInput value={v.bankName} onChange={up('bankName')} maxLength={80} autoComplete="off" /></FormField>
        <FormField label={t('orgBankAccountName')} required error={err('bankAccountName')}><TextInput value={v.bankAccountName} onChange={up('bankAccountName')} maxLength={120} autoComplete="off" /></FormField>
        <FormField label={t('orgBankAccountNumber')} required error={err('bankAccountNumber')}><TextInput value={v.bankAccountNumber} onChange={up('bankAccountNumber')} maxLength={40} inputMode="numeric" autoComplete="off" /></FormField>
      </div>
      <FormError error={error} bad={{}} />
      <div><Button type="submit" variant="primary" loading={busy} disabled={!v.bankAccountName.trim() || !v.bankAccountNumber.trim()}>{t('obSaveNext')}</Button></div>
    </form>
  );
}

/* -------------------------------------------------------------- assistant */

type Level = 'careful' | 'balanced' | 'autonomous';

function AssistantForm(p: BodyProps) {
  return <Loaded fetcher={() => api<{ level: Level }>('GET', '/api/settings/autonomy')}>{(d) => <AssistantFields {...p} initial={d.level} />}</Loaded>;
}

function AssistantFields({ initial, onSaved }: BodyProps & { initial: Level }) {
  const t = useT();
  const [level, setLevel] = useState<Level>(initial);
  const { busy, error, submit, bad } = useSubmit(async () => {
    await api('POST', '/api/settings/autonomy', { level });
    await api('POST', '/api/onboarding/confirm', { step: 'assistant' });
    await onSaved();
  });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <RadioGroup
        value={level}
        onChange={(x) => setLevel(x as Level)}
        options={[
          { value: 'careful', label: t('autoCarefulName'), description: t('autoCarefulDesc') },
          { value: 'balanced', label: t('autoBalancedName'), description: t('autoBalancedDesc') },
          { value: 'autonomous', label: t('autoAutonomousName'), description: t('autoAutonomousDesc') },
        ]}
      />
      <p className="m-0 max-w-prose text-sm text-muted">{t('autoAlwaysWait')}</p>
      <FormError error={error} bad={bad} />
      <div><Button type="submit" variant="primary" loading={busy}>{t('obSaveNext')}</Button></div>
    </form>
  );
}

/* ---------------------------------------------------------------- product */

type PackageRow = { name: string; price: number | null; features: string };
const MAX_PACKAGES = 4;

function ProductForm({ state, onNext, onSaved }: BodyProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('');
  const [rows, setRows] = useState<PackageRow[]>([{ name: '', price: null, features: '' }]);
  const { busy, error, submit, bad } = useSubmit(async () => {
    const packages = rows.filter((r) => r.name.trim() && r.price !== null).map((r) => ({ name: r.name, monthlyPrice: r.price, features: r.features }));
    await api('POST', '/api/products', { name, description, currentVersion: version, packages });
    await onSaved();
  });
  const patch = (i: number, part: Partial<PackageRow>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...part } : r)));
  const ready = name.trim().length >= 2 && rows.some((r) => r.name.trim() && r.price !== null);
  if (state.status === 'done') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="m-0 text-success">{t('obProductExists')}</p>
        <Button variant="primary" onClick={onNext}>{t('obNext')}</Button>
      </div>
    );
  }
  const duplicate = error !== null && (error as { code?: string }).code === 'duplicate';
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fName')} required error={bad.name ? t('errValidation') : duplicate ? t(errorKey(error)) : null}><TextInput value={name} onChange={set(setName)} maxLength={120} autoComplete="off" /></FormField>
        <FormField label={t('fVersion')} showOptional><TextInput value={version} onChange={set(setVersion)} maxLength={40} autoComplete="off" /></FormField>
      </div>
      <FormField label={t('fDescription')} showOptional><Textarea value={description} onChange={set(setDescription)} maxLength={2000} rows={2} /></FormField>
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-ink">{t('obPackages')}</h3>
          <p className="m-0 text-sm text-muted">{t('obPackageHint')}</p>
        </div>
        {rows.map((r, i) => (
          <fieldset key={i} className="m-0 flex flex-col gap-3 rounded-card border border-rule p-3">
            <legend className="px-1 text-xs font-medium text-muted">{t('obPackageN', { n: i + 1 })}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('fPackageName')} required><TextInput value={r.name} onChange={set((x) => patch(i, { name: x }))} maxLength={120} autoComplete="off" /></FormField>
              <FormField label={t('fPrice')} required help={t('priceHelp')}><MoneyInput value={r.price} onChange={(n) => patch(i, { price: n })} min={0} /></FormField>
            </div>
            <FormField label={t('fFeatures')} showOptional><Textarea value={r.features} onChange={set((x) => patch(i, { features: x }))} rows={2} maxLength={2000} /></FormField>
            {rows.length > 1 && <div><Button size="sm" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}><Icon name="trash" className="size-4" />{t('obRemovePackage')}</Button></div>}
          </fieldset>
        ))}
        {rows.length < MAX_PACKAGES && <div><Button size="sm" onClick={() => setRows((all) => [...all, { name: '', price: null, features: '' }])}><Icon name="plus" className="size-4" />{t('obAddPackage')}</Button></div>}
      </div>
      <FormError error={duplicate ? null : error} bad={bad} />
      <div><Button type="submit" variant="primary" loading={busy} disabled={!ready}>{t('obSaveNext')}</Button></div>
    </form>
  );
}

/* ----------------------------------------------------------------- client */

function ClientForm({ state, onNext, onSaved }: BodyProps) {
  const t = useT();
  const [v, setV] = useState({ name: '', contactName: '', email: '', phone: '' });
  const up = (k: keyof typeof v) => set((x) => setV((s) => ({ ...s, [k]: x })));
  const { busy, error, submit, bad } = useSubmit(async () => {
    await api('POST', '/api/clients', v);
    await onSaved();
  });
  if (state.status === 'done') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="m-0 text-success">{t('obClientExists')}</p>
        <Button variant="primary" onClick={onNext}>{t('obNext')}</Button>
      </div>
    );
  }
  const duplicate = error !== null && (error as { code?: string }).code === 'duplicate';
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fName')} required error={bad.name ? t('errValidation') : duplicate ? t(errorKey(error)) : null}><TextInput value={v.name} onChange={up('name')} maxLength={120} autoComplete="off" /></FormField>
        <FormField label={t('fContact')} showOptional><TextInput value={v.contactName} onChange={up('contactName')} maxLength={120} autoComplete="off" /></FormField>
        <FormField label={t('fEmail')} showOptional error={bad.email ? t('errValidation') : null}><TextInput type="email" inputMode="email" value={v.email} onChange={up('email')} maxLength={254} autoComplete="off" /></FormField>
        <FormField label={t('fPhone')} showOptional><TextInput type="tel" value={v.phone} onChange={up('phone')} maxLength={40} autoComplete="off" /></FormField>
      </div>
      <FormError error={duplicate ? null : error} bad={bad} />
      <div><Button type="submit" variant="primary" loading={busy} disabled={v.name.trim().length < 2}>{t('obSaveNext')}</Button></div>
    </form>
  );
}

/* ------------------------------------------------------------------- team */

function TeamForm({ onNext, state, refresh }: BodyProps) {
  const t = useT();
  const [sent, setSent] = useState<Array<{ email: string; result: InviteResult }>>([]);
  return (
    <div className="flex flex-col gap-4">
      {sent.map(({ email, result }) => <LinkNotice key={email} email={email} result={result} />)}
      <InviteForm roles={['staff', 'admin']} onInvited={(email, result) => setSent((all) => [...all.filter((x) => x.email !== email), { email, result }])} />
      {(sent.length > 0 || state.status === 'done') && <div><Button variant="primary" onClick={() => { void refresh(); onNext(); }}>{t('obNext')}</Button></div>}
    </div>
  );
}

/* --------------------------------------------------------------- telegram */

type TgStatus = { enabled: boolean; linked: boolean; username: string | null };

function TelegramForm({ onSaved, refresh }: BodyProps) {
  const t = useT();
  const load = useLoad(() => api<TgStatus>('GET', '/api/telegram/link'), []);
  const [code, setCode] = useState<{ link: string } | null>(null);
  const { busy, error, submit } = useSubmit(async () => setCode(await api<{ link: string }>('POST', '/api/telegram/link')));
  const linked = load.value.state === 'ready' && load.value.data.linked;
  // While a code is out, ask every few seconds whether the person has pressed Start yet.
  useEffect(() => {
    if (!code || linked) return;
    const timer = window.setInterval(() => void load.reload(), 4000);
    return () => window.clearInterval(timer);
  }, [code, linked]);
  useEffect(() => {
    if (linked) void refresh();
  }, [linked]);
  if (load.value.state === 'loading') return <Skeleton rows={3} />;
  if (load.value.state === 'error') return <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>;
  const s = load.value.data;
  if (s.linked) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="m-0 text-success">{t('obTgLinked')}{s.username ? ` @${s.username}` : ''}</p>
        <Button variant="primary" onClick={() => void onSaved()}>{t('obNext')}</Button>
      </div>
    );
  }
  if (!s.enabled) return <p className="m-0 max-w-prose text-ink-2">{t('obTgOff')}</p>;
  return (
    <div className="flex flex-col items-start gap-3">
      {!code && <form onSubmit={submit}><Button type="submit" variant="primary" loading={busy}>{t('obTgMake')}</Button></form>}
      {code && (
        <>
          <a href={code.link} target="_blank" rel="noreferrer" className={buttonClasses('primary')}><Icon name="send" className="size-4" />{t('obTgOpen')}</a>
          <p role="status" className="m-0 text-sm text-muted">{t('obTgWaiting')} {t('obTgCodeValid')}</p>
        </>
      )}
      {error !== null && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
    </div>
  );
}

/* ----------------------------------------------------------------- finish */

const NEXT_LINKS: ReadonlyArray<{ href: string; label: MessageKey }> = [
  { href: '/app/asisten', label: 'obNextAsk' },
  { href: '/app/pipeline', label: 'obNextPipeline' },
  { href: '/app/koneksi', label: 'obNextConnections' },
  { href: '/app/marketing', label: 'obNextMarketing' },
];

function Finish({ state, role, onClose, onGo }: { state: OnboardingState; role: Role; onClose: () => Promise<void>; onGo: (s: OnboardingStep) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const open = state.steps.filter((s) => s.status !== 'done');
  async function finish() {
    setBusy(true);
    try {
      await onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-xl font-semibold text-ink">{state.ready ? t('obFinishReady') : t('obFinishPartial')}</h2>
        <p className="m-0 max-w-prose text-sm text-muted">{state.ready ? t('obFinishReadyBody') : t('obFinishPartialBody')}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {state.steps.map((s) => (
          <li key={s.step} className="flex flex-wrap items-center gap-3 rounded-card border border-rule px-3 py-2">
            <span className="min-w-0 flex-1 text-ink">{t(TITLE[s.step])}</span>
            <Badge tone={s.status === 'done' ? 'success' : s.required ? 'warn' : 'neutral'}>{s.status === 'done' ? t('obStatusDone') : s.status === 'skipped' ? t('obStatusSkipped') : t('obStatusTodo')}</Badge>
            {s.status !== 'done' && !(s.ownerOnly && role !== 'owner') && <Button size="sm" onClick={() => onGo(s.step)}>{t('obNext')}</Button>}
          </li>
        ))}
      </ul>
      {open.length === 0 || state.ready ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-base font-semibold text-ink">{t('obNextTitle')}</h3>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {NEXT_LINKS.map((l) => <li key={l.href}><a href={l.href} className={buttonClasses('secondary', 'sm')}>{t(l.label)}</a></li>)}
          </ul>
        </div>
      ) : null}
      {role === 'owner' ? <div><Button variant="primary" loading={busy} onClick={finish}>{t('obFinishCta')}</Button></div> : <div><a href="/app" className={buttonClasses('primary')}>{t('obFinishCta')}</a></div>}
    </>
  );
}
