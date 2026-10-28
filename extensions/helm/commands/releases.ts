import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  age,
  formatDate,
  HEALTH_COLORS,
  historyCommand,
  inContext,
  manifestCommand,
  parseHistory,
  parseReleases,
  type Release,
  type Revision,
  rollbackCommand,
  rollbackTargets,
  sortReleases,
  statusCommand,
  statusLabel,
  uninstallCommand,
  valuesCommand,
} from "../lib.ts";
import { contextActions, errorItem, helm, helmMissing, isMissing, kubeconfig, type Prefs } from "../helm.ts";
import { holdOpen, runInTerminal, shellLine } from "../terminal.ts";

const SECTIONS = { failed: "Failed", pending: "Pending", ok: "Deployed", other: "Other" };

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;

function releaseMetadata(r: Release, context?: string): Metadata[] {
  return [
    meta.text("Status", statusLabel(r.status), { icon: Icons.dot, color: HEALTH_COLORS[r.health] }),
    meta.text("Chart", r.chartName, { icon: Icons.package }),
    ...(r.chartVersion ? [meta.text("Chart version", r.chartVersion, { icon: Icons.tag })] : []),
    ...(r.appVersion ? [meta.text("App version", r.appVersion, { icon: Icons.box })] : []),
    meta.text("Revision", r.revision, { icon: Icons.history }),
    ...(r.updated ? [meta.text("Updated", formatDate(r.updated), { icon: Icons.calendar })] : []),
    meta.separator(),
    meta.text("Namespace", r.namespace, { icon: Icons.layers }),
    ...(context ? [meta.text("Context", context, { icon: Icons.server })] : []),
  ];
}

async function valuesView(r: Release, context: string | undefined, all = false): Promise<DetailSpec> {
  const text = await helm(inContext(valuesCommand(r, all), context));
  const body = text.replace(/^(USER-SUPPLIED|COMPUTED) VALUES:\n?/, "").trim();
  return detail({
    title: `${r.name} · ${all ? "all values" : "values"}`,
    markdown: body && body !== "null" ? fence(body) : "_No user-supplied values: the chart's defaults apply._",
    metadata: releaseMetadata(r, context),
    status: all ? "Computed values (chart defaults included)" : "User-supplied values",
    actions: [
      copy(body, "Copy Values", { shortcut: "<Ctrl><Shift>c", concealed: true }),
      all
        ? action("Show User-Supplied Values", () => valuesView(r, context), { icon: Icons.text })
        : action("Show All Values", () => valuesView(r, context, true), { icon: Icons.braces, shortcut: "<Ctrl>a" }),
    ],
  });
}

async function manifestView(r: Release, context: string | undefined): Promise<DetailSpec> {
  const text = await helm(inContext(manifestCommand(r), context));
  const kinds = [...text.matchAll(/^kind:\s*(\S+)/gm)].map((m) => m[1]);
  return detail({
    title: `${r.name} · manifest`,
    markdown: fence(text),
    metadata: releaseMetadata(r, context),
    status: `${kinds.length} Kubernetes object${kinds.length === 1 ? "" : "s"}`,
    actions: [copy(text, "Copy Manifest", { shortcut: "<Ctrl><Shift>c", concealed: true })],
  });
}

async function rollback(r: Release, rev: Revision, context: string | undefined) {
  await helm(inContext(rollbackCommand(r, rev.revision), context), undefined, 120);
  await toast(`Rolled back ${r.name} to revision ${rev.revision}`, { style: "success", message: rev.chart });
  return refresh();
}

const rollbackAction = (r: Release, rev: Revision, context: string | undefined, title?: string) =>
  action(
    title ?? `Revision ${rev.revision} · ${rev.chart} · ${age(rev.updated)} ago`,
    () => rollback(r, rev, context),
    {
      icon: Icons.history,
      confirm: `Roll back ${r.name} to revision ${rev.revision} (${rev.chart})?`,
      destructive: true,
    },
  );

function historyView(r: Release, context: string | undefined): ListSpec {
  return list({
    title: `${r.name} · history`,
    placeholder: `Filter revisions of ${r.name}…`,
    status: (items) => `${items.length} revision${items.length === 1 ? "" : "s"} · current ${r.revision}`,
    async items({ signal }) {
      const history = parseHistory(await helm(inContext(historyCommand(r), context), signal));
      return history.map((rev): Item => {
        const current = rev.revision === r.revision;
        const color = rev.status === "deployed"
          ? "green"
          : rev.status === "failed"
          ? "red"
          : rev.status.startsWith("pending")
          ? "yellow"
          : "gray";
        return {
          id: String(rev.revision),
          title: `Revision ${rev.revision}`,
          subtitle: rev.description,
          icon: { source: current ? Icons.check : Icons.history, tint: color },
          keywords: [rev.chart, rev.status, rev.appVersion ?? ""],
          accessories: [
            { tag: statusLabel(rev.status), color },
            { text: rev.chart, icon: Icons.package },
            { text: age(rev.updated), tooltip: formatDate(rev.updated) },
          ],
          detail: {
            markdown: rev.description ? `> ${rev.description}` : undefined,
            metadata: [
              meta.text("Status", statusLabel(rev.status), { icon: Icons.dot, color }),
              meta.text("Chart", rev.chart, { icon: Icons.package }),
              ...(rev.appVersion ? [meta.text("App version", rev.appVersion, { icon: Icons.box })] : []),
              ...(rev.updated ? [meta.text("Updated", formatDate(rev.updated), { icon: Icons.calendar })] : []),
            ],
          },
          actions: [
            ...(current ? [] : [rollbackAction(r, rev, context, "Roll Back to This Revision")]),
            action("Show Values of This Revision", async () => {
              const text = await helm(
                inContext([...valuesCommand(r), "--revision", String(rev.revision)], context),
              );
              const body = text.replace(/^(USER-SUPPLIED|COMPUTED) VALUES:\n?/, "").trim();
              return detail({
                title: `${r.name} · revision ${rev.revision} values`,
                markdown: body && body !== "null" ? fence(body) : "_No user-supplied values._",
                actions: [copy(body, "Copy Values", { concealed: true })],
              });
            }, { icon: Icons.text, shortcut: "<Ctrl>v" }),
            copy(
              shellLine(inContext(rollbackCommand(r, rev.revision), context)),
              "Copy Rollback Command",
              { icon: Icons.terminal, section: "Copy" },
            ),
          ],
        };
      });
    },
  });
}

function releaseItem(r: Release, context: string | undefined, prefs: Prefs): Item {
  const color = HEALTH_COLORS[r.health];
  const actions: Action[] = [
    action("Show Values", () => valuesView(r, context), { icon: Icons.text }),
    action("Show History", () => historyView(r, context), { icon: Icons.history, shortcut: "<Ctrl>h" }),
    action("Show Manifest", () => manifestView(r, context), { icon: Icons.file, shortcut: "<Ctrl>m" }),
    submenu("Roll Back To", async () => {
      const history = parseHistory(await helm(inContext(historyCommand(r), context)));
      const targets = rollbackTargets(history, r.revision);
      if (!targets.length) throw new Error(`${r.name} has a single revision`);
      return targets.map((rev) => rollbackAction(r, rev, context));
    }, { icon: Icons.history, shortcut: "<Ctrl><Shift>r", section: "Release" }),
    action("Status in Terminal", () => {
      const term = runInTerminal(holdOpen(inContext(statusCommand(r), context)), prefs.terminal || undefined);
      return close(`Opened in ${term}`);
    }, { icon: Icons.terminal, shortcut: "<Ctrl>t", section: "Release" }),
    action("Copy Values", async () => {
      const text = await helm(inContext(valuesCommand(r), context));
      await clipboard.write(text.replace(/^(USER-SUPPLIED|COMPUTED) VALUES:\n?/, "").trim(), { concealed: true });
      return close("Values copied");
    }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(r.name, "Copy Release Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(shellLine(inContext(statusCommand(r), context)), "Copy Status Command", {
      icon: Icons.terminal,
      section: "Copy",
    }),
    ...contextActions(),
    action("Uninstall Release", async () => {
      await helm(inContext(uninstallCommand(r), context), undefined, 120);
      await toast(`Uninstalled ${r.name}`, { style: "success", message: r.namespace });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      shortcut: "<Ctrl><Shift>Delete",
      confirm: `Uninstall ${r.name} from ${r.namespace}${context ? ` (${context})` : ""}? Its resources are deleted.`,
      section: "Danger",
    }),
  ];
  return {
    id: `${r.namespace}/${r.name}`,
    title: r.name,
    subtitle: r.chartName,
    icon: { source: Icons.package, tint: color },
    section: SECTIONS[r.health],
    keywords: [r.namespace, r.chart, r.status, r.appVersion ?? ""],
    accessories: [
      ...(r.health !== "ok" ? [{ tag: statusLabel(r.status), color }] : []),
      { icon: Icons.layers, text: r.namespace, tooltip: "Namespace" },
      ...(r.chartVersion ? [{ text: r.chartVersion, tooltip: "Chart version" }] : []),
      { text: `r${r.revision}`, tooltip: "Revision" },
      { text: age(r.updated), tooltip: r.updated ? `Updated ${formatDate(r.updated)}` : undefined },
    ],
    detail: {
      stats: [
        { label: "revision", value: r.revision },
        { label: "status", value: statusLabel(r.status), color },
        { label: "updated", value: age(r.updated) || "—" },
      ],
      metadata: releaseMetadata(r, context),
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter releases by name, chart, namespace, status…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "problems", title: "Failed & Pending" },
    ],
    default: "all",
  },
  empty: { title: "No Helm release", description: "Nothing installed with helm in this cluster", icon: Icons.package },
  status: () => summary,
  actions: contextActions(),
  async items({ preferences, filter, signal }) {
    summary = "";
    const prefs = preferences as Prefs;
    let context: string | undefined;
    try {
      context = (await kubeconfig(signal))?.current;
    } catch {
      context = undefined;
    }
    let releases: Release[];
    try {
      releases = parseReleases(await helm(inContext(["helm", "list", "-A", "-a", "-o", "json"], context), signal));
    } catch (err) {
      if (isMissing(err)) return [await helmMissing()];
      return [errorItem(err, context)];
    }
    const failed = releases.filter((r) => r.health === "failed").length;
    const pending = releases.filter((r) => r.health === "pending").length;
    const problems = [failed && `${failed} failed`, pending && `${pending} pending`].filter(Boolean).join(" · ");
    summary = [context, `${releases.length} release${releases.length === 1 ? "" : "s"}`, problems]
      .filter(Boolean).join(" · ");
    updateCommandMetadata({
      subtitle: [context, problems || `${releases.length} release${releases.length === 1 ? "" : "s"}`]
        .filter(Boolean).join(" · "),
    }).catch(() => {});
    const shown = filter === "problems"
      ? releases.filter((r) => r.health === "failed" || r.health === "pending")
      : releases;
    return sortReleases(shown).map((r) => releaseItem(r, context, prefs));
  },
});
