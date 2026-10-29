import { describe, expect, it } from 'vitest';
import { documentPatchSchema, documentSchema, foreignFigures, formatDocumentNumber } from '../rules';

describe('document numbers (BR-M06-04)', () => {
  it('uses a prefix per kind, the year and four digits', () => {
    expect(formatDocumentNumber('proposal', 2026, 7)).toBe('PRO-2026-0007');
    expect(formatDocumentNumber('quotation', 2026, 12)).toBe('QUO-2026-0012');
    expect(formatDocumentNumber('minutes', 2027, 1)).toBe('MIN-2027-0001');
  });
});

describe('document input', () => {
  it('needs a client or a lead', () => {
    const base = { kind: 'proposal', title: 'Proposal CRM', items: [{ packageId: 'p1', quantity: 1 }] } as const;
    expect(documentSchema.safeParse(base).success).toBe(false);
    expect(documentSchema.safeParse({ ...base, leadId: 'l1' }).success).toBe(true);
  });

  it('drops a price typed on a package line, so the official price always wins (BR-M06-01)', () => {
    const parsed = documentSchema.parse({ kind: 'proposal', title: 'Proposal CRM', clientId: 'c1', items: [{ packageId: 'p1', quantity: 2, unitPrice: 1 }] });
    expect(parsed.items[0]).toEqual({ packageId: 'p1', quantity: 2 });
  });

  it('does not accept minutes as a priced kind, or an empty item list', () => {
    expect(documentSchema.safeParse({ kind: 'minutes', title: 'Notulen', clientId: 'c1', items: [{ packageId: 'p1', quantity: 1 }] }).success).toBe(false);
    expect(documentSchema.safeParse({ kind: 'quotation', title: 'Quote', clientId: 'c1', items: [] }).success).toBe(false);
  });

  it('allows clearing the narrative with an empty string', () => {
    expect(documentPatchSchema.parse({ narrative: '' }).narrative).toBeNull();
  });
});

describe('figures in an AI narrative (BR-M06-01, -11)', () => {
  const facts = 'Judul dokumen: Proposal CRM\nItem yang ditawarkan:\n- Orbit CRM — Bisnis';
  it('accepts words with no figures', () => {
    expect(foreignFigures('Kami menawarkan Orbit CRM paket Bisnis untuk tim Anda.', facts)).toEqual([]);
  });
  it('flags a price or a discount the model made up', () => {
    expect(foreignFigures('Harga hanya Rp 1.000 per bulan, diskon 90%.', facts).length).toBeGreaterThan(0);
  });
});
