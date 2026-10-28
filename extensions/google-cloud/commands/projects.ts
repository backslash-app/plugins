import { action, copy, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { formatDate, parseProjects, type Project, projectConsoleUrl } from "../lib.ts";
import { errorItem, gcloud, guarded, type Prefs, showProject, useProject } from "../gcp.ts";

function item(p: Project, current: boolean, account?: string): Item {
  const active = p.state === "ACTIVE";
  const labels = Object.entries(p.labels).map(([k, v]) => `${k}=${v}`);
  return {
    id: p.id,
    title: p.name,
    subtitle: p.id === p.name ? undefined : p.id,
    icon: {
      source: current ? Icons.check : Icons.project,
      tint: current ? "green" : active ? "blue" : "gray",
    },
    section: current ? "Current Project" : active ? "Projects" : "Pending Deletion",
    keywords: [p.id, p.number, ...labels],
    accessories: [
      ...(active ? [] : [{ tag: "Deleting", color: "red" as const }]),
      ...(current ? [{ tag: "Current", color: "green" as const }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Project ID", p.id, { icon: Icons.hash }),
        meta.text("Number", p.number, { icon: Icons.hash }),
        meta.text("State", active ? "Active" : p.state.replace(/_/g, " ").toLowerCase(), {
          icon: Icons.dot,
          color: active ? "green" : "red",
        }),
        ...(p.parent ? [meta.text("Parent", p.parent, { icon: Icons.layers })] : []),
        ...(labels.length ? [meta.tags("Labels", labels)] : []),
        meta.separator(),
        ...(p.created ? [meta.text("Created", formatDate(p.created), { icon: Icons.calendar })] : []),
        ...(current && account ? [meta.person("Account", account)] : []),
      ],
    },
    actions: [
      ...(current || !active ? [] : [action("Switch to Project", async () => {
        await useProject(p.id);
        return refresh();
      }, { icon: Icons.arrowRight })]),
      open(projectConsoleUrl(p.id), "Open in Console", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      copy(p.id, "Copy Project ID", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(p.number, "Copy Project Number", { section: "Copy" }),
      copy(`gcloud config set project ${p.id}`, "Copy Switch Command", { icon: Icons.terminal, section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Switch Google Cloud project…",
  empty: { title: "No projects", description: "This account cannot see any project", icon: Icons.project },
  status: (items) => {
    const n = items.filter((i) => !["missing", "error", "no-project"].includes(i.id ?? "")).length;
    return n ? `${n} project${n === 1 ? "" : "s"}` : "";
  },
  items: ({ preferences, signal }) =>
    guarded(preferences as Prefs, signal, async (c) => {
      await showProject(c, c.account);
      const projects = parseProjects(await gcloud(["projects", "list"], signal));
      return projects
        .map((p) => item(p, p.id === c.project, c.account))
        .sort((a, b) => Number(b.section === "Current Project") - Number(a.section === "Current Project"));
    }).then(async (items) => {
      // Without a current project, the list of projects is exactly what is needed.
      if (items[0]?.id !== "no-project") return items;
      try {
        return parseProjects(await gcloud(["projects", "list"], signal)).map((p) => item(p, false));
      } catch (err) {
        return [errorItem(err, undefined, preferences as Prefs), ...items];
      }
    }),
});
