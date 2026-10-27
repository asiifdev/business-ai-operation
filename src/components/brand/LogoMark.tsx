/**
 * The Orbyte mark: a ring with three nodes. Colours come from theme tokens so it keeps >= 3:1 contrast on both
 * light and dark paper (the original logo's ring is only 2.2:1 on navy). Provisional redraw until the official export exists.
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <circle cx="50" cy="50" r="33" fill="none" stroke="var(--color-brand-ring)" strokeWidth="9" />
      <circle cx="50" cy="50" r="9" fill="var(--color-brand-node)" />
      <circle cx="50" cy="17" r="8" fill="var(--color-brand-node)" />
      <circle cx="21.4" cy="66.5" r="8" fill="var(--color-brand-node)" />
      <circle cx="78.6" cy="66.5" r="8" fill="var(--color-brand-node)" />
    </svg>
  );
}

/** Logotype: uppercase, wide-tracked, in the wordmark font. Colour follows the text token. */
export function Wordmark({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`font-wordmark uppercase tracking-[0.14em] ${className}`}>{name}</span>;
}
