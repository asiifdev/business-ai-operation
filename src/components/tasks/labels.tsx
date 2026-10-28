import type { TaskKind, TaskPriority, TaskStatus } from '../../domain/tasks/rules';
import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';

export const KIND_LABEL: Record<TaskKind, MessageKey> = { task: 'taskKindTask', bug: 'taskKindBug', feature: 'taskKindFeature', maintenance: 'taskKindMaintenance' };
export const STATUS_LABEL: Record<TaskStatus, MessageKey> = { open: 'taskStatusOpen', in_progress: 'taskStatusInProgress', done: 'taskStatusDone' };
export const PRIORITY_LABEL: Record<TaskPriority, MessageKey> = { low: 'taskPrioLow', medium: 'taskPrioMedium', high: 'taskPrioHigh', urgent: 'taskPrioUrgent' };
export const PRIORITY_TONE = { low: 'neutral', medium: 'neutral', high: 'warn', urgent: 'danger' } as const satisfies Record<TaskPriority, string>;
export const STATUS_TONE = { open: 'neutral', in_progress: 'accent', done: 'success' } as const satisfies Record<TaskStatus, string>;

/** Where an AI-made task came from, in plain words. Unknown sources show nothing rather than a code. */
export const SOURCE_LABEL: Record<string, MessageKey> = {
  assistant: 'taskSrcAssistant',
  meeting: 'taskSrcMeeting',
  telegram_photo: 'taskSrcTelegramPhoto',
  lead_conversion: 'taskSrcLeadConversion',
};

/**
 * The button that moves a task to `to`. The label depends on where it comes from, so "open" reads as "Back to open" while
 * work is in progress and "Reopen" once it is done.
 */
export function moveLabel(from: TaskStatus, to: TaskStatus): MessageKey {
  if (to === 'in_progress') return 'taskStart';
  if (to === 'done') return 'taskFinish';
  return from === 'done' ? 'taskReopen' : 'taskStop';
}

/** The state badges of a task: draft, late, priority (only when it matters) and, when asked, its status. */
export function TaskBadges({ task, showStatus = false }: { task: { status: TaskStatus; priority: TaskPriority; isDraft: boolean; late: boolean; daysLate: number }; showStatus?: boolean }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {showStatus && <Badge tone={STATUS_TONE[task.status]}>{t(STATUS_LABEL[task.status])}</Badge>}
      {task.isDraft && <Badge tone="accent">{t('taskAiDraft')}</Badge>}
      {task.late && <Badge tone="danger">{t('taskLateDays', { n: task.daysLate })}</Badge>}
      {(task.priority === 'high' || task.priority === 'urgent') && task.status !== 'done' && <Badge tone={PRIORITY_TONE[task.priority]}>{t(PRIORITY_LABEL[task.priority])}</Badge>}
    </span>
  );
}
