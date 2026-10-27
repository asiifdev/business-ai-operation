import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { Button } from '../ui/Button';
import { Checkbox, CheckboxGroup } from '../forms/Checkbox';
import { DateInput } from '../forms/DateInput';
import { FileInput } from '../forms/FileInput';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { NumberInput } from '../forms/NumberInput';
import { RadioGroup } from '../forms/RadioGroup';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('id'));

describe('FormField', () => {
  it('links label, help and error to the control', () => {
    const out = html(
      <FormField label="Email" required help="We never share it." error="Incomplete address.">
        <TextInput />
      </FormField>,
    );
    const id = /<label[^>]* for="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}"`);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toMatch(/aria-describedby="[^"]+-error [^"]+-help"/);
    expect(out).toContain('role="alert"');
    expect(out).toContain('(required)');
  });
});

describe('controls', () => {
  it('TextInput marks invalid and disabled state', () => {
    const out = html(<TextInput error disabled />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('disabled=""');
  });

  it('MoneyInput shows the Rp prefix and submits a plain integer', () => {
    const out = html(<MoneyInput name="amount" defaultValue={1500000} />);
    expect(out).toContain('>Rp<');
    expect(out).toContain('value="1.500.000"');
    expect(out).toContain('<input type="hidden" name="amount" value="1500000"/>');
  });

  it('NumberInput is a text field with a numeric keyboard, never type=number', () => {
    const out = html(<NumberInput name="n" defaultValue={14} />);
    expect(out).not.toContain('type="number"');
    expect(out).toContain('inputMode="numeric"');
    expect(out).toContain('<input type="hidden" name="n" value="14"/>');
  });

  it('DateInput submits ISO and displays DD/MM/YYYY', () => {
    const out = html(<DateInput name="due" defaultValue="2026-11-04" />);
    expect(out).toContain('value="04/11/2026"');
    expect(out).toContain('<input type="hidden" name="due" value="2026-11-04"/>');
  });

  it('SelectMenu is a listbox combobox that submits its value', () => {
    const out = html(<SelectMenu name="stage" defaultValue="b" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    expect(out).toContain('role="combobox"');
    expect(out).toContain('aria-haspopup="listbox"');
    expect(out).toContain('<input type="hidden" name="stage" value="b"/>');
  });

  it('Textarea shows a counter when maxLength is set', () => {
    expect(html(<Textarea maxLength={100} counter defaultValue="abc" />)).toContain('3 / 100');
  });

  it('Checkbox and group render native checkboxes inside clickable rows', () => {
    expect(html(<Checkbox label="Agree" />)).toMatch(/<label[^>]*><input[^>]*type="checkbox"/);
    const group = html(<CheckboxGroup name="c" defaultValue={['x']} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} />);
    expect(group).toContain('role="group"');
    expect(group.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it('RadioGroup renders radios that share one name', () => {
    const out = html(<RadioGroup name="cycle" defaultValue="m" options={[{ value: 'm', label: 'Monthly' }, { value: 'y', label: 'Yearly' }]} />);
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/name="cycle"/g)).toHaveLength(2);
  });

  it('Toggle is a switch and always submits true or false', () => {
    const off = html(<Toggle label="Auto" name="auto" />);
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('name="auto" value="false"');
    expect(html(<Toggle label="Auto" name="auto" defaultChecked />)).toContain('name="auto" value="true"');
  });

  it('FileInput exposes the accepted MIME types to the picker', () => {
    const out = html(<FileInput accept={['audio/*', 'image/png']} maxSize={1024} />);
    expect(out).toContain('type="file"');
    expect(out).toContain('accept="audio/*,image/png"');
  });

  it('Button defaults to type=button and blocks clicks while loading', () => {
    expect(html(<Button>Go</Button>)).toContain('type="button"');
    const loading = html(<Button loading>Go</Button>);
    expect(loading).toContain('disabled=""');
    expect(loading).toContain('aria-busy="true"');
  });
});

describe('language switch', () => {
  it('renders the same field in Indonesian and English', () => {
    const field = (
      <FormField label="Nama" required>
        <TextInput clearable defaultValue="x" />
      </FormField>
    );
    setLocale('id');
    const id = html(field);
    setLocale('en');
    const en = html(field);
    expect(id).toContain('(wajib)');
    expect(id).toContain('aria-label="Hapus"');
    expect(en).toContain('(required)');
    expect(en).toContain('aria-label="Clear"');
  });
});
