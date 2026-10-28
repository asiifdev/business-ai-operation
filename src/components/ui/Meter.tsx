import { cx } from '../../lib/cx';

interface Props {
  value: number;
  max: number;
  label: string;
  /** Draws the bar in the danger colour (for example a spent budget). */
  danger?: boolean;
  className?: string;
}

/** A plain horizontal gauge with `role="meter"`. The fill is a static width: it changes with data, it is never animated. */
export function Meter({ value, max, label, danger = false, className }: Props) {
  const percent = max <= 0 ? 100 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className={cx('h-2 w-full overflow-hidden rounded-full bg-paper-3', className)}>
      <div className={cx('h-full rounded-full', danger ? 'bg-danger' : 'bg-accent')} style={{ width: `${percent}%` }} />
    </div>
  );
}
