import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isForbiddenToolName } from '../tools/forbidden';
import { ToolRegistry, defineTool, toolParameters } from '../tools/registry';

const readTool = (over: Record<string, unknown> = {}) =>
  defineTool({
    name: 'list_overdue_invoices',
    description: 'Lists invoices that are past their due date, newest first.',
    tier: 'read',
    permission: 'billing.read',
    args: z.object({ limit: z.number().int().min(1).max(50) }),
    run: async () => [],
    ...over,
  } as never);

describe('forbidden tools (BR-M07-04)', () => {
  it.each([
    'record_payment', 'update_payment', 'set_invoice_status', 'update_invoice_amount', 'set_invoice_due_date',
    'update_package_price', 'delete_client', 'remove_task', 'purge_everything', 'change_role', 'update_org_settings',
    'send_message', 'send_followup_email', 'set_ai_budget', 'create_payment_record', 'update_anything_price',
  ])('%s is forbidden', (name) => {
    expect(isForbiddenToolName(name)).toBe(true);
  });

  it.each(['list_overdue_invoices', 'get_invoice', 'draft_followup_message', 'mark_invoice_sent', 'assign_task', 'get_product_packages', 'convert_lead_to_client'])('%s is allowed', (name) => {
    expect(isForbiddenToolName(name)).toBe(false);
  });
});

describe('ToolRegistry.register', () => {
  it('refuses a forbidden tool, so the model can never be offered it', () => {
    expect(() => new ToolRegistry().register(readTool({ name: 'record_payment' }))).toThrow(/forbidden/);
  });

  it('refuses duplicates, bad names, vague descriptions and dotted names', () => {
    const registry = new ToolRegistry().register(readTool());
    expect(() => registry.register(readTool())).toThrow(/already registered/);
    expect(() => new ToolRegistry().register(readTool({ name: 'Bad-Name' }))).toThrow(/snake_case/);
    expect(() => new ToolRegistry().register(readTool({ name: 'browser.search' }))).toThrow(/snake_case/);
    expect(() => new ToolRegistry().register(readTool({ description: 'x' }))).toThrow(/description/);
  });

  it('refuses arguments that let the model choose who it acts as', () => {
    for (const field of ['orgId', 'org_id', 'userId', 'user_id', 'actor', 'role', 'tenantId', 'aiRunId']) {
      const tool = readTool({ args: z.object({ [field]: z.string() }) });
      expect(() => new ToolRegistry().register(tool), field).toThrow(/identity comes from the session/);
    }
  });

  it('keeps act tools out of the agent: they need execute() and describe(), and no run()', () => {
    const act = (over: Record<string, unknown>) =>
      defineTool({ name: 'mark_invoice_sent', description: 'Marks an invoice as sent to the client.', tier: 'act', permission: 'billing.write', args: z.object({ invoiceId: z.string() }), ...over } as never);
    expect(() => new ToolRegistry().register(act({ run: async () => 1, execute: async () => 1, describe: () => 'x' }))).toThrow(/no run/);
    expect(() => new ToolRegistry().register(act({ describe: () => 'x' }))).toThrow(/execute/);
    expect(() => new ToolRegistry().register(act({ execute: async () => 1 }))).toThrow(/describe/);
    expect(() => new ToolRegistry().register(act({ execute: async () => 1, describe: () => 'Mark invoice as sent' }))).not.toThrow();
    expect(() => new ToolRegistry().register(readTool({ run: undefined }))).toThrow(/run/);
  });
});

describe('ToolRegistry.specsFor (BR-M07-02)', () => {
  const registry = new ToolRegistry()
    .register(readTool())
    .register(readTool({ name: 'get_client_overview', description: 'Shows one client with their deployments.', permission: 'catalog.read', args: z.object({ clientId: z.string() }) }));

  it('offers only the tools the role may use', () => {
    expect(registry.specsFor('owner').map((t) => t.name)).toEqual(['list_overdue_invoices', 'get_client_overview']);
    expect(registry.specsFor('staff').map((t) => t.name)).toEqual(['get_client_overview']); // billing.read is for managers
  });

  it('builds a strict JSON Schema from the Zod schema', () => {
    const spec = registry.specsFor('owner')[0];
    expect(spec.parameters).toMatchObject({ type: 'object', additionalProperties: false, required: ['limit'] });
    expect(spec.parameters).not.toHaveProperty('$schema');
    expect((spec.parameters.properties as Record<string, unknown>).limit).toMatchObject({ type: 'integer', maximum: 50 });
    expect(toolParameters(registry.get('get_client_overview')!)).toHaveProperty('properties.clientId');
  });

  it('rejects unknown arguments when parsing, so a model cannot smuggle in an org id', () => {
    const tool = registry.get('list_overdue_invoices')!;
    expect(tool.args.safeParse({ limit: 5 }).success).toBe(true);
    expect(tool.args.safeParse({ limit: 5, orgId: 'other-org' }).success).toBe(false);
    expect(tool.args.safeParse({ limit: 500 }).success).toBe(false);
  });
});
