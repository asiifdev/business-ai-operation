import { useState, type FormEvent } from 'react';
import { TASK_KINDS, TASK_PRIORITIES, type TaskKind, type TaskPriority } from '../../domain/tasks/rules';
import type { TaskFormOptions } from '../../domain/tasks/service';
import { badFields, errorKey } from '../../lib/api-client';
import type { Jsonify } from '../../lib/json-types';
import { useT } from '../../lib/use-t';
import { DateInput } from '../forms/DateInput';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { ClientSelect } from '../portfolio/ClientSelect';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';
import { KIND_LABEL, PRIORITY_LABEL } from './labels';

export interface TaskValues {
  title: string;
  description: string;
  kind: TaskKind;
  priority: TaskPriority;
  dueDate: string;
  assigneeId: string;
  clientId: string;
  productId: string;
  deploymentId: string;
}

export const emptyTask: TaskValues = { title: '', description: '', kind: 'task', priority: 'medium', dueDate: '', assigneeId: '', clientId: '', productId: '', deploymentId: '' };

/** What the API takes: an empty choice means "none", never an empty string. */
export const taskPayload = (v: TaskValues) => ({
  title: v.title,
  description: v.description,
  kind: v.kind,
  priority: v.priority,
  dueDate: v.dueDate || null,
  assigneeId: v.assigneeId || null,
  clientId: v.clientId || null,
  productId: v.productId || null,
  deploymentId: v.deploymentId || null,
});

type Options = Jsonify<TaskFormOptions>;

/** The task fields, used to add a task and to edit one. Deployments narrow to the chosen client. */
export function TaskForm({ options, initial = emptyTask, submitLabel, request, onDone, onCancel }: { options: Options; initial?: TaskValues; submitLabel: string; request: (values: TaskValues) => Promise<unknown>; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [values, setValues] = useState<TaskValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const set = <K extends keyof TaskValues>(key: K, value: TaskValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const deployments = options.deployments.filter((d) => !values.clientId || d.clientId === values.clientId);

  function pickClient(clientId: string) {
    setValues((v) => ({ ...v, clientId, deploymentId: options.deployments.some((d) => d.id === v.deploymentId && d.clientId === clientId) ? v.deploymentId : '' }));
  }

  function pickDeployment(deploymentId: string) {
    const d = options.deployments.find((x) => x.id === deploymentId);
    setValues((v) => ({ ...v, deploymentId, ...(d ? { clientId: d.clientId, productId: d.productId } : {}) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(values);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const generalError = error && !Object.keys(bad).length ? t(errorKey(error)) : null;
  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4">
      <FormField label={t('fTitle')} required error={bad.title ? t('errValidation') : generalError}>
        <TextInput value={values.title} onChange={(e) => set('title', e.currentTarget.value)} maxLength={200} required autoComplete="off" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('fKind')}>
          <SelectMenu searchable={false} value={values.kind} onChange={(v) => set('kind', v as TaskKind)} options={TASK_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
        </FormField>
        <FormField label={t('fPriority')}>
          <SelectMenu searchable={false} value={values.priority} onChange={(v) => set('priority', v as TaskPriority)} options={[...TASK_PRIORITIES].reverse().map((p) => ({ value: p, label: t(PRIORITY_LABEL[p]) }))} />
        </FormField>
        <FormField label={t('fDueDate')} help={t('taskDueHelp')} error={bad.dueDate ? t('errValidation') : null}>
          <DateInput value={values.dueDate} onChange={(v) => set('dueDate', v)} />
        </FormField>
      </div>
      <FormField label={t('fAssignee')} help={options.canAssignOthers ? undefined : t('taskAssignSelfHelp')}>
        <SelectMenu value={values.assigneeId} onChange={(v) => set('assigneeId', v)} includeAll={t('taskAssigneeNone')} options={options.assignees.map((u) => ({ value: u.id, label: u.name }))} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('fTaskClient')}>
          <ClientSelect clients={options.clients} value={values.clientId} onChange={pickClient} includeAll={t('taskNone')} />
        </FormField>
        <FormField label={t('fTaskProduct')}>
          <SelectMenu value={values.productId} onChange={(v) => set('productId', v)} includeAll={t('taskNone')} options={options.products.map((p) => ({ value: p.id, label: p.name }))} disabled={Boolean(values.deploymentId)} />
        </FormField>
        <FormField label={t('fTaskDeployment')} help={t('taskDeploymentHelp')}>
          <SelectMenu value={values.deploymentId} onChange={pickDeployment} includeAll={t('taskNone')} options={deployments.map((d) => ({ value: d.id, label: d.label }))} />
        </FormField>
      </div>
      <FormField label={t('fDescription')}>
        <Textarea value={values.description} onChange={(e) => set('description', e.currentTarget.value)} rows={4} maxLength={4000} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
