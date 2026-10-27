import { useState } from 'react';
import { formatIdr, formatUsd, type Plan } from '../../content/pricing';

interface Props {
  plans: Pick<Plan, 'id' | 'name' | 'usdAnnual' | 'idrAnnual' | 'minUsers'>[];
  locale: 'en' | 'id';
  labels: { title: string; users: string; perMonth: string; free: string; minNote: string; starterFits: string; starterTooBig: string; disclaimer: string };
}

/**
 * Team-size slider that estimates the monthly cost of the PLANNED plans. Real arithmetic on the published planned
 * prices, labelled as an estimate: billing is not live (BR-M16-26). The prices are also plain text elsewhere on the page.
 */
export function PriceEstimator({ plans, locale, labels }: Props) {
  const [users, setUsers] = useState(6);
  const money = (usd: number | null, idr: number | null, n: number) => (locale === 'en' ? formatUsd((usd ?? 0) * n) : formatIdr((idr ?? 0) * n));

  return (
    <div className="rounded-card bg-paper p-6 sm:p-8">
      <label htmlFor="team-size" className="block font-display text-lg font-semibold text-ink">{labels.title}</label>
      <div className="mt-4 flex items-center gap-4">
        <input
          id="team-size"
          type="range"
          min={1}
          max={50}
          value={users}
          onChange={(e) => setUsers(Number(e.currentTarget.value))}
          className="h-2 w-full cursor-pointer rounded-full accent-accent"
        />
        <output htmlFor="team-size" className="min-w-24 text-right font-display text-xl font-semibold text-ink" aria-live="polite">{users} {labels.users}</output>
      </div>

      <ul className="m-0 mt-6 grid list-none gap-3 p-0 sm:grid-cols-3">
        {plans.map((p) => {
          if (p.id === 'starter') {
            const fits = users <= 3;
            return (
              <li key={p.id} className="rounded-input bg-paper-2 p-4">
                <p className="m-0 font-display font-semibold text-ink">{p.name}</p>
                <p className="mt-1 mb-0 font-display text-2xl font-semibold text-ink">{labels.free}</p>
                <p className="mt-1 mb-0 text-xs text-muted">{fits ? labels.starterFits : labels.starterTooBig}</p>
              </li>
            );
          }
          const billed = Math.max(users, p.minUsers ?? 1);
          return (
            <li key={p.id} className="rounded-input bg-paper-2 p-4">
              <p className="m-0 font-display font-semibold text-ink">{p.name}</p>
              <p className="mt-1 mb-0 font-display text-2xl font-semibold text-ink">{money(p.usdAnnual, p.idrAnnual, billed)}</p>
              <p className="mt-1 mb-0 text-xs text-muted">{labels.perMonth}{billed > users ? ` · ${labels.minNote.replace('{n}', String(p.minUsers))}` : ''}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 mb-0 text-xs text-muted">{labels.disclaimer}</p>
    </div>
  );
}
