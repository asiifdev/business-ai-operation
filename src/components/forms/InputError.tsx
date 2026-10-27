import { cx } from '../../lib/cx';

interface Props {
  id?: string;
  messages?: string | readonly string[] | null;
  className?: string;
}

export function InputError({ id, messages, className }: Props) {
  const list = (Array.isArray(messages) ? messages : messages ? [messages] : []) as string[];
  if (list.length === 0) return null;
  return (
    <ul id={id} role="alert" className={cx('m-0 list-none space-y-0.5 p-0 text-sm text-danger', className)}>
      {list.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}
