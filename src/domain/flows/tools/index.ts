import { githubTools } from './github';
import { orbyteTools } from './orbyte';
import { panelTools } from './panel';
import { sshTools } from './ssh';
import type { ToolDef } from './types';

/** The whole catalogue (BR-M17-17). A flow can only name a tool that is in this list. */
export const TOOLS: readonly ToolDef[] = [...githubTools, ...sshTools, ...panelTools, ...orbyteTools];

const byId = new Map(TOOLS.map((t) => [t.id, t]));
export const getTool = (id: string): ToolDef | undefined => byId.get(id);

export { ToolError } from './ssh';
export type { ToolContext, ToolDef, ToolOutcome, PanelCall, ConnectionKind } from './types';
