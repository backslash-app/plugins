import {
  action,
  close,
  type Context,
  copy,
  detail,
  field,
  form,
  Icons,
  meta,
  open,
  storage,
  toast,
} from "@backslash/api";
import { type Account, account, AuthError, issueUrl, jira, myAccountId, setupItems } from "../api.ts";
import { textToAdf } from "../lib.ts";

interface Project {
  id: string;
  key: string;
  name: string;
}

interface IssueType {
  id: string;
  name: string;
  subtask: boolean;
}

export default async ({ preferences }: Context) => {
  let a: Account;
  let projects: Project[];
  let types: IssueType[];
  try {
    a = account(preferences);
    [projects, types] = await Promise.all([
      jira<{ values: Project[] }>(a, "/rest/api/3/project/search?maxResults=100").then((r) => r.values),
      jira<IssueType[]>(a, "/rest/api/3/issuetype"),
    ]);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const [setup] = setupItems(e);
    return detail({ title: "Connect Jira", markdown: setup.detail!.markdown!, actions: setup.actions });
  }
  if (!projects.length) throw new Error("No Jira project is visible with this account");
  const last = await storage.get<string>("lastProject").catch(() => undefined);
  // Issue types of every project, by name (team-managed projects each have their own).
  const names = [...new Set(types.filter((t) => !t.subtask).map((t) => t.name))].sort();
  return form({
    title: "New Jira issue",
    submitTitle: "Create Issue",
    fields: [
      field.dropdown("project", "Project", projects.map((p) => ({ value: p.key, title: `${p.name} (${p.key})` })), {
        value: projects.some((p) => p.key === last) ? last : projects[0].key,
      }),
      field.dropdown("type", "Type", names, { value: names.includes("Task") ? "Task" : names[0] }),
      field.text("summary", "Summary", { required: true, placeholder: "What needs to be done?" }),
      field.textArea("description", "Description", { placeholder: "Blank lines separate paragraphs" }),
      field.checkbox("assignToMe", "Assign to me", { value: true }),
    ],
    async submit(values) {
      const fields: Record<string, unknown> = {
        project: { key: values.project },
        issuetype: { name: values.type },
        summary: String(values.summary).trim(),
      };
      const description = String(values.description ?? "").trim();
      if (description) fields.description = textToAdf(description);
      if (values.assignToMe) fields.assignee = { accountId: await myAccountId(a) };
      const created = await jira<{ id: string; key: string }>(a, "/rest/api/3/issue", {
        method: "POST",
        body: { fields },
      });
      await storage.set("lastProject", String(values.project)).catch(() => {});
      const url = issueUrl(a, created.key);
      await toast(`Created ${created.key}`, { style: "success" });
      return detail({
        title: created.key,
        markdown: `# ${fields.summary}\n\nCreated in Jira as **${created.key}**.`,
        metadata: [
          meta.text("Key", created.key, { icon: Icons.ticket }),
          meta.text("Project", projects.find((p) => p.key === values.project)?.name ?? String(values.project)),
          meta.text("Type", String(values.type)),
          meta.link("Link", "Open in Jira", url),
        ],
        status: "Issue created",
        actions: [
          open(url, "Open in Jira"),
          copy(created.key, "Copy Key", { shortcut: "<Ctrl>period" }),
          copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
          action("Done", () => close()),
        ],
      });
    },
  });
};
