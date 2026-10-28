import { describe, expect, it } from 'vitest';
import { parseApprovalCallback } from '../../../integrations/telegram/callback';
import { approvalMessage, findingMessage, outcomeText, tasksMessage } from '../cards';

const invoiceFacts = {
  kind: 'invoice' as const,
  invoiceId: 'inv1',
  number: 'INV-2026-0007',
  status: 'sent' as const,
  clientId: 'c1',
  clientName: 'Klinik <Sehat> & Sentosa',
  dueDate: '2026-10-16',
  total: 1_200_000,
  balance: 700_000,
  overdue: true,
  daysOverdue: 12,
  isAiDraft: false,
};

describe('finding cards', () => {
  it('shows the figures from the record and escapes every name', () => {
    const text = findingMessage('id', { rule: 'invoice_overdue', facts: invoiceFacts, explanation: null, aiRunId: null, href: '/app/invoice/inv1' }, 'https://app.example.test/');
    expect(text).toContain('<b>Invoice lewat jatuh tempo</b>');
    expect(text).toContain('Klinik &lt;Sehat&gt; &amp; Sentosa');
    expect(text).toContain('Rp');
    expect(text).toContain('700.000');
    expect(text).toContain('16/10/2026');
    expect(text).toContain('terlambat 12 hari');
    expect(text).toContain('<a href="https://app.example.test/app/invoice/inv1">');
    expect(text).not.toContain('<Sehat>');
  });

  it('labels a saved AI explanation and escapes it as plain text', () => {
    const text = findingMessage('en', { rule: 'invoice_overdue', facts: invoiceFacts, explanation: 'Pay <b>now</b>', aiRunId: 'run1', href: null });
    expect(text).toContain('AI-assisted');
    expect(text).toContain('Pay &lt;b&gt;now&lt;/b&gt;');
    expect(text).not.toContain('<a href'); // no app address, no link
  });

  it('describes a late task', () => {
    const text = findingMessage('id', {
      rule: 'task_late',
      facts: { kind: 'task', taskId: 't1', title: 'Struk salah', taskKind: 'bug', status: 'open', priority: 'high', dueDate: '2026-10-23', late: true, daysLate: 5, isDraft: false, assigneeName: null, clientId: null, clientName: null },
      explanation: null,
      aiRunId: null,
      href: '/app/task/t1',
    });
    expect(text).toContain('Tugas terlambat');
    expect(text).toContain('Struk salah');
    expect(text).toContain('terlambat 5 hari');
    expect(text).toContain('Belum ada penanggung jawab');
  });
});

describe('approval cards', () => {
  const approval = { id: '01JABCDEFGHJKMNPQRSTVWXYZ0', tool: 'mark_invoice_sent', rationale: 'Tandai draf invoice ini terkirim.', target: { kind: 'invoice' as const, invoiceId: 'inv1', number: null, clientName: 'Kopi Senja', status: 'draft' as const, total: 99_000 }, expiresAt: new Date('2026-10-29T03:00:00Z') };

  it('carries only the approval id in each button, within 64 bytes', () => {
    const { text, keyboard } = approvalMessage('id', approval, () => '29/10/2026 10.00');
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(['Setujui', 'Tolak', 'Detail']);
    for (const b of buttons) {
      expect(new TextEncoder().encode(b.callback_data!).length).toBeLessThanOrEqual(64);
      expect(parseApprovalCallback(b.callback_data)?.approvalId).toBe(approval.id);
    }
    expect(text).toContain('Kopi Senja');
    expect(text).toContain('99.000');
    expect(text).toContain('29/10/2026 10.00');
  });

  it('says who decided, and explains a refusal', () => {
    expect(outcomeText('id', 'approved', 'Rina').line).toContain('(Rina)');
    expect(outcomeText('id', 'already_decided', 'Rina').line).not.toContain('Rina');
    expect(outcomeText('en', 'expired').toast).toBe('This request has expired.');
    expect(outcomeText('id', 'refused').toast.length).toBeLessThanOrEqual(200);
  });
});

describe('/tugas', () => {
  it('lists at most ten tasks and says how many more there are', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Tugas ${i}`, dueDate: '2026-10-30', late: i === 0, daysLate: i === 0 ? 2 : 0, clientName: null, status: 'open' as const }));
    const text = tasksMessage('id', many);
    expect(text.split('\n').filter((l) => l.startsWith('•') || l.startsWith('◦'))).toHaveLength(10);
    expect(text).toContain('…dan 2 lainnya');
    expect(text).toContain('terlambat 2 hari');
    expect(tasksMessage('en', [])).toBe('No open tasks are assigned to you.');
  });
});
