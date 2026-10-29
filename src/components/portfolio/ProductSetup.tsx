import { useEffect, useState, type FormEvent } from 'react';
import type { getSetupProfile } from '../../domain/setup/profiles';
import type { StepKey } from '../../domain/setup/steps';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { CheckboxGroup } from '../forms/Checkbox';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';

type Data = Jsonify<Awaited<ReturnType<typeof getSetupProfile>>>;

const STEP_LABEL: Record<StepKey, MessageKey> = {
  check_server: 'stepCheckServer',
  git_clone: 'stepGitClone',
  git_update: 'stepGitUpdate',
  create_database: 'stepCreateDatabase',
  write_env: 'stepWriteEnv',
  install_dependencies: 'stepInstallDependencies',
  build_app: 'stepBuildApp',
  set_domain_and_nginx: 'stepSetDomainNginx',
  restart_service: 'stepRestartService',
  verify_http: 'stepVerifyHttp',
};
const ALL_STEPS = Object.keys(STEP_LABEL) as StepKey[];

/** How a product is brought online for a client: where its code lives, which server, which steps, and the rules the assistant must follow. */
export function ProductSetup({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const t = useT();
  const load = useLoad(() => api<Data>('GET', `/api/products/${productId}/setup`), [productId]);
  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={4} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;
  return <SetupForm productId={productId} data={load.value.data} canWrite={canWrite} onSaved={() => void load.reload()} />;
}

function SetupForm({ productId, data, canWrite, onSaved }: { productId: string; data: Data; canWrite: boolean; onSaved: () => void }) {
  const t = useT();
  const p = data.profile;
  const github = data.connections.filter((c) => c.kind === 'github');
  const servers = data.connections.filter((c) => c.kind !== 'github');
  const [githubId, setGithubId] = useState(p?.githubConnectionId ?? github[0]?.id ?? '');
  const [repo, setRepo] = useState(p?.repo ?? '');
  const [branch, setBranch] = useState(p?.defaultBranch ?? '');
  const [mode, setMode] = useState<'branch_per_client' | 'shared_branch'>(p?.mode ?? 'branch_per_client');
  const [folder, setFolder] = useState(p?.folderPattern ?? '{produk}-{klien}');
  const [serverId, setServerId] = useState(p?.serverConnectionId ?? '');
  const [steps, setSteps] = useState<string[]>(p?.steps ?? data.defaultSteps);
  const [nginx, setNginx] = useState(p?.nginxTemplate ?? '');
  const [env, setEnv] = useState(p?.envTemplate ?? '');
  const [notes, setNotes] = useState(p?.rulesNotes ?? '');
  const [repos, setRepos] = useState<Array<{ fullName: string; defaultBranch: string }>>([]);
  const [repoError, setRepoError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const bad = badFields(error);

  useEffect(() => {
    if (!githubId) return;
    let live = true;
    setRepoError(false);
    api<{ repos: Array<{ fullName: string; defaultBranch: string }> }>('GET', `/api/setup/repos?connectionId=${githubId}`)
      .then((r) => live && setRepos(r.repos))
      .catch(() => live && setRepoError(true));
    return () => {
      live = false;
    };
  }, [githubId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('PUT', `/api/products/${productId}/setup`, {
        githubConnectionId: githubId || null,
        repo: repo || null,
        defaultBranch: branch || null,
        mode,
        folderPattern: folder || null,
        serverConnectionId: serverId || null,
        steps: ALL_STEPS.filter((k) => steps.includes(k)).map((key) => ({ key })),
        nginxTemplate: nginx,
        envTemplate: env,
        rulesNotes: notes,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const noConnections = data.connections.length === 0;
  return (
    <form onSubmit={submit} noValidate>
      <Panel className="flex flex-col gap-4" aria-label={t('setupTitle')}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('setupTitle')}</h2>
          {p?.isAiDraft && <Badge tone="accent">{t('aiAssistedLabel')}</Badge>}
        </div>
        <p className="m-0 max-w-prose text-sm text-muted">{t('setupIntro')}</p>
        {noConnections && (
          <p className="m-0 text-sm text-ink">
            {t('setupNoConnections')} <a href="/app/koneksi" className={buttonClasses('secondary', 'sm')}>{t('navConnections')}</a>
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('connKindGithub')}>
            <SelectMenu value={githubId} onChange={setGithubId} disabled={!canWrite} includeAll={t('choose')} searchable={false} options={github.map((c) => ({ value: c.id, label: c.name }))} />
          </FormField>
          <FormField label={t('setupRepo')} error={bad.repo ? t('errValidation') : repoError ? t('setupRepoError') : null}>
            <SelectMenu
              value={repo}
              onChange={(v) => {
                setRepo(v);
                const found = repos.find((r) => r.fullName === v);
                if (found && !branch) setBranch(found.defaultBranch);
              }}
              disabled={!canWrite || !githubId}
              includeAll={t('choose')}
              options={[...(repo && !repos.some((r) => r.fullName === repo) ? [{ value: repo, label: repo }] : []), ...repos.map((r) => ({ value: r.fullName, label: r.fullName }))]}
            />
          </FormField>
          <FormField label={t('setupBranch')} help={t('setupBranchHelp')} error={bad.defaultBranch ? t('errValidation') : null}>
            <TextInput value={branch} onChange={(e) => setBranch(e.currentTarget.value)} disabled={!canWrite} autoComplete="off" />
          </FormField>
          <FormField label={t('setupMode')}>
            <SelectMenu value={mode} onChange={(v) => setMode(v as typeof mode)} disabled={!canWrite} searchable={false} options={[{ value: 'branch_per_client', label: t('setupModePerClient') }, { value: 'shared_branch', label: t('setupModeShared') }]} />
          </FormField>
          <FormField label={t('setupServer')}>
            <SelectMenu value={serverId} onChange={setServerId} disabled={!canWrite} includeAll={t('choose')} searchable={false} options={servers.map((c) => ({ value: c.id, label: c.name }))} />
          </FormField>
          <FormField label={t('setupFolder')} help={t('setupFolderHelp')} error={bad.folderPattern ? t('errValidation') : null}>
            <TextInput value={folder} onChange={(e) => setFolder(e.currentTarget.value)} disabled={!canWrite} autoComplete="off" />
          </FormField>
        </div>

        <FormField label={t('setupSteps')} help={t('setupStepsHelp')}>
          <CheckboxGroup value={steps} onChange={setSteps} disabled={!canWrite} options={ALL_STEPS.map((k) => ({ value: k, label: t(STEP_LABEL[k]) }))} />
        </FormField>
        <FormField label={t('setupNginx')}>
          <Textarea value={nginx} onChange={(e) => setNginx(e.currentTarget.value)} disabled={!canWrite} rows={4} spellCheck={false} maxLength={20000} />
        </FormField>
        <FormField label={t('setupEnv')} help={t('setupEnvHelp')}>
          <Textarea value={env} onChange={(e) => setEnv(e.currentTarget.value)} disabled={!canWrite} rows={4} spellCheck={false} maxLength={20000} />
        </FormField>
        <FormField label={t('setupNotes')} help={t('setupNotesHelp')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.currentTarget.value)} disabled={!canWrite} rows={5} maxLength={8000} />
        </FormField>

        {error && !Object.keys(bad).length ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" loading={busy}>{t('saveChanges')}</Button>
            {saved && <span role="status" className="text-sm text-success">{t('connSaved')}</span>}
          </div>
        )}
      </Panel>
    </form>
  );
}
