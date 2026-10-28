import { z } from 'zod';
import type { Ctx } from '../../domain/ctx';
import { can, type Action, type Role } from '../../domain/permissions';
import type { ToolSpec } from '../types';
import { isForbiddenToolName } from './forbidden';

export type ToolTier = 'read' | 'draft' | 'act';

export interface ToolInput<S extends z.ZodRawShape> {
  name: string;
  description: string;
  tier: ToolTier;
  /** The least permission a user needs. The tool is only offered to roles that have it, and checked again on every call. */
  permission: Action;
  args: z.ZodObject<S>;
  /** `read` and `draft`: runs at once. The one service this tool calls, with the AI run as actor. */
  run?: (ctx: Ctx, args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
  /** `act`: runs only after a human approved. Never called by the agent. */
  execute?: (ctx: Ctx, args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
  /** `act`: one sentence for the approver, built from the validated arguments. */
  describe?: (args: z.infer<z.ZodObject<S>>) => string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  tier: ToolTier;
  permission: Action;
  args: z.ZodObject<z.ZodRawShape>;
  run?: (ctx: Ctx, args: never) => Promise<unknown>;
  execute?: (ctx: Ctx, args: never) => Promise<unknown>;
  describe?: (args: never) => string;
}

const NAME = /^[a-z][a-z0-9_]{2,47}$/;
/** Who the caller is and which organization they belong to come from the session, never from the model (BR-M01-01). */
const IDENTITY_FIELD = /^(org|organization|tenant|user|actor|role|permission|ai_?run)(_?id)?s?$/i;

export function defineTool<S extends z.ZodRawShape>(input: ToolInput<S>): ToolDefinition {
  return { ...input, args: input.args.strict() as unknown as z.ZodObject<z.ZodRawShape> } as unknown as ToolDefinition;
}

/** JSON Schema for the model, from the same Zod schema that validates what comes back. */
export function toolParameters(tool: ToolDefinition): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.args, { io: 'input' }) as Record<string, unknown>;
  return schema;
}

/** One list of tools for the whole app (BRD-M07 Appendix A). Registration is where the safety rules are enforced. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (!NAME.test(tool.name)) throw new Error(`Tool name "${tool.name}" must be snake_case, 3 to 48 characters, without dots`);
    if (isForbiddenToolName(tool.name)) throw new Error(`Tool "${tool.name}" is forbidden for the AI (BR-M07-04)`);
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`);
    if (tool.description.trim().length < 10 || tool.description.length > 600) throw new Error(`Tool "${tool.name}" needs a description of 10 to 600 characters`);
    if (tool.tier === 'act') {
      if (!tool.execute || tool.run) throw new Error(`Act tool "${tool.name}" must have execute() and no run(): the agent never runs it`);
      if (!tool.describe) throw new Error(`Act tool "${tool.name}" needs describe() so the approver sees what will happen`);
    } else if (!tool.run || tool.execute) {
      throw new Error(`Tool "${tool.name}" (${tool.tier}) must have run() and no execute()`);
    }
    for (const field of Object.keys(tool.args.shape)) {
      if (IDENTITY_FIELD.test(field)) throw new Error(`Tool "${tool.name}" has an argument "${field}": identity comes from the session, not from the model`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** What the model is told it can use: tools whose permission the acting user's role has (BR-M07-02). */
  specsFor(role: Role): ToolSpec[] {
    return this.list()
      .filter((tool) => can(role, tool.permission))
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: toolParameters(tool) }));
  }
}
