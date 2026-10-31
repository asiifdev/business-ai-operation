import { useState } from 'react';
import { api, errorKey } from '../../lib/api-client';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { RadioGroup } from '../forms/RadioGroup';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';

type Level = 'careful' | 'balanced' | 'autonomous';

/** How much the assistant may do by itself (D-082). Saved the moment a choice is made; only the Owner can change it. */
export function AutonomyCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const load = useLoad(() => api<{ level: Level }>('GET', '/api/settings/autonomy'), []);
  const [picked, setPicked] = useState<Level | null>(null);
  const [error, setError] = useState<unknown>(null);
  const level = picked ?? (load.value.state === 'ready' ? load.value.data.level : null);

  async function choose(next: string) {
    const before = level;
    setPicked(next as Level);
    setError(null);
    try {
      await api('POST', '/api/settings/autonomy', { level: next });
    } catch (err) {
      setPicked(before);
      setError(err);
    }
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('autoTitle')}</h2>
        <p className="m-0 max-w-prose text-sm text-muted">{canEdit ? t('autoHelp') : t('autoOwnerOnly')}</p>
      </div>
      {load.value.state === 'loading' && <Skeleton rows={3} />}
      {load.value.state === 'error' && <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>}
      {level && (
        <RadioGroup
          value={level}
          onChange={(v) => void choose(v)}
          disabled={!canEdit}
          options={[
            { value: 'careful', label: t('autoCarefulName'), description: t('autoCarefulDesc') },
            { value: 'balanced', label: t('autoBalancedName'), description: t('autoBalancedDesc') },
            { value: 'autonomous', label: t('autoAutonomousName'), description: t('autoAutonomousDesc') },
          ]}
        />
      )}
      {error !== null && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
      <p className="m-0 max-w-prose border-t border-rule pt-3 text-sm text-muted">{t('autoAlwaysWait')}</p>
    </Panel>
  );
}
