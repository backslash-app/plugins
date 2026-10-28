import { type Action, action, copy, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { az, guarded, inTerminal, type Prefs, runOperation, showSubscription, subscriptionActions } from "../az.ts";
import {
  age,
  APP_COLORS,
  APP_LABELS,
  appHealth,
  appKind,
  appUrl,
  formatDate,
  parseWebApps,
  portalUrl,
  sortWebApps,
  type Subscription,
  type WebApp,
  webappTailCommand,
} from "../lib.ts";
import { shellLine } from "../terminal.ts";

const SECTIONS = { limited: "Needs attention", running: "Running", stopped: "Stopped" };

function item(a: WebApp, sub: Subscription, prefs: Prefs): Item {
  const health = appHealth(a);
  const color = APP_COLORS[health];
  const url = appUrl(a);
  const tenant = sub.tenantDomain ?? sub.tenantId;
  const custom = a.hostnames.filter((h) => h !== a.hostname);
  const running = a.state.toLowerCase() === "running";
  const actions: Action[] = [
    ...(url ? [open(url, "Open Web App", { icon: Icons.globe })] : []),
    open(portalUrl(a.id, tenant), "Open in Azure Portal", { icon: Icons.external, shortcut: "<Ctrl>o" }),
    inTerminal("Stream Logs in Terminal", webappTailCommand(a), prefs, {
      icon: Icons.text,
      shortcut: "<Ctrl>l",
      section: "Logs",
    }),
    open(portalUrl(a.id, tenant, "logStream"), "Open Log Stream in Portal", { icon: Icons.text, section: "Logs" }),
    ...(url ? [copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    copy(a.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(a.id, "Copy Resource ID", { icon: Icons.hash, section: "Copy" }),
    copy(shellLine(webappTailCommand(a)), "Copy Log Tail Command", { icon: Icons.terminal, section: "Copy" }),
  ];
  if (running) {
    actions.push(
      action("Restart Web App", () => runOperation(["webapp", "restart", "--ids", a.id], `Restarted ${a.name}`), {
        icon: Icons.refresh,
        destructive: true,
        confirm: `Restart ${a.name}? Requests fail while it starts again.`,
        shortcut: "<Ctrl><Shift>r",
        section: "Web App",
      }),
      action("Stop Web App", () => runOperation(["webapp", "stop", "--ids", a.id], `Stopped ${a.name}`), {
        icon: Icons.stop,
        destructive: true,
        confirm: `Stop ${a.name}? It answers 403 until you start it again.`,
        shortcut: "<Ctrl><Shift>x",
        section: "Web App",
      }),
    );
  } else {
    actions.push(
      action("Start Web App", () => runOperation(["webapp", "start", "--ids", a.id], `Started ${a.name}`), {
        icon: Icons.play,
        shortcut: "<Ctrl><Shift>s",
        section: "Web App",
      }),
    );
  }
  if (a.scmHost) {
    actions.push(
      open(`https://${a.scmHost}`, "Open Kudu (Advanced Tools)", { icon: Icons.settings, section: "Portal" }),
    );
  }
  actions.push(
    open(portalUrl(a.id, tenant, "deploymentCenter"), "Open Deployment Center", {
      icon: Icons.rocket,
      section: "Portal",
    }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ...subscriptionActions(),
  );

  return {
    id: a.id,
    title: a.name,
    subtitle: a.hostname,
    icon: { source: Icons.globe, tint: color },
    section: SECTIONS[health],
    keywords: [a.resourceGroup, a.location, a.kind, a.plan ?? "", ...a.hostnames],
    accessories: [
      ...(custom.length ? [{ icon: Icons.link, text: `${custom.length}`, tooltip: custom.join(", ") }] : []),
      { text: a.location, tooltip: "Region" },
      ...(a.modified ? [{ text: age(a.modified), tooltip: `Modified ${formatDate(a.modified)}` }] : []),
      { tag: APP_LABELS[health], color },
    ],
    detail: {
      metadata: [
        meta.text("State", a.state, { icon: Icons.dot, color }),
        ...(health === "limited"
          ? [
            meta.text("Availability", `${a.availability ?? "—"} · usage ${a.usage ?? "—"}`, {
              icon: Icons.alert,
              color,
            }),
          ]
          : []),
        ...(url ? [meta.link("Default hostname", a.hostname!, url)] : []),
        ...(custom.length ? [meta.tags("Custom domains", custom)] : []),
        meta.text("Kind", appKind(a), { icon: Icons.box }),
        meta.text("HTTPS only", a.httpsOnly ? "Yes" : "No", {
          icon: Icons.lock,
          color: a.httpsOnly ? "green" : "orange",
        }),
        meta.separator(),
        meta.text("Resource group", a.resourceGroup, { icon: Icons.folder }),
        meta.text("Region", a.location, { icon: Icons.pin }),
        ...(a.plan ? [meta.text("App Service plan", a.plan, { icon: Icons.layers })] : []),
        ...(a.outboundIps.length
          ? [meta.text("Outbound IPs", a.outboundIps.slice(0, 4).join(", "), { icon: Icons.globe })]
          : []),
        ...(a.modified ? [meta.text("Modified", formatDate(a.modified), { icon: Icons.calendar })] : []),
        meta.text("Subscription", sub.name, { icon: Icons.key }),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter web apps by name, hostname, resource group…",
  empty: {
    title: "No web apps",
    description: "No App Service app in this subscription: switch with Ctrl+Shift+P",
    icon: Icons.globe,
  },
  status: () => summary,
  actions: subscriptionActions(),
  items: ({ preferences, signal }) => {
    const prefs = preferences as Prefs;
    summary = "";
    return guarded(prefs, signal, async (sub) => {
      const apps = parseWebApps(await az(["webapp", "list"], signal));
      const running = apps.filter((a) => appHealth(a) !== "stopped").length;
      summary = `${sub.name} · ${apps.length} web app${apps.length === 1 ? "" : "s"} · ${running} running`;
      await showSubscription(sub, `${apps.length} web apps`);
      return sortWebApps(apps).map((a) => item(a, sub, prefs));
    });
  },
});
