import type { Ctx } from '../ctx';
import { getSession, type StoredMessage } from './sessions';

export type ExportFormat = 'md' | 'json' | 'txt';

interface Reply {
  text?: string | null;
  message?: string;
  label?: string;
  links?: Array<{ label: string; href: string }>;
  autoRan?: Array<{ summary: string; executed: boolean; undone?: boolean }>;
  pendingApprovals?: unknown[];
}

const stamp = (d: Date, locale: 'id' | 'en') => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(d);

/** A safe file name from the title: letters, digits and dashes, never a path. */
export const fileNameFor = (title: string, ext: string) => `${title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'percakapan'}.${ext}`;

function lines(messages: StoredMessage[], locale: 'id' | 'en', md: boolean): string[] {
  const you = locale === 'en' ? 'You' : 'Anda';
  const out: string[] = [];
  for (const m of messages) {
    if (m.kind === 'user') {
      const body = m.body as { text?: string; attachments?: Array<{ name: string }> };
      out.push(md ? `### ${you} · ${stamp(m.createdAt, locale)}` : `[${you} · ${stamp(m.createdAt, locale)}]`, '', body.text ?? '');
      if (body.attachments?.length) out.push('', `${locale === 'en' ? 'Attachments' : 'Lampiran'}: ${body.attachments.map((a) => a.name).join(', ')}`);
    } else if (m.kind === 'assistant') {
      const body = m.body as Reply;
      out.push(md ? `### Orbyte · ${stamp(m.createdAt, locale)}` : `[Orbyte · ${stamp(m.createdAt, locale)}]`, '', body.text ?? body.message ?? '');
      for (const a of body.autoRan ?? []) out.push('', `${md ? '- ' : ''}${a.executed ? (a.undone ? (locale === 'en' ? 'Done, then undone' : 'Dikerjakan, lalu dibatalkan') : locale === 'en' ? 'Done' : 'Dikerjakan') : locale === 'en' ? 'Not run' : 'Tidak dijalankan'}: ${a.summary}`);
      if (body.pendingApprovals?.length) out.push('', locale === 'en' ? `Waiting for approval: ${body.pendingApprovals.length}` : `Menunggu persetujuan: ${body.pendingApprovals.length}`);
      for (const l of body.links ?? []) out.push('', `${l.label}: ${l.href}`);
    } else continue;
    out.push('');
  }
  return out;
}

/** One of the person's own conversations as a file (Markdown, plain text or JSON). Only its owner can export it. */
export async function exportSession(ctx: Ctx, id: string, format: ExportFormat, locale: 'id' | 'en' = 'id'): Promise<{ filename: string; mime: string; content: string }> {
  const session = await getSession(ctx, id);
  const heading = `${session.title}`;
  const meta = `${locale === 'en' ? 'Exported' : 'Diekspor'} ${stamp(ctx.clock.now(), locale)}`;
  if (format === 'json') {
    return { filename: fileNameFor(session.title, 'json'), mime: 'application/json; charset=utf-8', content: JSON.stringify({ title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, exportedAt: ctx.clock.now(), messages: session.messages.map((m) => ({ at: m.createdAt, role: m.kind, content: m.body })) }, null, 2) };
  }
  const md = format === 'md';
  const content = [md ? `# ${heading}` : heading, md ? `_${meta}_` : meta, '', ...lines(session.messages, locale, md)].join('\n').trimEnd() + '\n';
  return { filename: fileNameFor(session.title, format), mime: md ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8', content };
}
