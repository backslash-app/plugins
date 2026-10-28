import {
  action,
  copy,
  detail,
  type DetailSpec,
  exec,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
} from "@backslash/api";
import {
  age,
  formatDate,
  HEALTH_COLORS,
  parseServices,
  readServiceLogsCommand,
  type Service,
  serviceConsoleUrl,
  serviceHealth,
  serviceLogsUrl,
  shortImage,
  tailServiceCommand,
} from "../lib.ts";
import { gcloud, guarded, inTerminal, type Prefs, projectActions, showProject } from "../gcp.ts";
import { shellLine } from "../terminal.ts";

const SECTIONS = { ok: "Ready", busy: "Deploying", failed: "Failing", off: "Off" };
const LABELS = { ok: "Ready", busy: "Deploying", failed: "Failed", off: "Off" };

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(no recent logs)"}\n\`\`\``;

async function recentLogs(s: Service, project: string, prefs: Prefs): Promise<DetailSpec> {
  const argv = readServiceLogsCommand(s, project);
  const text = await exec(argv[0], argv.slice(1)).catch((e) => String(e.message));
  return detail({
    title: `${s.name} · logs`,
    markdown: fence(text),
    status: `Last ${Math.min(text.split("\n").length, 100)} entries · ${s.region}`,
    actions: [
      inTerminal("Tail in Terminal", tailServiceCommand(s, project), prefs, { shortcut: "<Ctrl>t" }),
      copy(text, "Copy Logs", { shortcut: "<Ctrl><Shift>c" }),
      action("Reload", () => recentLogs(s, project, prefs), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(serviceLogsUrl(s, project), "Open Logs in Console", { icon: Icons.globe }),
    ],
  });
}

function item(s: Service, project: string, prefs: Prefs): Item {
  const health = serviceHealth(s);
  const color = HEALTH_COLORS[health];
  const split = s.traffic.filter((t) => t.percent > 0);
  return {
    id: `${s.region}/${s.name}`,
    title: s.name,
    subtitle: s.url?.replace(/^https:\/\//, ""),
    icon: { source: Icons.rocket, tint: color },
    section: SECTIONS[health],
    keywords: [s.region, s.revision ?? "", s.image ?? "", s.modifier ?? ""],
    accessories: [
      ...(split.length > 1
        ? [{ icon: Icons.shuffle, text: `${split.length} revisions`, tooltip: "Traffic split" }]
        : []),
      { icon: Icons.globe, text: s.region, tooltip: "Region" },
      ...(s.updated ? [{ text: age(s.updated), tooltip: `Updated ${formatDate(s.updated)}` }] : []),
      { tag: LABELS[health], color },
    ],
    detail: {
      markdown: health === "failed" && s.message ? `**${s.reason ?? "Not ready"}**: ${s.message}` : undefined,
      metadata: [
        meta.text("Status", LABELS[health], { icon: Icons.dot, color }),
        ...(s.url ? [meta.link("URL", s.url.replace(/^https:\/\//, ""), s.url)] : []),
        ...(s.revision ? [meta.text("Revision", s.revision, { icon: Icons.commit })] : []),
        ...(s.image ? [meta.text("Image", shortImage(s.image), { icon: Icons.box })] : []),
        ...(split.length
          ? [meta.tags("Traffic", split.map((t) => `${t.tag ? `${t.tag}: ` : ""}${t.revision} ${t.percent}%`))]
          : []),
        ...(s.ingress ? [meta.text("Ingress", s.ingress, { icon: Icons.shield })] : []),
        meta.separator(),
        meta.text("Region", s.region, { icon: Icons.globe }),
        ...(s.modifier ? [meta.person("Last deployed by", s.modifier)] : []),
        ...(s.updated ? [meta.text("Updated", formatDate(s.updated), { icon: Icons.calendar })] : []),
        meta.text("Project", project, { icon: Icons.project }),
      ],
    },
    actions: [
      ...(s.url ? [open(s.url, "Open Service URL", { icon: Icons.globe })] : []),
      open(serviceConsoleUrl(s, project), "Open in Console", { icon: Icons.external, shortcut: "<Ctrl>o" }),
      action("Show Recent Logs", () => recentLogs(s, project, prefs), {
        icon: Icons.text,
        shortcut: "<Ctrl>l",
        section: "Logs",
      }),
      inTerminal("Tail Logs in Terminal", tailServiceCommand(s, project), prefs, { section: "Logs" }),
      ...(s.url ? [copy(s.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
      copy(s.name, "Copy Service Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(s.image ? [copy(s.image, "Copy Image", { icon: Icons.box, section: "Copy" })] : []),
      copy(shellLine(tailServiceCommand(s, project)), "Copy Logs Command", { icon: Icons.terminal, section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...projectActions(),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter Cloud Run services by name, region, image…",
  empty: { title: "No Cloud Run services", description: "Nothing deployed in this project", icon: Icons.rocket },
  status: () => summary,
  actions: projectActions(),
  items: ({ preferences, signal }) => {
    const prefs = preferences as Prefs;
    summary = "";
    return guarded(prefs, signal, async (c) => {
      const services = parseServices(await gcloud(["run", "services", "list", `--project=${c.project}`], signal));
      const failing = services.filter((s) => serviceHealth(s) === "failed").length;
      summary = `${c.project} · ${services.length} service${services.length === 1 ? "" : "s"}${
        failing ? ` · ${failing} failing` : ""
      }`;
      await showProject(c, failing ? `${failing} failing` : `${services.length} services`);
      const order = ["failed", "busy", "ok", "off"];
      return services
        .sort((a, b) => order.indexOf(serviceHealth(a)) - order.indexOf(serviceHealth(b)))
        .map((s) => item(s, c.project, prefs));
    });
  },
});
