import { describe, expect, it } from 'vitest';
import { mutationToastKey } from '../mutation-toasts';

describe('mutationToastKey', () => {
  it('says nothing for reads', () => {
    expect(mutationToastKey('GET', '/api/clients')).toBeNull();
  });

  it('names a create, a change and a delete', () => {
    expect(mutationToastKey('POST', '/api/tasks')).toBe('toastCreated');
    expect(mutationToastKey('PATCH', '/api/clients/01ABC')).toBe('toastSaved');
    expect(mutationToastKey('DELETE', '/api/products/01ABC')).toBe('toastDeleted');
    expect(mutationToastKey('DELETE', '/api/meetings/01ABC/content')).toBe('toastDeleted');
  });

  it('calls an action on one record "done", ignoring the query string', () => {
    expect(mutationToastKey('POST', '/api/invoices/01ABC/send')).toBe('toastDone');
    expect(mutationToastKey('POST', '/api/leads/01ABC/archive?x=1')).toBe('toastDone');
    expect(mutationToastKey('POST', '/api/approvals/01ABC/decide')).toBe('toastDone');
  });

  it('stays silent for chat, sign-in and screens that raise their own toast', () => {
    expect(mutationToastKey('POST', '/api/assistant/chat')).toBeNull();
    expect(mutationToastKey('POST', '/api/auth/sign-in/email')).toBeNull();
    expect(mutationToastKey('POST', '/api/runs/01ABC/retry')).toBeNull();
  });
});
