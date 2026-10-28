import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '../../lib/cx';

/** One bordered surface for app screens. Never nest one inside another: use a divider or a table instead. */
export function Panel({ className, ...rest }: ComponentPropsWithoutRef<'section'>) {
  return <section {...rest} className={cx('rounded-card border border-rule bg-paper p-4 sm:p-6', className)} />;
}
