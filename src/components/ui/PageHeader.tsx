import type { ReactNode } from 'react';

/** Title, one line of plain-language help, and the page's main action. Every list and detail page starts with it, so titles sit in the same place. */
export function PageHeader({ title, intro, action }: { title: string; intro?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-prose">
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-ink lg:text-[1.75rem]">{title}</h1>
        {intro && <p className="mt-1.5 mb-0 text-muted">{intro}</p>}
      </div>
      {action}
    </header>
  );
}
