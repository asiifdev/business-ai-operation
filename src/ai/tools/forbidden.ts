/**
 * Tools the model must never have (BR-M07-04, BRD-M07 Appendix A): payments, invoice status/amount/due date, package
 * prices, deleting anything, roles and settings, sending messages out, and the AI budget itself. The registry refuses to
 * register them, the model is never told they exist, and a call to one is rejected and logged.
 */
export const FORBIDDEN_TOOL_NAMES: readonly string[] = [
  'record_payment',
  'update_payment',
  'delete_payment',
  'set_invoice_status',
  'update_invoice_status',
  'update_invoice_amount',
  'set_invoice_due_date',
  'update_invoice_due_date',
  'update_package_price',
  'set_package_price',
  'change_role',
  'update_user_role',
  'update_org_settings',
  'set_ai_budget',
  'update_ai_budget',
  'send_message',
  'send_email',
  'send_invoice',
];

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^(delete|remove|drop|purge|truncate|erase)_/,
  /^send_/,
  /^(record|create|add)_payment/,
  /^(set|update|change|edit)_.*(payment|price|amount|due_date|role|permission|setting|budget)/,
];

export function isForbiddenToolName(name: string): boolean {
  return FORBIDDEN_TOOL_NAMES.includes(name) || FORBIDDEN_PATTERNS.some((p) => p.test(name));
}
