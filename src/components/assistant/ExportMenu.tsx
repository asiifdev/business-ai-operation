import { Icon } from '../shell/Icon';
import { useT } from '../../lib/use-t';
import { Dropdown } from '../ui/Dropdown';

/** Download the open conversation as a file: Markdown to read or paste, plain text, or JSON with everything the assistant stored. */
export function ExportMenu({ sessionId, disabled = false, size = 'sm' }: { sessionId: string | null; disabled?: boolean; size?: 'md' | 'sm' }) {
  const t = useT();
  if (!sessionId || disabled) return null;
  const href = (format: string) => `/api/assistant/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`;
  return (
    <Dropdown
      label={t('exportChat')}
      size={size}
      items={[
        { id: 'md', label: t('exportMd'), href: href('md'), download: true },
        { id: 'txt', label: t('exportTxt'), href: href('txt'), download: true },
        { id: 'json', label: t('exportJson'), href: href('json'), download: true },
      ]}
    >
      <Icon name="download" className="size-4" />
      <span className="max-sm:sr-only">{t('exportChat')}</span>
    </Dropdown>
  );
}
