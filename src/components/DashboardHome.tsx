import { useT } from '../lib/use-t';
import { buttonClasses } from './ui/Button';

/** Placeholder content of the dashboard until M12 is built; it says so plainly. */
export function DashboardHome({ name }: { name: string }) {
  const t = useT();
  return (
    <section>
      <h1 className="m-0 text-3xl font-semibold text-ink">{t('welcome', { name })}</h1>
      <h2 className="mt-6 mb-1 text-lg font-medium text-ink">{t('dashboardTitle')}</h2>
      <p className="m-0 max-w-prose text-muted">{t('dashboardSoon')}</p>
      <div className="mt-8 flex max-w-prose flex-col items-start gap-3 border-t border-rule pt-6">
        <p className="m-0 text-ink">{t('dashboardAssistantHint')}</p>
        <a href="/app/asisten" className={buttonClasses('primary')}>{t('askAssistantCta')}</a>
      </div>
    </section>
  );
}
