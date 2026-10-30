import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '../../lib/cx';

/** One raised surface for app screens: a lighter sheet on the page colour with a hairline edge and a soft lift. Never nest one inside another: use a divider or a table instead. */
export function Panel({ className, ...rest }: ComponentPropsWithoutRef<'section'>) {
  return <section {...rest} className={cx('rounded-card border border-rule bg-key-face p-4 shadow-card sm:p-5', className)} />;
}
