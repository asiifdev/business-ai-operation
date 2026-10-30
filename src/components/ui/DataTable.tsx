import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Icon } from '../shell/Icon';
import { Button } from './Button';
import * as tbl from './table';

export interface Column<R> {
  id: string;
  header: string;
  cell: (row: R) => ReactNode;
  /** Makes the column sortable. Numbers sort as numbers, text by the reader's language; empty values go last. */
  sortValue?: (row: R) => string | number | null;
  align?: 'left' | 'right';
  /** On a phone, the cell takes the whole row of the stacked card. */
  full?: boolean;
}

type Sort = { id: string; dir: 'asc' | 'desc' } | null;

const PAGE_SIZES = [10, 20, 50] as const;

function readUrl(): { q: string; sort: Sort; page: number; size: number } {
  const p = new URLSearchParams(window.location.search);
  const s = p.get('sort');
  const size = Number(p.get('size'));
  return {
    q: p.get('q') ?? '',
    sort: s ? { id: s.replace(/^-/, ''), dir: s.startsWith('-') ? 'desc' : 'asc' } : null,
    page: Math.max(1, Number(p.get('page')) || 1),
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : 20,
  };
}

function writeUrl(state: { q: string; sort: Sort; page: number; size: number }) {
  const p = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
  set('q', state.q || null);
  set('sort', state.sort ? `${state.sort.dir === 'desc' ? '-' : ''}${state.sort.id}` : null);
  set('page', state.page > 1 ? String(state.page) : null);
  set('size', state.size !== 20 ? String(state.size) : null);
  const qs = p.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null || a === '') return b === null || b === '' ? 0 : 1;
  if (b === null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * A list of records with search, sort and pages (PRD section 4 M14), on top of the responsive table classes: on a phone
 * each row becomes a stacked card. Search, sort and page live in the URL (`?q=&sort=-total&page=2`), so a view can be
 * shared and survives a reload; other query parameters on the page are kept. Works on the rows it is given: filters the
 * server applies (a status) stay with the page.
 */
export function DataTable<R>({ label, rows, columns, rowKey, search, toolbar, emptyMatch, minWidth = '40rem' }: {
  /** Names the table for assistive technology. */
  label: string;
  rows: readonly R[];
  columns: readonly Column<R>[];
  rowKey: (row: R) => string;
  /** The text a row is searched by. Leave out to hide the search box. */
  search?: (row: R) => string;
  /** Extra controls beside the search box (a status filter). */
  toolbar?: ReactNode;
  /** What to say when the search finds nothing. */
  emptyMatch?: (q: string) => ReactNode;
  minWidth?: string;
}) {
  const t = useT();
  const [state, setState] = useState<{ q: string; sort: Sort; page: number; size: number }>({ q: '', sort: null, page: 1, size: 20 });

  // The URL is read after hydration, so the server and the first browser render agree.
  useEffect(() => setState(readUrl()), []);
  const update = (patch: Partial<typeof state>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeUrl(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = state.q.trim().toLowerCase();
    let out = q && search ? rows.filter((r) => search(r).toLowerCase().includes(q)) : [...rows];
    const col = state.sort && columns.find((c) => c.id === state.sort!.id && c.sortValue);
    if (col && state.sort) {
      const dir = state.sort.dir === 'asc' ? 1 : -1;
      out = out.sort((a, b) => compare(col.sortValue!(a), col.sortValue!(b)) * dir);
    }
    return out;
  }, [rows, columns, search, state.q, state.sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / state.size));
  const page = Math.min(state.page, pages);
  const from = filtered.length === 0 ? 0 : (page - 1) * state.size + 1;
  const to = Math.min(page * state.size, filtered.length);
  const visible = filtered.slice(from === 0 ? 0 : from - 1, to);

  function toggleSort(id: string) {
    const current = state.sort?.id === id ? state.sort.dir : null;
    update({ sort: current === null ? { id, dir: 'asc' } : current === 'asc' ? { id, dir: 'desc' } : null, page: 1 });
  }

  return (
    <div className="flex flex-col gap-3">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-end gap-3">
          {search && (
            <TextInput
              type="search"
              size="sm"
              value={state.q}
              onChange={(e) => update({ q: e.currentTarget.value, page: 1 })}
              clearable
              placeholder={t('tableSearch')}
              aria-label={t('tableSearch')}
              icon={<Icon name="search" className="size-4" />}
              shellClassName="w-full sm:w-64"
            />
          )}
          {toolbar}
          <p className="m-0 ml-auto text-sm text-muted tabular-nums" aria-live="polite">{t('tableShowing', { from, to, total: filtered.length })}</p>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="m-0 py-6 text-center text-sm text-muted">{emptyMatch ? emptyMatch(state.q) : t('tableNoMatch')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table role="table" aria-label={label} className={tbl.table} style={{ minWidth: `min(100%, ${minWidth})` }}>
            <thead className={tbl.thead}>
              <tr className="text-left">
                {columns.map((c) => {
                  const sorted = state.sort?.id === c.id ? state.sort.dir : null;
                  return (
                    <th key={c.id} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : c.sortValue ? 'none' : undefined} className={cx('py-2 pr-3 last:pr-0', c.align === 'right' && 'text-right')}>
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.id)}
                          className={cx('-mx-1 inline-flex items-center gap-1 rounded px-1 font-medium transition-colors duration-(--duration-micro) hover:text-ink active:text-ink', sorted ? 'text-ink' : 'text-muted', c.align === 'right' && 'flex-row-reverse')}
                        >
                          {c.header}
                          <Icon name="chevron" className={cx('size-3.5 transition-transform duration-(--duration-micro)', !sorted && 'opacity-30', sorted === 'asc' && 'rotate-180')} />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className={tbl.tbody}>
              {visible.map((row) => (
                <tr key={rowKey(row)} role="row" className={tbl.row}>
                  {columns.map((c) => (
                    <td key={c.id} data-label={c.header} className={cx('py-3 pr-3 last:pr-0', tbl.label, c.align === 'right' && 'sm:text-right', c.full && tbl.full)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > PAGE_SIZES[0] && (
        <nav aria-label={t('tablePages')} className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
          <FormField label={t('tableRows')} className="w-36">
            <SelectMenu size="sm" searchable={false} value={String(state.size)} onChange={(v) => update({ size: Number(v), page: 1 })} options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
          </FormField>
          <span className="ml-auto self-end pb-1.5 text-sm text-muted tabular-nums">{t('tablePageOf', { page, pages })}</span>
          <Button size="sm" className="self-end" onClick={() => update({ page: page - 1 })} disabled={page <= 1} aria-label={t('tablePrev')}>
            <Icon name="chevron" className="size-4 rotate-90" />
          </Button>
          <Button size="sm" className="self-end" onClick={() => update({ page: page + 1 })} disabled={page >= pages} aria-label={t('tableNext')}>
            <Icon name="chevron" className="size-4 -rotate-90" />
          </Button>
        </nav>
      )}
    </div>
  );
}
