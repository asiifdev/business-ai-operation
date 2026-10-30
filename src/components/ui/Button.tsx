import type { ComponentPropsWithRef } from 'react';
import { cx } from '../../lib/cx';

type Variant = 'primary' | 'secondary' | 'danger' | 'link';

interface Props extends Omit<ComponentPropsWithRef<'button'>, 'type'> {
  variant?: Variant;
  size?: 'md' | 'sm';
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-input font-medium whitespace-nowrap select-none ' +
  'transition-[transform,box-shadow,background-color,filter] duration-(--duration-micro) ease-(--ease-out) ' +
  'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100';

const variants: Record<Variant, string> = {
  primary: 'border border-accent-edge/50 bg-accent text-accent-ink shadow-btn-accent hover:brightness-110 active:brightness-95',
  secondary: 'border border-rule-2 bg-key-face text-ink shadow-btn hover:border-muted/40 hover:bg-paper-2 active:bg-paper-3',
  danger: 'border border-danger bg-danger text-paper shadow-btn hover:brightness-110',
  link: 'border border-transparent bg-transparent px-1 text-accent underline decoration-rule-2 underline-offset-4 hover:decoration-accent',
};

const sizes = { md: 'min-h-10 px-4 text-sm', sm: 'min-h-8 px-3 text-sm' } as const;

/** Class names of a button, so links can look like buttons (public pages use <a>). */
export function buttonClasses(variant: Variant = 'secondary', size: 'md' | 'sm' = 'md', className?: string, shape: 'default' | 'pill' = 'default'): string {
  return cx(shape === 'pill' ? base.replace('rounded-input', 'rounded-full') : base, variants[variant], variant !== 'link' && sizes[size], shape === 'pill' && variant !== 'link' && 'px-6', className);
}

export function Button({ variant = 'secondary', size = 'md', loading = false, type = 'button', className, disabled, children, ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading && (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 animate-spin motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="9" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
