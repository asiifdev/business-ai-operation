import { describe, expect, it } from 'vitest';
import { ASPECTS, brandKitSchema, factsText, fallbackImagePrompt, foreignCaptionFigures, generateSchema, remainingQuota } from '../rules';

const product = { name: 'Orbit CRM', description: 'CRM untuk agensi kecil', packages: [{ name: 'Bisnis', price: 'Rp 450.000', features: 'hingga 10 pengguna' }] };
const brand = { brandName: 'Aksara', colors: '#1F3A5F', tone: 'ramah', prohibitions: 'kompetitor' };

describe('M10 marketing rules', () => {
  it('lists only the product and package facts in the facts text', () => {
    const facts = factsText(product, brand);
    expect(facts).toContain('Paket Bisnis: Rp 450.000 per bulan');
    expect(facts).toContain('Larangan: kompetitor');
    expect(facts).not.toMatch(/pengguna aktif|testimoni/i);
  });

  it('keeps a caption that only quotes the official price and its own feature numbers', () => {
    const facts = factsText(product, brand);
    expect(foreignCaptionFigures('Orbit CRM paket Bisnis Rp 450.000 per bulan, untuk hingga 10 pengguna.', facts)).toEqual([]);
  });

  it('flags a caption with an invented price, discount or user count (BR-M10-01, -02)', () => {
    const facts = factsText(product, brand);
    expect(foreignCaptionFigures('Hanya Rp 299.000 per bulan!', facts).length).toBeGreaterThan(0);
    expect(foreignCaptionFigures('Dipercaya 5.000 agensi, diskon 30%.', facts).length).toBeGreaterThan(0);
  });

  it('builds a fallback prompt from facts alone, without text or logos in the picture (BR-M10-05)', () => {
    const prompt = fallbackImagePrompt(product, brand, 'promo', 'cahaya pagi');
    expect(prompt).toContain('Orbit CRM');
    expect(prompt).toContain('cahaya pagi');
    expect(prompt).toMatch(/No text, letters, numbers, logos/);
    expect(prompt).not.toContain('450');
  });

  it('validates input: variants 1 to 4, known aspect, purpose from the list', () => {
    expect(generateSchema.parse({ productId: 'p', purpose: 'promo' })).toMatchObject({ variants: 1, aspect: 'square' });
    expect(generateSchema.safeParse({ productId: 'p', purpose: 'promo', variants: 5 }).success).toBe(false);
    expect(generateSchema.safeParse({ productId: 'p', purpose: 'video' }).success).toBe(false);
    expect(generateSchema.safeParse({ productId: 'p', purpose: 'promo', aspect: 'huge' }).success).toBe(false);
    expect(brandKitSchema.safeParse({ brandName: 'A' }).success).toBe(false);
    expect(Object.keys(ASPECTS)).toEqual(['square', 'portrait', 'story', 'wide']);
  });

  it('never reports a negative quota', () => {
    expect(remainingQuota(20, 5)).toBe(15);
    expect(remainingQuota(20, 25)).toBe(0);
  });
});
