import { action, copy, detail, type DetailSpec, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { age, bytes, formatDate, type LogGroup, logGroupConsoleUrl, logSource, parseLogGroups } from "../lib.ts";
import {
  aws,
  awsArgv,
  awsMissing,
  inTerminal,
  isMissing,
  noProfiles,
  perRegion,
  type Prefs,
  profileActions,
  type Session,
  session,
  showProfile,
} from "../aws.ts";
import { shellLine } from "../terminal.ts";

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(no events in the last hour)"}\n\`\`\``;

async function recent(g: LogGroup, s: Session, prefs: Prefs): Promise<DetailSpec> {
  const text = await aws(["logs", "tail", g.name, "--since", "1h", "--format", "short"], {
    profile: s.profile,
    region: g.region,
    json: false,
  }).catch((e) => String(e.message));
  const lines = text.split("\n");
  const last = lines.slice(-200).join("\n");
  return detail({
    title: g.name,
    markdown: fence(last),
    status: `Last hour · ${lines.length > 200 ? `last 200 of ${lines.length}` : lines.length} lines`,
    metadata: metadata(g, s),
    actions: [
      inTerminal("Follow in Terminal", tailArgv(g, s), prefs, { shortcut: "<Ctrl>t" }),
      copy(last, "Copy Events", { shortcut: "<Ctrl><Shift>c" }),
      action("Reload", () => recent(g, s, prefs), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  });
}

const tailArgv = (g: LogGroup, s: Session) =>
  awsArgv(["logs", "tail", g.name, "--follow", "--since", "10m", "--format", "short"], s.profile, g.region);

function metadata(g: LogGroup, s: Session) {
  return [
    meta.text("Source", logSource(g.name), { icon: Icons.layers }),
    meta.text("Stored", bytes(g.storedBytes), { icon: Icons.archive }),
    meta.text("Retention", g.retentionDays ? `${g.retentionDays} days` : "Never expires", {
      icon: Icons.clock,
      color: g.retentionDays ? undefined : "orange",
    }),
    ...(g.className ? [meta.tags("Class", [g.className])] : []),
    meta.separator(),
    meta.text("Region", g.region, { icon: Icons.globe }),
    ...(g.created ? [meta.text("Created", formatDate(g.created), { icon: Icons.calendar })] : []),
    meta.text("Profile", s.profile ?? "default", { icon: Icons.person }),
  ];
}

function item(g: LogGroup, s: Session, prefs: Prefs): Item {
  const tail = tailArgv(g, s);
  return {
    id: `${g.region}:${g.name}`,
    title: g.name,
    icon: { source: Icons.text, tint: "purple" },
    section: s.regions.length > 1 ? g.region : logSource(g.name),
    keywords: [logSource(g.name), g.region],
    accessories: [
      { text: bytes(g.storedBytes), tooltip: "Stored" },
      ...(g.retentionDays ? [{ icon: Icons.clock, text: `${g.retentionDays}d`, tooltip: "Retention" }] : []),
      ...(g.created ? [{ text: age(g.created), tooltip: `Created ${formatDate(g.created)}` }] : []),
    ],
    detail: { metadata: metadata(g, s) },
    actions: [
      inTerminal("Tail in Terminal", tail, prefs, { section: "Logs" }),
      action("Show Last Hour", () => recent(g, s, prefs), { icon: Icons.text, shortcut: "<Ctrl>l", section: "Logs" }),
      open(logGroupConsoleUrl(g), "Open in AWS Console", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      copy(g.name, "Copy Log Group Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(shellLine(tail), "Copy Tail Command", { icon: Icons.terminal, section: "Copy" }),
      ...(g.arn ? [copy(g.arn, "Copy ARN", { section: "Copy" })] : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...profileActions(prefs),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter log groups…",
  empty: { title: "No log groups", description: "Nothing in these regions", icon: Icons.text },
  status: () => summary,
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    summary = "";
    const s = await session(prefs);
    let loaded;
    try {
      loaded = await perRegion(s, prefs, async (region) =>
        parseLogGroups(
          await aws(["logs", "describe-log-groups"], { profile: s.profile, region, signal }),
          region,
        ));
    } catch (err) {
      if (isMissing(err)) return [await awsMissing()];
      throw err;
    }
    if (!s.profiles.length && loaded.errors.length) return [noProfiles(prefs)];
    const groups = loaded.results.sort((a, b) => a.name.localeCompare(b.name));
    const total = groups.reduce((n, g) => n + g.storedBytes, 0);
    summary = `${s.profile ?? "default"} · ${s.regions.join(", ")} · ${groups.length} log groups · ${bytes(total)}`;
    await showProfile(s);
    return [...loaded.errors, ...groups.map((g) => item(g, s, prefs))];
  },
});
