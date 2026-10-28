import type { MessageKey } from '../../lib/i18n';
import type { Stage } from '../../domain/pipeline/stages';

export const STAGE_LABEL: Record<Stage, MessageKey> = {
  new: 'stageNew',
  exploring: 'stageExploring',
  proposal: 'stageProposal',
  negotiation: 'stageNegotiation',
  won: 'stageWon',
  lost: 'stageLost',
};

export const STAGE_TONE = { new: 'neutral', exploring: 'neutral', proposal: 'accent', negotiation: 'accent', won: 'success', lost: 'danger' } as const satisfies Record<Stage, string>;
