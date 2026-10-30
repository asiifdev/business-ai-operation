import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { messages } from '../../lib/i18n';
import { DataTable } from '../ui/DataTable';
import { Dropdown } from '../ui/Dropdown';
import { Tabs } from '../ui/Tabs';

describe('Tabs', () => {
  it('is a labelled tablist with one tab stop, on the selected tab', () => {
    const out = renderToStaticMarkup(<Tabs label="Views" value="b" onChange={() => undefined} items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B', count: 2 }]} />);
    expect(out).toContain('role="tablist" aria-label="Views"');
    expect(out.match(/role="tab"/g)).toHaveLength(2);
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out.match(/tabindex="-1"/g)).toHaveLength(1);
  });
});

describe('DataTable', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, name: `Klien ${i}`, total: i * 1000 }));
  const columns = [
    { id: 'name', header: 'Name', sortValue: (r: (typeof rows)[number]) => r.name, cell: (r: (typeof rows)[number]) => r.name },
    { id: 'total', header: 'Total', align: 'right' as const, cell: (r: (typeof rows)[number]) => String(r.total) },
  ];

  it('shows the first page, a search box, a sortable header and the pager', () => {
    const out = renderToStaticMarkup(<DataTable label="Clients" rows={rows} columns={columns} rowKey={(r) => r.id} search={(r) => r.name} />);
    expect(out).toContain('aria-label="Clients"');
    expect(out.match(/role="row"/g)).toHaveLength(20); // default page size
    expect(out).toContain(`aria-label="${messages.id.tableSearch}"`);
    expect(out).toContain('aria-sort="none"'); // the sortable column
    expect(out).toContain('1–20 dari 25');
    expect(out).toContain(`aria-label="${messages.id.tablePages}"`);
    expect(out).toContain('data-label="Name"'); // phone: each cell names its column
  });

  it('hides the pager when everything fits on one page', () => {
    const out = renderToStaticMarkup(<DataTable label="Clients" rows={rows.slice(0, 5)} columns={columns} rowKey={(r) => r.id} />);
    expect(out).not.toContain(`aria-label="${messages.id.tablePages}"`);
    expect(out).not.toContain(`aria-label="${messages.id.tableSearch}"`);
  });
});

describe('Dropdown', () => {
  it('is a closed menu button until pressed', () => {
    const out = renderToStaticMarkup(<Dropdown items={[{ id: 'a', href: '/x', label: 'Open' }]} />);
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain(`aria-label="${messages.id.menuMore}"`);
    expect(out).not.toContain('role="menu"');
  });
});
