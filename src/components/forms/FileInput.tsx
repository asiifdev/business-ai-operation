import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/use-t';
import { cx } from '../../lib/cx';
import { formatBytes } from '../../lib/format';
import { checkFiles, type FileProblem } from '../../lib/files';
import { InputError } from './InputError';
import { mergeDescribedBy, useFieldControl } from './field';

interface Props {
  /** Allowed MIME types, e.g. ["audio/*", "image/png"]. Extensions are not accepted on purpose. */
  accept: readonly string[];
  /** Maximum size per file in bytes. */
  maxSize?: number;
  multiple?: boolean;
  maxFiles?: number;
  name?: string;
  onChange?: (files: File[]) => void;
  onReject?: (problems: FileProblem[]) => void;
  /** Upload progress 0-100 for a file, if the caller is uploading it. */
  progress?: (file: File) => number | undefined;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function FileInput({ accept, maxSize, multiple = false, maxFiles, name, onChange, onReject, progress, disabled, id, className }: Props) {
  const t = useT();
  const field = useFieldControl({ id });
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const errId = `${field.id}-err`;
  const limit = multiple ? (maxFiles ?? Infinity) : 1;

  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') || f.type.startsWith('audio/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const sync = (next: File[]) => {
    setFiles(next);
    try {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      if (input.current) input.current.files = dt.files;
    } catch {
      /* DataTransfer is unavailable outside browsers; the state above is still the source of truth. */
    }
    onChange?.(next);
  };

  const add = (incoming: File[]) => {
    const { accepted, problems } = checkFiles(incoming, accept, maxSize);
    const msgs = problems.map((p) => (p.reason === 'type' ? t('wrongType', { name: p.file.name }) : t('tooBig', { name: p.file.name, max: formatBytes(maxSize ?? 0) })));
    let next = multiple ? [...files, ...accepted] : accepted.slice(0, 1);
    if (next.length > limit) {
      next = next.slice(0, limit);
      msgs.push(t('tooMany', { count: limit }));
    }
    setMessages(msgs);
    if (problems.length) onReject?.(problems);
    if (accepted.length || !multiple) sync(next.length ? next : files);
  };

  const accepting = accept.join(',');

  return (
    <div className={className}>
      <label
        htmlFor={field.id}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) add(Array.from(e.dataTransfer.files)); }}
        className={cx(
          'flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors duration-(--duration-micro) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
          dragging ? 'border-accent bg-accent-wash' : 'border-rule-2 bg-paper hover:border-muted hover:bg-paper-2',
          disabled && 'cursor-not-allowed opacity-50 hover:border-rule-2 hover:bg-paper',
          messages.length > 0 && 'border-danger',
        )}
      >
        <input
          ref={input}
          id={field.id}
          type="file"
          name={name}
          multiple={multiple}
          accept={accepting}
          disabled={disabled}
          aria-describedby={mergeDescribedBy(field.describedBy, messages.length > 0 && errId)}
          aria-invalid={messages.length > 0 || field.invalid || undefined}
          onChange={(e) => { add(Array.from(e.currentTarget.files ?? [])); }}
          className="sr-only"
        />
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <span className="text-base text-ink">{multiple ? t('dropOrClickMany') : t('dropOrClick')}</span>
        <span className="text-sm text-muted">
          {accept.join(', ')}
          {maxSize !== undefined && ` · max ${formatBytes(maxSize)}`}
        </span>
      </label>
      <InputError id={errId} messages={messages} className="mt-2" />
      {files.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {files.map((f, i) => {
            const pct = progress?.(f);
            return (
              <li key={`${f.name}-${f.size}-${i}`} className="flex flex-col gap-2 rounded-input border border-rule bg-paper p-2">
                <div className="flex items-center gap-3">
                  {previews[i] && f.type.startsWith('image/') && <img src={previews[i]!} alt="" className="size-10 rounded object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm text-ink">{f.name}</p>
                    <p className="m-0 text-xs text-muted">{formatBytes(f.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => sync(files.filter((_, j) => j !== i))}
                    className="rounded px-2 py-1 text-sm text-muted transition-colors duration-(--duration-micro) hover:bg-paper-3 hover:text-danger"
                  >
                    {t('remove')}
                  </button>
                </div>
                {previews[i] && f.type.startsWith('audio/') && <audio controls src={previews[i]!} className="h-9 w-full" />}
                {pct !== undefined && (
                  <div role="progressbar" aria-label={t('uploading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 overflow-hidden rounded-full bg-paper-3">
                    <div className="h-full bg-accent transition-[width] duration-(--duration-micro)" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
