import { formatRupiah } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import { STAGE_LABEL } from '../pipeline/stages';
import { KIND_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '../tasks/labels';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const LABEL: Record<string, MessageKey> = {
  name: 'fName',
  contactName: 'fContact',
  email: 'fEmail',
  phone: 'fPhone',
  address: 'fAddress',
  notes: 'fNotes',
  description: 'fDescription',
  currentVersion: 'fVersion',
  environment: 'fEnvironment',
  label: 'fLabel',
  domain: 'fDomain',
  installedVersion: 'fVersion',
  source: 'fSource',
  needsSummary: 'fNeeds',
  estimatedValue: 'fEstimatedValue',
  lostReason: 'leadLostReason',
  title: 'fTitle',
  priority: 'fPriority',
  kind: 'fKind',
  dueDate: 'fDueDate',
  intervalMonths: 'fSubInterval',
  startedOn: 'fSubStart',
  packages: 'fPackages',
  clients: 'fClients',
};

/** Fields that are only an internal id: the card shows the record they point to instead. */
const hidden = (key: string) => /Id$/.test(key) || key === 'assignedTo' || key === 'planHash';

export interface ArgItem {
  title: string;
  /** A price already written as Rupiah per month. */
  price?: string;
  /** Short facts about the item (features, a phone number): each is one bullet. */
  details: string[];
}

/** Splits a comma list into bullets without cutting inside brackets: "Catatan (audit, log), API" is two bullets, not three. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** One entry of a list (a package, a client): its name, its price as Rupiah, and the rest as short bullets. */
function toItem(item: unknown): ArgItem {
  if (item === null || typeof item !== 'object') return { title: String(item), details: [] };
  const o = item as Record<string, unknown>;
  const rest = Object.entries(o)
    .filter(([k, v]) => !['name', 'title', 'monthlyPrice'].includes(k) && !hidden(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .flatMap(([k, v]) => (k === 'features' ? splitList(String(v)) : [String(v)]));
  return { title: String(o.name ?? o.title ?? ''), price: typeof o.monthlyPrice === 'number' ? `${formatRupiah(o.monthlyPrice)}/bulan` : undefined, details: rest };
}

/**
 * The arguments an approval will run with, as labelled rows in business words (BR-M08-04: what is shown is exactly what
 * runs). Internal ids are left out; a stage, a status or an amount is written the way the rest of the app writes it.
 */
export function approvalArgRows(args: unknown, t: T): Array<{ key: string; label: string; value: string; items?: ArgItem[] }> {
  if (!args || typeof args !== 'object') return [];
  const rows: Array<{ key: string; label: string; value: string; items?: ArgItem[] }> = [];
  for (const [key, raw] of Object.entries(args as Record<string, unknown>)) {
    if (hidden(key) || raw === null || raw === undefined || raw === '') continue;
    const label = key === 'to' ? t('apStage') : key === 'status' ? t('apStatus') : LABEL[key] ? t(LABEL[key]) : key;
    if (Array.isArray(raw)) {
      const items = raw.map(toItem).filter((i) => i.title || i.details.length);
      if (items.length) rows.push({ key, label, value: items.map((i) => i.title).join(', '), items });
      continue;
    }
    let value = typeof raw === 'object' ? toItem(raw).title : String(raw);
    if (!value) continue;
    if (key === 'estimatedValue' && typeof raw === 'number') value = formatRupiah(raw);
    else if (key === 'to' && value in STAGE_LABEL) value = t(STAGE_LABEL[value as keyof typeof STAGE_LABEL]);
    else if (key === 'status' && value in STATUS_LABEL) value = t(STATUS_LABEL[value as keyof typeof STATUS_LABEL]);
    else if (key === 'priority' && value in PRIORITY_LABEL) value = t(PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL]);
    else if (key === 'kind' && value in KIND_LABEL) value = t(KIND_LABEL[value as keyof typeof KIND_LABEL]);
    else if (key === 'intervalMonths') value = t('apMonths', { n: raw as number });
    rows.push({ key, label, value });
  }
  return rows;
}
