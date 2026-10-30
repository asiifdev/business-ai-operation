import { useState } from 'react';
import { useT } from '../../lib/use-t';
import { SelectMenu } from '../forms/SelectMenu';
import { QuickClientModal, type NewClient } from './QuickClientModal';

/**
 * A client picker that can also add the client that is missing, in place. Used wherever a form needs a client (invoice,
 * subscription, document, task) so a missing client never means leaving the form and losing what was typed.
 */
export function ClientSelect({ clients, value, onChange, placeholder, includeAll, disabled, error }: {
  clients: ReadonlyArray<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  includeAll?: string;
  disabled?: boolean;
  error?: boolean;
}) {
  const t = useT();
  const [added, setAdded] = useState<NewClient[]>([]);
  const [adding, setAdding] = useState(false);
  const all = [...clients, ...added.filter((a) => !clients.some((c) => c.id === a.id))];
  return (
    <>
      <SelectMenu
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        includeAll={includeAll}
        disabled={disabled}
        error={error}
        options={all.map((c) => ({ value: c.id, label: c.name }))}
        createLabel={t('quickClientCreate')}
        onCreate={() => setAdding(true)}
      />
      <QuickClientModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(client) => {
          setAdded((list) => [...list, client]);
          onChange(client.id);
        }}
      />
    </>
  );
}
