import { action, close, type Context, copy, detail, field, form, meta, open } from "@backslash/api";
import { linear, PRIORITIES } from "../lib.ts";

interface Team {
  id: string;
  key: string;
  name: string;
}

export default async ({ preferences }: Context) => {
  const apiKey = preferences.apiKey as string;
  const { teams } = await linear<{ teams: { nodes: Team[] } }>(apiKey, `query { teams { nodes { id key name } } }`);
  if (!teams.nodes.length) throw new Error("No Linear team found for this API key");
  return form({
    title: "New Linear issue",
    submitTitle: "Create Issue",
    fields: [
      field.text("title", "Title", { required: true, placeholder: "What needs doing?" }),
      field.textArea("description", "Description", { placeholder: "Markdown" }),
      field.dropdown("team", "Team", teams.nodes.map((t) => ({ value: t.id, title: `${t.name} (${t.key})` })), {
        value: teams.nodes[0].id,
      }),
      field.dropdown("priority", "Priority", PRIORITIES, { value: "0" }),
      field.checkbox("assignToMe", "Assign to me", { value: true }),
    ],
    async submit(values) {
      let assigneeId: string | undefined;
      if (values.assignToMe) {
        assigneeId = (await linear<{ viewer: { id: string } }>(apiKey, `query { viewer { id } }`)).viewer.id;
      }
      const { issueCreate } = await linear<
        { issueCreate: { success: boolean; issue: { identifier: string; url: string } } }
      >(
        apiKey,
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`,
        {
          input: {
            teamId: values.team,
            title: String(values.title).trim(),
            description: String(values.description ?? "") || undefined,
            priority: Number(values.priority),
            assigneeId,
          },
        },
      );
      if (!issueCreate.success) throw new Error("Linear did not create the issue");
      const { identifier, url } = issueCreate.issue;
      return detail({
        title: identifier,
        markdown: `# ${String(values.title)}\n\nCreated in Linear as **${identifier}**.`,
        metadata: [
          meta.text("Identifier", identifier),
          meta.text("Team", teams.nodes.find((t) => t.id === values.team)?.name ?? ""),
          meta.text("Priority", PRIORITIES.find((p) => p.value === values.priority)?.title ?? ""),
          meta.link("Link", "Open in Linear", url),
        ],
        status: "Issue created",
        actions: [
          open(url, "Open in Linear"),
          copy(identifier, "Copy Identifier", { shortcut: "<Ctrl>period" }),
          copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
          action("Done", () => close()),
        ],
      });
    },
  });
};
