import { action, copy, Icons, type Item, list, meta, open, refresh, updateCommandMetadata } from "@backslash/api";
import { guarded, token, zones } from "../api.ts";
import { dnsDashboardUrl, formatDate, type Zone, zoneColor, zoneDashboardUrl, zoneStatusLabel } from "../lib.ts";
import { dnsView, purgeActions, recordForm } from "../views.ts";

function item(z: Zone, tok: string, prefs: Record<string, unknown>): Item {
  const color = zoneColor(z);
  const devMode = z.developmentMode > 0;
  return {
    id: z.id,
    title: z.name,
    subtitle: z.plan,
    icon: { source: Icons.globe, tint: color },
    section: z.accountName || undefined,
    keywords: [z.status, z.plan, z.accountName, ...z.nameServers],
    accessories: [
      ...(devMode ? [{ tag: "Dev mode", color: "purple" as const }] : []),
      ...(z.type !== "full" ? [{ text: z.type === "partial" ? "CNAME setup" : z.type, tooltip: "Setup" }] : []),
      { tag: zoneStatusLabel(z), color },
    ],
    detail: {
      metadata: [
        meta.text("Status", zoneStatusLabel(z), { icon: Icons.dot, color }),
        meta.tags("Plan", [{ text: z.plan || "Unknown", color: /free/i.test(z.plan) ? "gray" : "blue" }]),
        ...(z.nameServers.length ? [meta.tags("Name servers", z.nameServers)] : []),
        ...(z.originalRegistrar ? [meta.text("Registrar", z.originalRegistrar, { icon: Icons.home })] : []),
        ...(devMode
          ? [meta.text("Development mode", `${Math.round(z.developmentMode / 60)} min left`, {
            icon: Icons.code,
            color: "purple",
          })]
          : []),
        meta.separator(),
        meta.text("Account", z.accountName, { icon: Icons.person }),
        meta.text("Zone ID", z.id, { icon: Icons.hash }),
        ...(z.activated ? [meta.text("Active since", formatDate(z.activated), { icon: Icons.calendar })] : []),
      ],
    },
    actions: [
      action("Show DNS Records", () => dnsView(() => token(prefs), z), { icon: Icons.globe }),
      open(zoneDashboardUrl(z), "Open in Dashboard", { icon: Icons.external, shortcut: "<Ctrl>o" }),
      action("Add DNS Record", () => recordForm(tok, z), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      ...purgeActions(tok, z),
      open(dnsDashboardUrl(z), "Open DNS in Dashboard", { icon: Icons.globe, section: "Open" }),
      copy(z.id, "Copy Zone ID", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(z.name, "Copy Domain", { section: "Copy" }),
      ...(z.nameServers.length
        ? [copy(z.nameServers.join("\n"), "Copy Name Servers", { icon: Icons.server, section: "Copy" })]
        : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter zones by domain, plan, status…",
  empty: { title: "No zones", description: "This token sees no zone: check its Zone resources", icon: Icons.globe },
  status: () => summary,
  items: ({ preferences, signal }) =>
    guarded(async () => {
      summary = "";
      const tok = token(preferences);
      const all = await zones(tok, signal);
      const pending = all.filter((z) => z.status === "pending").length;
      summary = `${all.length} zone${all.length === 1 ? "" : "s"}${pending ? ` · ${pending} pending` : ""}`;
      await updateCommandMetadata({ subtitle: summary }).catch(() => {});
      return all.map((z) => item(z, tok, preferences));
    }, signal),
});
