import { useRef, type ReactNode } from 'react';

interface Props {
  /** Called with the files chosen; the picker is reset so the same file can be chosen again. */
  onPick: (files: File[]) => void;
  /** File types the picker offers, as for `accept` on a file input (extensions and MIME types). */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}

/** A button that opens the system file picker, for places where the big drop zone does not fit (a chat box). The files are the caller's to check. */
export function FilePickButton({ onPick, accept, multiple = true, disabled, label, className, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length) onPick(files);
        }}
      />
      <button type="button" disabled={disabled} aria-label={label} title={label} className={className} onClick={() => input.current?.click()}>
        {children}
      </button>
    </>
  );
}
