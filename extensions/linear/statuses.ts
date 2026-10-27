// "Change Status…": the workflow states of the issue's team.

import { action, type Context, list, pop, toast, type View } from "@backslash/api";
import { type Issue, linear, notifyChanged, stateRank, type WorkflowState } from "./lib.ts";

export async function statusPicker(issue: Issue, ctx: Context): Promise<View> {
  const apiKey = ctx.preferences.apiKey as string;
  const data = await linear<{ team: { states: { nodes: WorkflowState[] } } }>(
    apiKey,
    `query($id: String!) { team(id: $id) { states { nodes { id name type position } } } }`,
    { id: issue.team.id },
  );
  const states = data.team.states.nodes.sort((a, b) =>
    stateRank(a.type) - stateRank(b.type) || a.position - b.position
  );
  return list({
    title: `${issue.identifier} → status`,
    placeholder: "Move to…",
    items: states.map((s) => ({
      id: s.id,
      title: s.name,
      icon: s.id === issue.state.id ? "object-select" : undefined,
      accessories: s.id === issue.state.id ? [{ tag: "Current", color: "gray" as const }] : [],
      actions: [
        action(`Move to ${s.name}`, async () => {
          const res = await linear<{ issueUpdate: { success: boolean } }>(
            apiKey,
            `mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`,
            { id: issue.id, state: s.id },
          );
          if (!res.issueUpdate.success) throw new Error("Linear did not update the issue");
          notifyChanged();
          await toast(`${issue.identifier} → ${s.name}`, { style: "success" });
          return pop();
        }),
      ],
    })),
  });
}
