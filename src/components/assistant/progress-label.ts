import type { AgentProgress } from '../../ai/progress';
import type { MessageKey } from '../../lib/i18n';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Tools with their own line; the rest are told apart by what kind of work they do (read, prepare a change, prepare a draft). */
const TOOL_LINE: Record<string, MessageKey> = {
  search_web: 'progSearchWeb',
  read_website: 'progReadWebsite',
  get_attachment: 'progReadAttachment',
  get_company_profile: 'progCompanyProfile',
  make_picture: 'progMakePicture',
};

/** The line shown while the assistant works: the real step, not a fixed sentence. */
export function progressLabel(progress: AgentProgress | null, t: T): string {
  if (!progress) return t('assistantThinking');
  if (progress.step === 'think') return progress.round > 1 ? t('progWriting') : t('progUnderstanding');
  const own = TOOL_LINE[progress.name];
  if (own) // Without a detail ('Mencari di web: ') the dangling colon becomes an ellipsis.
  return t(own, { detail: progress.detail ?? '' }).replace(/[:\s]+$/, '…');
  if (/^(create|update|move|convert|start|mark|finalize)_/.test(progress.name)) return t('progPrepareChange');
  if (/^draft_|^propose_|^make_/.test(progress.name)) return t('progPrepareDraft');
  return t('progCheckData');
}
