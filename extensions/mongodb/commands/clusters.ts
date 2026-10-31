import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { clusters, type Credentials, credentials, setPaused, SetupError, setupItem } from "../atlas.ts";
import { type AtlasCluster, atlasUrl, sortClusters, STATE_COLORS, stateTitle } from "../lib.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  atlasUser?: string;
  terminal?: string;
}

function clusterItem(c: Credentials, cl: AtlasCluster, prefs: Prefs): Item {
  const color = STATE_COLORS[cl.state] ?? "gray";
  const uri = cl.srv ?? cl.standard;
  const user = String(prefs.atlasUser ?? "").trim();
  const actions: Action[] = [
    ...(uri ? [copy(uri, "Copy Connection String", { icon: Icons.link })] : []),
    open(atlasUrl(cl), "Open in Atlas"),
    ...(uri
      ? [action("Open in mongosh", () => {
        runInTerminal(["mongosh", uri, ...(user ? ["--username", user] : [])], prefs.terminal || undefined);
        return close();
      }, { icon: Icons.terminal, shortcut: "<Ctrl>t" })]
      : []),
    ...(cl.standard && cl.srv
      ? [copy(cl.standard, "Copy Standard Connection String", { icon: Icons.link, section: "Copy" })]
      : []),
    ...(cl.privateSrv ? [copy(cl.privateSrv, "Copy Private Connection String", { section: "Copy" })] : []),
    ...(uri
      ? [copy(`mongosh "${uri}"${user ? ` --username ${user}` : ""}`, "Copy mongosh Command", {
        icon: Icons.terminal,
        section: "Copy",
      })]
      : []),
    copy(cl.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(cl.pausable && cl.state === "IDLE"
      ? [action("Pause Cluster", async () => {
        await setPaused(c, cl, true);
        await toast(`Pausing ${cl.name}`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.pause,
        destructive: true,
        confirm: `Pause ${cl.name}? Its applications lose the database until you resume it.`,
        section: "Cluster",
      })]
      : []),
    ...(cl.pausable && cl.paused
      ? [action("Resume Cluster", async () => {
        await setPaused(c, cl, false);
        await toast(`Resuming ${cl.name}: it takes a few minutes`, { style: "success" });
        return refresh();
      }, { icon: Icons.play, shortcut: "<Ctrl>r", section: "Cluster" })]
      : []),
  ];
  const where = [cl.provider, cl.region].filter(Boolean).join(" · ");
  return {
    id: `${cl.project.id}/${cl.name}`,
    title: cl.name,
    subtitle: cl.project.name,
    icon: { source: Icons.database, tint: color },
    section: cl.state === "IDLE" ? "Available" : cl.paused ? "Paused" : "Changing",
    keywords: [cl.project.name, cl.tier, cl.provider ?? "", cl.region ?? "", cl.version ?? ""],
    accessories: [
      { text: cl.tier, tooltip: "Tier" },
      ...(cl.version ? [{ text: cl.version, icon: Icons.tag, tooltip: "MongoDB version" }] : []),
      ...(cl.state !== "IDLE" ? [{ tag: stateTitle(cl.state), color }] : []),
    ],
    detail: {
      stats: [
        { label: "state", value: stateTitle(cl.state), color },
        { label: "tier", value: cl.tier },
        ...(cl.version ? [{ label: "version", value: cl.version }] : []),
      ],
      metadata: [
        meta.text("State", stateTitle(cl.state), { icon: Icons.dot, color }),
        meta.text("Project", cl.project.name, { icon: Icons.project }),
        meta.text("Type", cl.type.toLowerCase().replace("replicaset", "replica set")),
        ...(where ? [meta.text("Where", where, { icon: Icons.cloud })] : []),
        ...(cl.shards && cl.type !== "REPLICASET" && cl.type !== "FLEX"
          ? [meta.text("Shards", String(cl.shards))]
          : []),
        ...(cl.diskGB ? [meta.text("Disk", `${cl.diskGB} GB`, { icon: Icons.drive })] : []),
        ...(cl.backup !== undefined ? [meta.text("Backup", cl.backup ? "on" : "off", { icon: Icons.archive })] : []),
        ...(cl.protected ? [meta.text("Termination protection", "on", { icon: Icons.shield })] : []),
        ...(uri ? [meta.text("Connection", uri.replace(/^mongodb(\+srv)?:\/\//, ""), { icon: Icons.link })] : []),
        ...(cl.created
          ? [meta.text("Created", new Date(cl.created).toLocaleDateString("en-GB"), { icon: Icons.calendar })]
          : []),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter clusters by name, project, region…",
  empty: {
    title: "No clusters",
    description: "The key sees no cluster: check its project roles in Atlas",
    icon: Icons.database,
  },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
  async items({ preferences, signal }) {
    summary = "";
    try {
      const c = credentials(preferences);
      if (!c) return [setupItem()];
      const { list, errors } = await clusters(c, signal);
      const busy = list.filter((x) => x.state !== "IDLE" && !x.paused).length;
      const projects = new Set(list.map((x) => x.project.id)).size;
      summary = [
        `${list.length} cluster${list.length === 1 ? "" : "s"}`,
        `${projects} project${projects === 1 ? "" : "s"}`,
        ...(busy ? [`${busy} changing`] : []),
        ...errors.slice(0, 1),
      ].join(" · ");
      if (errors.length) await toast(errors[0], { style: "failure" }).catch(() => {});
      updateCommandMetadata({ subtitle: busy ? `${busy} changing` : null }).catch(() => {});
      return sortClusters(list).map((cl) => clusterItem(c, cl, preferences as Prefs));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
