import type { OnboardingState } from '../../domain/org/onboarding-rules';
import { useT } from '../../lib/use-t';
import { buttonClasses } from '../ui/Button';
import { Meter } from '../ui/Meter';
import { Panel } from '../ui/Panel';

const NAME = { profile: 'obProfile', finance: 'obFinance', assistant: 'obAssistant', product: 'obProduct', client: 'obClient', team: 'obTeam', telegram: 'obTelegram' } as const;

/** Dashboard reminder (D-095): shown while a needed setup step is still open, with a way straight back into the wizard. */
export function OnboardingCard({ state }: { state: OnboardingState }) {
  const t = useT();
  const missing = state.steps.filter((s) => s.required && s.status !== 'done').map((s) => t(NAME[s.step]).toLowerCase());
  const done = state.steps.filter((s) => s.status === 'done').length;
  return (
    <Panel className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('obCardTitle')}</h2>
        <p className="m-0 max-w-prose text-sm text-muted">{t('obCardBody', { missing: missing.join(', ') })}</p>
        <div className="flex max-w-sm items-center gap-3">
          <Meter value={done} max={state.steps.length} label={t('obProgress', { done, total: state.steps.length })} />
          <span className="text-xs whitespace-nowrap text-muted">{t('obProgress', { done, total: state.steps.length })}</span>
        </div>
      </div>
      <a href="/app/onboarding" className={buttonClasses('primary')}>{t('obCardCta')}</a>
    </Panel>
  );
}
