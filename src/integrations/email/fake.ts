import { EmailError, type EmailMessage, type EmailProvider } from './provider';

/** Collects what would be sent, and can be told to fail first, so no test touches a network. */
export class FakeEmailProvider implements EmailProvider {
  readonly sent: Array<{ message: EmailMessage; idempotencyKey: string }> = [];
  private readonly failures: EmailError[];
  constructor(failures: EmailError[] = []) {
    this.failures = [...failures];
  }
  async send(message: EmailMessage, { idempotencyKey }: { idempotencyKey: string }): Promise<{ id: string }> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push({ message, idempotencyKey });
    return { id: `fake_${this.sent.length}` };
  }
}
