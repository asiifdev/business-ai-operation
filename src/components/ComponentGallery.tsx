import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { ThemeToggle } from './ui/ThemeToggle';
import { LocaleSwitch } from './ui/LocaleSwitch';
import { FormField } from './forms/FormField';
import { TextInput } from './forms/TextInput';
import { NumberInput } from './forms/NumberInput';
import { MoneyInput } from './forms/MoneyInput';
import { DateInput } from './forms/DateInput';
import { SelectMenu } from './forms/SelectMenu';
import { Textarea } from './forms/Textarea';
import { Checkbox, CheckboxGroup } from './forms/Checkbox';
import { RadioGroup } from './forms/RadioGroup';
import { Toggle } from './forms/Toggle';
import { FileInput } from './forms/FileInput';
import { formatRupiah } from '../lib/format';

const statuses = [
  { value: 'lead', label: 'Lead' },
  { value: 'proposal', label: 'Proposal sent', description: 'Waiting for the client to answer' },
  { value: 'won', label: 'Won' },
];
const clients = ['Aksara Studio', 'Bintang Digital', 'Cakra Retail', 'Dwipa Logistik', 'Estu Kreatif', 'Fajar Media', 'Gema Kopi', 'Harmoni Klinik'].map((c) => ({ value: c.toLowerCase().replace(/ /g, '-'), label: c }));

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule py-8">
      <h2 className="m-0 text-xl font-semibold text-ink">{title}</h2>
      {note && <p className="mt-1 mb-5 text-sm text-muted">{note}</p>}
      <div className="mt-4 grid gap-6 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function ComponentGallery() {
  const [amount, setAmount] = useState<number | null>(1500000);
  const [date, setDate] = useState('2026-11-04');
  const [status, setStatus] = useState('proposal');
  const [pct, setPct] = useState(35);

  useEffect(() => {
    const id = setInterval(() => setPct((p) => (p >= 100 ? 0 : p + 5)), 600);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between gap-4 py-6">
        <div>
          <h1 className="m-0 text-3xl font-semibold">Form components</h1>
          <p className="m-0 mt-1 text-sm text-muted">Development gallery. Switch theme to check light and dark.</p>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>

      <Section title="Buttons" note="Keycap style: lifts on hover, sinks on press. Loading blocks repeat clicks.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Save invoice</Button>
          <Button>Cancel</Button>
          <Button variant="danger">Delete draft</Button>
          <Button variant="link">View history</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading>Saving…</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Text input" note="Prefix, suffix, icon, clear button, error and valid states.">
        <FormField label="Client name" required help="Shown on the invoice exactly as typed.">
          <TextInput placeholder="PT Aksara Studio" clearable defaultValue="PT Aksara Studio" />
        </FormField>
        <FormField label="Billing email" error="Enter a complete email address." required>
          <TextInput type="email" defaultValue="finance@aksara" />
        </FormField>
        <FormField label="Website" help="Optional." showOptional>
          <TextInput prefix="https://" placeholder="aksara.example" size="sm" />
        </FormField>
        <FormField label="Tax ID" tip="Used on invoices when the client is a registered business. You can leave it empty for individuals.">
          <TextInput defaultValue="01.234.567.8-901.000" valid />
        </FormField>
        <FormField label="Locked field">
          <TextInput defaultValue="Cannot be edited" disabled />
        </FormField>
      </Section>

      <Section title="Number input" note="Letters are ignored. Arrow keys step. Out-of-range values show a message.">
        <FormField label="Payment terms (days)" help="Invoices become overdue after this many days.">
          <NumberInput defaultValue={14} min={0} max={120} suffix="days" name="terms" />
        </FormField>
        <FormField label="Discount" help="Decimal steps are allowed here.">
          <NumberInput defaultValue={7.5} min={0} max={100} step={0.5} suffix="%" />
        </FormField>
      </Section>

      <Section title="Money input" note="Type 500k, 2rb or 1,5jt then press Enter. The submitted value is a plain integer.">
        <div>
          <FormField label="Invoice amount" required help="Whole Rupiah, before tax.">
            <MoneyInput value={amount} onChange={setAmount} min={10000} name="amount" />
          </FormField>
          <p className="mt-2 text-sm text-muted">Value held: <code className="font-mono text-ink">{amount === null ? 'null' : amount}</code> · Display: {amount === null ? '—' : formatRupiah(amount)}</p>
        </div>
        <FormField label="Retainer" error="Enter an amount.">
          <MoneyInput placeholder="0" />
        </FormField>
      </Section>

      <Section title="Date input" note="Type DD/MM/YYYY or open the calendar. The submitted value is YYYY-MM-DD.">
        <div>
          <FormField label="Due date" required help="Reminders start 7 days before.">
            <DateInput value={date} onChange={setDate} min="2026-10-28" name="due" />
          </FormField>
          <p className="mt-2 text-sm text-muted">Value held: <code className="font-mono text-ink">{date || '""'}</code></p>
        </div>
        <FormField label="Start date">
          <DateInput disabled defaultValue="2026-10-28" />
        </FormField>
      </Section>

      <Section title="Select menu" note="Search appears above 7 options. Arrow keys, Home/End, Enter, Escape.">
        <FormField label="Pipeline stage" help="Where this lead is today.">
          <SelectMenu options={statuses} value={status} onChange={setStatus} name="stage" />
        </FormField>
        <FormField label="Client" help="Search by name.">
          <SelectMenu options={clients} placeholder="Choose a client" />
        </FormField>
        <FormField label="Filter by stage">
          <SelectMenu options={statuses} includeAll defaultValue="" />
        </FormField>
        <FormField label="Owner" error="Choose an owner.">
          <SelectMenu options={clients.slice(0, 3)} placeholder="Choose an owner" />
        </FormField>
        <FormField label="Locked select">
          <SelectMenu options={statuses} defaultValue="won" disabled />
        </FormField>
      </Section>

      <Section title="Textarea" note="Grows with the text up to 480px, with a character counter.">
        <FormField label="Internal note" help="Only your team sees this.">
          <Textarea maxLength={280} counter placeholder="What did the client ask for?" />
        </FormField>
        <FormField label="Scope" error="Describe the scope in at least one sentence.">
          <Textarea />
        </FormField>
      </Section>

      <Section title="Checkbox, radio, toggle" note="Whole rows are clickable. Descriptions say what changes.">
        <FormField label="Send reminders to">
          <CheckboxGroup
            name="channels"
            defaultValue={['email']}
            options={[
              { value: 'email', label: 'Email', description: 'The billing contact receives the invoice reminder.' },
              { value: 'telegram', label: 'Telegram', description: 'Your team gets an approval card first.' },
              { value: 'sms', label: 'SMS', disabled: true, description: 'Not available yet.' },
            ]}
          />
        </FormField>
        <FormField label="Billing cycle">
          <RadioGroup name="cycle" defaultValue="monthly" options={[
            { value: 'monthly', label: 'Monthly', description: 'Invoice on the 1st.' },
            { value: 'yearly', label: 'Yearly', description: 'One invoice, 10% discount.' },
          ]} />
        </FormField>
        <FormField label="View">
          <RadioGroup variant="segmented" defaultValue="all" options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'paid', label: 'Paid' }]} />
        </FormField>
        <div>
          <Checkbox label="I confirmed the amounts" description="Required before the invoice can be finalized." />
          <Toggle name="auto" defaultChecked label="Remind automatically" description="When on, overdue invoices create a task for you to approve." />
          <Toggle label="Locked toggle" disabled />
        </div>
      </Section>

      <Section title="File input" note="Type is checked by MIME, size by bytes. Audio and images get a preview. Progress is simulated here.">
        <FormField label="Meeting recording" required help="Audio up to 10 minutes and 32 MB.">
          <FileInput accept={['audio/*']} maxSize={32 * 1024 * 1024} progress={() => pct} name="recording" />
        </FormField>
        <FormField label="Logo" help="PNG or JPEG, up to 2 MB.">
          <FileInput accept={['image/png', 'image/jpeg']} maxSize={2 * 1024 * 1024} multiple maxFiles={3} />
        </FormField>
      </Section>
    </main>
  );
}
