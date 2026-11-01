import { describe, expect, it } from 'vitest';
import { entitiesFromOutput, linksForAnswer } from '../entity-links';

describe('links under an assistant answer (D-090)', () => {
  const output = { jumlah: 2, tugas: [{ id: 't1', judul: 'Perbaiki login', status: 'terbuka' }, { id: 't2', judul: 'Update logo', status: 'terbuka' }] };

  it('takes the rows a tool listed, with an id and a title, name or number', () => {
    expect(entitiesFromOutput('list_tasks', output)).toEqual([
      { kind: 'task', id: 't1', label: 'Perbaiki login' },
      { kind: 'task', id: 't2', label: 'Update logo' },
    ]);
    expect(entitiesFromOutput('list_invoices', { invoice: [{ id: 'i1', nomor: 'INV-001' }] })).toEqual([{ kind: 'invoice', id: 'i1', label: 'INV-001' }]);
    expect(entitiesFromOutput('describe_capabilities', output)).toEqual([]);
  });

  it('links only what the answer actually names, to the right page', () => {
    const found = entitiesFromOutput('list_tasks', output);
    expect(linksForAnswer('Silakan ubah tugas "Perbaiki login" secara manual.', found)).toEqual([{ label: 'Perbaiki login', href: '/app/task/t1' }]);
    expect(linksForAnswer('Tidak ada yang disebut.', found)).toEqual([]);
  });
});
