/** Shared class strings so every control shares one visual contract. All colours are tokens. */

export const controlShell =
  'flex w-full items-center gap-2 rounded-input border bg-paper text-ink shadow-card transition-colors duration-(--duration-micro) ' +
  'border-rule-2 hover:border-muted focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ' +
  'data-[invalid=true]:border-danger data-[valid=true]:border-success data-[disabled=true]:cursor-not-allowed data-[disabled=true]:bg-paper-2 data-[disabled=true]:text-muted data-[disabled=true]:shadow-none data-[disabled=true]:hover:border-rule-2';

export const controlSize = { md: 'min-h-10 px-3 text-base', sm: 'min-h-8 px-2.5 text-sm' } as const;

export const bareInput =
  'min-w-0 flex-1 bg-transparent py-1.5 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed';

export const addon = 'shrink-0 select-none text-muted';
