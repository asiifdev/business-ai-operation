import { brand } from '../../config/brand';
import type { EmailMessage } from '../../integrations/email/provider';

export type Locale = 'id' | 'en';

/** Every email the system can send, with the data its text needs. A new email is a new member here and a case in `render`. */
export type EmailTemplate =
  | { template: 'invitation'; data: { organizationName: string; inviterName: string; role: 'owner' | 'admin' | 'staff'; link: string; expiresInDays: number; name?: string | null } }
  | { template: 'welcome'; data: { name: string; organizationName: string; link: string } };

export type TemplateName = EmailTemplate['template'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** A link is only ever the address we built; still, a quote in it must not break out of the attribute. */
const safeLink = (s: string) => esc(s);

const ROLE: Record<Locale, Record<'owner' | 'admin' | 'staff', string>> = {
  id: { owner: 'Pemilik', admin: 'Admin', staff: 'Staf' },
  en: { owner: 'Owner', admin: 'Admin', staff: 'Staff' },
};

interface Content {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  button: { label: string; link: string };
  footer: string;
}

/** Plain, table-free HTML with inline styles only: it survives every mail client and needs no image or font host. */
function layout(c: Content, locale: Locale): Pick<EmailMessage, 'html' | 'text'> {
  const html = `<!doctype html>
<html lang="${locale}"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader)}</span>
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
<p style="margin:0 0 20px;font-size:14px;font-weight:700;letter-spacing:.04em;color:#4f46e5;">${esc(brand.name.toUpperCase())}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${esc(c.heading)}</h1>
${c.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(p)}</p>`).join('\n')}
<p style="margin:22px 0;"><a href="${safeLink(c.button.link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${esc(c.button.label)}</a></p>
<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#6b7280;word-break:break-all;">${esc(locale === 'id' ? 'Atau salin alamat ini ke browser:' : 'Or copy this address into your browser:')}<br>${esc(c.button.link)}</p>
<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${esc(c.footer)}</p>
</div></body></html>`;
  const text = [c.heading, '', ...c.paragraphs.flatMap((p) => [p, '']), `${c.button.label}: ${c.button.link}`, '', c.footer].join('\n');
  return { html, text };
}

/** Pure: a template and a language in, subject, HTML and text out. Every value from a person is escaped. */
export function render(input: EmailTemplate, locale: Locale): Omit<EmailMessage, 'to'> {
  const id = locale === 'id';
  let content: Content;
  if (input.template === 'invitation') {
    const d = input.data;
    const role = ROLE[locale][d.role];
    content = id
      ? {
          subject: `${d.inviterName} mengundang Anda ke ${d.organizationName} di ${brand.name}`,
          preheader: `Terima undangan untuk bergabung sebagai ${role}.`,
          heading: d.name ? `Halo ${d.name}, Anda diundang` : 'Anda diundang',
          paragraphs: [
            `${d.inviterName} mengundang Anda bergabung ke ${d.organizationName} di ${brand.name} sebagai ${role}.`,
            `Buka tautan di bawah untuk menetapkan kata sandi Anda sendiri dan mulai bekerja. Tautan berlaku ${d.expiresInDays} hari dan hanya bisa dipakai sekali.`,
          ],
          button: { label: 'Terima undangan', link: d.link },
          footer: 'Bila Anda tidak mengenal undangan ini, abaikan saja email ini. Tidak ada yang berubah sampai tautannya dibuka.',
        }
      : {
          subject: `${d.inviterName} invited you to ${d.organizationName} on ${brand.name}`,
          preheader: `Accept the invitation to join as ${role}.`,
          heading: d.name ? `Hello ${d.name}, you are invited` : 'You are invited',
          paragraphs: [
            `${d.inviterName} invited you to join ${d.organizationName} on ${brand.name} as ${role}.`,
            `Open the link below to choose your own password and get started. The link works for ${d.expiresInDays} days and can be used once.`,
          ],
          button: { label: 'Accept the invitation', link: d.link },
          footer: 'If you do not recognise this invitation, just ignore this email. Nothing changes until the link is opened.',
        };
  } else {
    const d = input.data;
    content = id
      ? {
          subject: `Selamat datang di ${brand.name}`,
          preheader: `${d.organizationName} sudah dibuat. Siapkan dalam beberapa langkah.`,
          heading: `Selamat datang, ${d.name}`,
          paragraphs: [
            `${d.organizationName} sudah dibuat di ${brand.name} dan Anda adalah Pemiliknya.`,
            'Selesaikan penyiapan singkat (profil bisnis, invoice, produk, dan tim) agar sistem siap dipakai maksimal sejak hari pertama.',
          ],
          button: { label: 'Lanjutkan penyiapan', link: d.link },
          footer: `Email ini dikirim karena seseorang mendaftar di ${brand.name} dengan alamat ini.`,
        }
      : {
          subject: `Welcome to ${brand.name}`,
          preheader: `${d.organizationName} is created. Set it up in a few steps.`,
          heading: `Welcome, ${d.name}`,
          paragraphs: [
            `${d.organizationName} was created on ${brand.name} and you are its Owner.`,
            'Finish the short setup (business profile, invoices, products and team) so the system is ready to use fully from day one.',
          ],
          button: { label: 'Continue the setup', link: d.link },
          footer: `You are receiving this because someone signed up to ${brand.name} with this address.`,
        };
  }
  return { subject: content.subject, ...layout(content, locale) };
}
