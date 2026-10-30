import type { MessageKey } from './i18n';

/** Label of each `act` tool on an approval card (web and Telegram). A tool without a label shows its own name. */
export const ACT_TOOL_LABEL: Record<string, MessageKey> = {
  mark_invoice_sent: 'toolMarkInvoiceSent',
  finalize_document: 'toolFinalizeDocument',
  start_flow_run: 'toolStartFlowRun',
  convert_lead_to_client: 'toolConvertLead',
  create_client: 'toolCreateClient',
  update_client: 'toolUpdateClient',
  create_product: 'toolCreateProduct',
  update_product: 'toolUpdateProduct',
  create_deployment: 'toolCreateDeployment',
  update_deployment: 'toolUpdateDeployment',
  update_lead: 'toolUpdateLead',
  move_lead: 'toolMoveLead',
  update_task: 'toolUpdateTask',
  create_subscription: 'toolCreateSubscription',
};
