import { brand } from '../config/brand';
import { pageUrl, site, type Locale } from '../config/site';
import { competitors, formatIdr, formatUsd, plans, pricingAsOf } from '../content/pricing';
import { features, statusLabel } from '../content/features';
import type { PageSlug } from '../content/site/types';
import { readChangelog } from './changelog';
import { fill, getPage } from './marketing';

/** Plain-text pricing, identical in substance to /pricing (BR-M16-22). Generated from the same registry. */
export function pricingMarkdown(locale: Locale): string {
  const usd = locale === 'en';
  const out: string[] = [`# ${brand.name} pricing (planned)`, ''];
  out.push(
    locale === 'en'
      ? `Status: planned. Platform billing is not live yet, so early-access organizations are not charged. Prices checked against public competitor prices on ${pricingAsOf}. They may change before billing starts.`
      : `Status: direncanakan. Penagihan platform belum aktif, jadi organisasi akses awal tidak dikenai biaya. Harga diperiksa terhadap harga publik pesaing pada ${pricingAsOf}. Dapat berubah sebelum penagihan dimulai.`,
    '',
  );
  for (const p of plans) {
    out.push(`## ${p.name}`);
    if (p.usdAnnual === null) out.push(locale === 'en' ? '- Price: custom, contact us' : '- Harga: khusus, hubungi kami');
    else if (usd) out.push(`- Price: ${formatUsd(p.usdAnnual)} per user per month billed annually${p.usdMonthly ? `, ${formatUsd(p.usdMonthly)} billed monthly` : ''}`);
    else out.push(`- Harga: ${p.idrAnnual === 0 ? 'Rp 0' : formatIdr(p.idrAnnual ?? 0)} per pengguna per bulan, tagihan tahunan`);
    if (p.minUsers) out.push(usd ? `- Minimum users: ${p.minUsers}` : `- Minimal pengguna: ${p.minUsers}`);
    out.push(`- ${usd ? 'For' : 'Untuk'}: ${p.audience[locale]}`);
    for (const l of p.limits[locale]) out.push(`- ${usd ? 'Limit' : 'Batas'}: ${l}`);
    out.push('');
  }
  return out.join('\n');
}

/** One page as Markdown for llms-full.txt. */
export function pageToMarkdown(locale: Locale, slug: PageSlug): string {
  const p = getPage(locale, slug);
  const out: string[] = [`# ${fill(p.h1)}`, '', `URL: ${pageUrl(locale, slug)}`, `Updated: ${p.updated}`, '', fill(p.answer), ''];
  if (slug === '' && p.home) {
    p.home.stages.forEach((s, i) => out.push(`## ${i + 1}. ${fill(s.title)}`, '', fill(s.body), ''));
  }
  if (slug === 'product' || slug === '') {
    out.push(locale === 'en' ? '## Status of each capability' : '## Status tiap kemampuan', '');
    for (const f of features) out.push(`- ${f.name[locale]}: ${statusLabel[f.status][locale]}. ${f.summary[locale]}`);
    out.push('');
  }
  for (const s of p.sections ?? []) {
    out.push(`## ${fill(s.heading)}`, '');
    for (const para of s.paragraphs ?? []) out.push(fill(para), '');
    for (const b of s.bullets ?? []) out.push(`- ${fill(b)}`);
    if (s.bullets?.length) out.push('');
  }
  if (slug === 'pricing') out.push(pricingMarkdown(locale).replace(/^# .*\n\n/, ''), '');
  if (slug === 'compare') {
    for (const c of competitors) out.push(`- ${c.vendor}: ${c.summary[locale]} (${c.source})`);
    out.push('');
  }
  if (slug === 'changelog') {
    for (const g of readChangelog().unreleased) {
      out.push(`## ${g.title} (Unreleased)`, '');
      for (const item of g.items) out.push(`- ${item}`);
      out.push('');
    }
  }
  if (p.faq?.length) {
    out.push(locale === 'en' ? '## Frequently asked questions' : '## Pertanyaan yang sering diajukan', '');
    for (const f of p.faq) out.push(`### ${fill(f.q)}`, '', fill(f.a), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export const siteSummary = (locale: Locale) =>
  locale === 'en'
    ? `${brand.name} is an AI business operating system for agencies and software houses, made by ${brand.publisher.legalName}. Early access is open; capabilities are marked with their real status.`
    : `${brand.name} adalah sistem operasi bisnis berbasis AI untuk agensi dan software house, dibuat oleh ${brand.publisher.legalName}. Akses awal dibuka; kemampuan diberi status sebenarnya.`;

export const origin = site.url;
