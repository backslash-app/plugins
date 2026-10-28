import { action, copy, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { az, guarded, inTerminal, loginAction, type Prefs, showSubscription, useSubscription } from "../az.ts";
import { parseSubscriptions, type Subscription, SUBSCRIPTION_COLORS, subscriptionPortalUrl } from "../lib.ts";

function item(s: Subscription, prefs: Prefs, multiTenant: boolean): Item {
  const color = SUBSCRIPTION_COLORS[s.state] ?? "gray";
  const tenant = s.tenantName ?? s.tenantDomain ?? s.tenantId;
  return {
    id: s.id,
    title: s.name,
    subtitle: s.id,
    icon: { source: s.isDefault ? Icons.check : Icons.key, tint: s.isDefault ? "blue" : color },
    section: multiTenant ? tenant : s.isDefault ? "Current" : "Subscriptions",
    keywords: [s.id, s.tenantId, s.tenantName ?? "", s.tenantDomain ?? "", s.user ?? ""],
    accessories: [
      ...(multiTenant ? [] : [{ text: tenant, icon: Icons.home, tooltip: "Tenant" }]),
      ...(s.isDefault ? [{ tag: "Current", color: "blue" as const }] : []),
      ...(s.state !== "Enabled" ? [{ tag: s.state, color }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Subscription ID", s.id, { icon: Icons.hash }),
        meta.text("State", s.state, { icon: Icons.dot, color }),
        meta.separator(),
        meta.text("Tenant", tenant, { icon: Icons.home }),
        ...(s.tenantDomain ? [meta.text("Domain", s.tenantDomain, { icon: Icons.globe })] : []),
        meta.text("Tenant ID", s.tenantId, { icon: Icons.hash }),
        ...(s.user
          ? [meta.person(s.userType === "servicePrincipal" ? "Service principal" : "Signed in as", s.user)]
          : []),
        meta.text("Cloud", s.cloud, { icon: Icons.cloud }),
      ],
    },
    actions: [
      ...(s.isDefault ? [] : [action("Switch to Subscription", async () => {
        await useSubscription(s);
        return refresh();
      }, { icon: Icons.check })]),
      open(subscriptionPortalUrl(s), "Open in Azure Portal", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      copy(s.id, "Copy Subscription ID", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(s.tenantId, "Copy Tenant ID", { section: "Copy" }),
      copy(s.name, "Copy Name", { section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      loginAction(prefs, "Account"),
      inTerminal("Sign In to Another Tenant", ["az", "login", "--tenant", s.tenantId], prefs, {
        icon: Icons.home,
        section: "Account",
        hold: true,
      }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter subscriptions by name, ID or tenant…",
  empty: {
    title: "No subscriptions",
    description: "This account sees no subscription: sign in with another one with az login",
    icon: Icons.key,
  },
  status: () => summary,
  items: ({ preferences, signal }) => {
    const prefs = preferences as Prefs;
    summary = "";
    return guarded(prefs, signal, async (current) => {
      const subs = parseSubscriptions(await az(["account", "list"], signal));
      const tenants = new Set(subs.map((s) => s.tenantId));
      summary = `${current.user ?? "signed in"} · ${subs.length} subscription${subs.length === 1 ? "" : "s"}${
        tenants.size > 1 ? ` · ${tenants.size} tenants` : ""
      }`;
      await showSubscription(current);
      return subs.map((s) => item(s, prefs, tenants.size > 1));
    });
  },
});
