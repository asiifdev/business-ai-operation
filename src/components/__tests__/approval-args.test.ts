import { describe, expect, it } from 'vitest';
import { approvalArgRows } from '../actions/approvalArgs';
import { messages } from '../../lib/i18n';

const t = ((k: string) => (messages.id as Record<string, string>)[k] ?? k) as never;

describe('approvalArgRows', () => {
  it('returns a list of packages as items with a Rupiah price and one bullet per feature, never [object Object]', () => {
    const rows = approvalArgRows({ name: 'invly.id', packages: [{ name: 'Basic', monthlyPrice: 125000 }, { name: 'Pro', monthlyPrice: 250000, features: 'Stok, Catatan (audit, log); API' }] }, t);
    const row = rows.find((r) => r.key === 'packages')!;
    expect(row.label).toBe('Paket');
    expect(row.items).toEqual([
      { title: 'Basic', price: 'Rp 125.000/bulan', details: [] },
      { title: 'Pro', price: 'Rp 250.000/bulan', details: ['Stok', 'Catatan (audit, log)', 'API'] },
    ]);
    expect(row.value).not.toContain('object');
  });
  it('returns clients as items', () => {
    const row = approvalArgRows({ clients: [{ name: 'Pak Fatoni', phone: '0812' }, { name: 'Bu Ani' }] }, t).find((r) => r.key === 'clients')!;
    expect(row.items).toEqual([{ title: 'Pak Fatoni', price: undefined, details: ['0812'] }, { title: 'Bu Ani', price: undefined, details: [] }]);
  });
});
