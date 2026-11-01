/**
 * Where each thing the assistant talks about can be opened in the app. One table for the server (which attaches a
 * shortcut under an answer) and the page (which links the drafts), so a route is named in one place only.
 */
export type EntityKind = 'task' | 'invoice' | 'lead' | 'klien' | 'dokumen' | 'flow' | 'produk' | 'langganan' | 'rapat' | 'setup';

export const ENTITY_HREF: Record<EntityKind, (id: string) => string> = {
  task: (id) => `/app/task/${id}`,
  invoice: (id) => `/app/invoice/${id}`,
  lead: (id) => `/app/lead/${id}`,
  klien: (id) => `/app/klien/${id}`,
  dokumen: (id) => `/app/dokumen/${id}`,
  flow: (id) => `/app/flow/${id}`,
  produk: (id) => `/app/produk/${id}`,
  langganan: (id) => `/app/langganan/${id}`,
  rapat: (id) => `/app/rapat/${id}`,
  setup: (id) => `/app/setup/${id}`,
};

/** The kind of thing each read or draft tool returns (its ids are opened at `ENTITY_HREF`). */
export const TOOL_ENTITY: Record<string, EntityKind> = {
  list_tasks: 'task', find_similar_tasks: 'task', draft_task: 'task', get_task: 'task',
  list_invoices: 'invoice', get_invoice: 'invoice', draft_invoice: 'invoice',
  list_leads: 'lead', draft_lead: 'lead', get_lead: 'lead',
  list_clients: 'klien', get_client_overview: 'klien',
  list_documents: 'dokumen', draft_proposal: 'dokumen', get_document: 'dokumen',
  list_flows: 'flow', get_flow: 'flow', draft_flow: 'flow',
  list_products: 'produk', get_product_packages: 'produk',
  list_subscriptions: 'langganan', get_subscription: 'langganan',
  list_meetings: 'rapat', get_meeting: 'rapat',
  list_setup_runs: 'setup', get_setup_run: 'setup', plan_flow_run: 'setup',
};

const LABEL_KEYS = ['judul', 'nama', 'nomor'] as const;

export interface EntityRef {
  kind: EntityKind;
  id: string;
  label: string;
}

/** Things named in a tool's result (an object with an id and a title, name or number), so an answer that names one can link to it. Depth is capped: only the rows a tool lists, not what is nested inside them. */
export function entitiesFromOutput(tool: string, output: unknown): EntityRef[] {
  const kind = TOOL_ENTITY[tool];
  if (!kind) return [];
  const found: EntityRef[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 2 || found.length >= 60) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.id === 'string') {
      const label = LABEL_KEYS.map((k) => row[k]).find((v): v is string => typeof v === 'string' && v.trim().length > 1);
      if (label) found.push({ kind, id: row.id, label: label.trim() });
    }
    if (depth === 0) for (const nested of Object.values(row)) if (Array.isArray(nested)) visit(nested, depth);
  };
  visit(output, 0);
  return found;
}

/** The shortcuts for an answer: every thing from the run whose name the answer actually uses (longest names first, no repeats). */
export function linksForAnswer(text: string, entities: readonly EntityRef[], max = 4): Array<{ label: string; href: string }> {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const out: Array<{ label: string; href: string }> = [];
  for (const e of [...entities].sort((a, b) => b.label.length - a.label.length)) {
    const key = `${e.kind}:${e.id}`;
    if (seen.has(key) || !lower.includes(e.label.toLowerCase())) continue;
    seen.add(key);
    out.push({ label: e.label.length > 48 ? `${e.label.slice(0, 47)}…` : e.label, href: ENTITY_HREF[e.kind](e.id) });
    if (out.length >= max) break;
  }
  return out;
}
