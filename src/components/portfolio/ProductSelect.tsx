import { useState } from 'react';
import { useT } from '../../lib/use-t';
import { SelectMenu } from '../forms/SelectMenu';
import { QuickProductModal, type NewProduct } from './QuickProductModal';

/** A product picker that can also add the product that is missing, in place (the same idea as `ClientSelect`). */
export function ProductSelect({ products, value, onChange, placeholder, includeAll, disabled, error, canCreate = true }: {
  products: ReadonlyArray<{ id: string; name: string; description?: string }>;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  includeAll?: string;
  disabled?: boolean;
  error?: boolean;
  /** Adding a product is for managers; a form that knows the person is staff turns it off. */
  canCreate?: boolean;
}) {
  const t = useT();
  const [added, setAdded] = useState<NewProduct[]>([]);
  const [adding, setAdding] = useState(false);
  const all: Array<{ id: string; name: string; description?: string }> = [...products, ...added.filter((a) => !products.some((p) => p.id === a.id))];
  return (
    <>
      <SelectMenu
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        includeAll={includeAll}
        disabled={disabled}
        error={error}
        options={all.map((p) => ({ value: p.id, label: p.name, description: p.description }))}
        createLabel={canCreate ? t('quickProductCreate') : undefined}
        onCreate={canCreate ? () => setAdding(true) : undefined}
      />
      {canCreate && (
        <QuickProductModal
          open={adding}
          onClose={() => setAdding(false)}
          onCreated={(product) => {
            setAdded((list) => [...list, product]);
            onChange(product.id);
          }}
        />
      )}
    </>
  );
}
