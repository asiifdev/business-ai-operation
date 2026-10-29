import type { z } from 'zod';
import type { GithubClient } from '../../../integrations/github/client';
import type { SshSession } from '../../../integrations/ssh/client';
import type { Clock } from '../../../lib/clock';
import type { Ctx } from '../../ctx';
import type { Context, Scalar } from '../template';

export type ConnectionKind = 'github' | 'ssh' | 'aapanel';

/**
 * A tool of the catalogue (BR-M17-17): the only kind of node a flow can contain. It is written in code; a person or the
 * assistant can only choose it and fill its configuration. `schema` checks the configuration AFTER the variables were put in.
 */
export interface ToolDef<I = unknown> {
  id: string;
  /** Connection kinds the node must be bound to (by slot), for example `['ssh', 'github']` for a clone. */
  needs: readonly ConnectionKind[];
  tier: 'read' | 'change';
  /** False until the tool was proved on a real system: a flow that uses it is refused. */
  available: boolean;
  /** Only the Owner may save a flow with this tool (BR-M17-18). */
  ownerOnly?: boolean;
  /** Names of the non-secret outputs later nodes may read as `{{nodes.<id>.<name>}}`. */
  outputs: readonly string[];
  /** Configuration keys that name a secret this node creates (`secrets.<value>`). */
  producesSecretFrom?: string;
  /** How each configuration key is put into the text. Keys not listed are `text`. */
  contexts?: Record<string, Context>;
  /** Configuration keys that may contain `{{secrets.x}}`. */
  secretKeys?: readonly string[];
  /** Makes a deletable object that a later `deletes` node may remove (BR-M17-25). */
  creates?: 'database' | 'proxy';
  /** The configuration key naming the node (of kind `creates`) whose object this tool deletes. */
  deletes?: { kind: 'database' | 'proxy'; key: string };
  /** Installs and builds take longer than the organization's step limit: the longer of the two applies. */
  minTimeoutMs?: number;
  schema: z.ZodType<I>;
  run(ctx: ToolContext, input: I): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  outputs?: Record<string, Scalar>;
  /** Secrets the node made, by name (they go to the run's sealed secrets, never to `outputs`). */
  secrets?: Record<string, string>;
  /** Text for the run view. Scrubbed of secrets and cut before it is stored. */
  log?: string;
}

export interface PanelCall {
  (path: string, form?: Record<string, string>): Promise<unknown>;
}

/** What a tool may touch. Built by the engine for ONE node, from the connections its slots are bound to. */
export interface ToolContext {
  ctx: Ctx;
  runId: string;
  nodeId: string;
  clock: Clock;
  timeoutMs: number;
  /** Where a clone fetches from. `https://github.com` in production; tests point it at a local folder. */
  gitBase: string;
  fetch: typeof fetch;
  ssh(): Promise<SshSession>;
  panel(): Promise<PanelCall>;
  github(): Promise<{ client: GithubClient; installationId: number }>;
  /** The params and variables as the node saw them: tools such as `record_deployment` read the run's own parameters. */
  scope: { params: Record<string, Scalar>; nodes: Record<string, Record<string, Scalar>> };
  /** The connection a slot is bound to in this run, for tools that record it (`record_deployment`). */
  connectionId(slot: string): string | undefined;
  /** Registers a value that must never appear in any output, for example a token fetched for this step. */
  track(secret: string): void;
  scrub(text: string): string;
}
