import { z } from 'zod';
import type { ToolDef } from './types';
import { branchName, repoName } from './validate';

const empty = z.object({});
const head = z.object({ repo: repoName, branch: branchName });

export const githubTools: ToolDef[] = [
  {
    id: 'github.list_repos',
    needs: ['github'],
    tier: 'read',
    available: true,
    outputs: ['count', 'names'],
    schema: empty,
    async run(t) {
      const { client, installationId } = await t.github();
      const repos = await client.listRepositories(installationId);
      return { outputs: { count: repos.length, names: repos.map((r) => r.fullName).join(',') }, log: `${repos.length} repositor(ies) shared with the App` };
    },
  },
  {
    id: 'github.branch_head',
    needs: ['github'],
    tier: 'read',
    available: true,
    outputs: ['commit'],
    schema: head,
    async run(t, input: z.infer<typeof head>) {
      const { client, installationId } = await t.github();
      const commit = await client.getBranchHead(installationId, input.repo, input.branch);
      return { outputs: { commit }, log: `${input.repo}@${input.branch} is at ${commit.slice(0, 7)}` };
    },
  },
];
