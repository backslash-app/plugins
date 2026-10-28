import {
  type Action,
  action,
  close,
  type Context,
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
import { type Account, accounts, loadServers, power, type Prefs, TOKEN_PAGES, TokenError } from "../api.ts";
import {
  age,
  consoleUrl,
  formatDate,
  formatPrice,
  monthlyTotal,
  type Power,
  powerChoices,
  type Provider,
  PROVIDER_COLORS,
  PROVIDER_NAMES,
  PROVIDERS,
  type Server,
  sortServers,
  specs,
  sshCommand,
  STATE_COLORS,
  statusLabel,
} from "../lib.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

const POWER: Record<Power, { title: string; icon: string; done: string; confirm?: string; shortcut?: string }> = {
  on: { title: "Power On", icon: Icons.play, done: "Powering on", shortcut: "<Ctrl><Shift>s" },
  reboot: {
    title: "Reboot",
    icon: Icons.refresh,
    done: "Rebooting",
    confirm: "Reboot {name}? Its connections are cut.",
    shortcut: "<Ctrl><Shift>r",
  },
  shutdown: {
    title: "Shut Down",
    icon: Icons.stop,
    done: "Shutting down",
    confirm: "Shut down {name}? Most providers keep billing a stopped server.",
    shortcut: "<Ctrl><Shift>x",
  },
  off: {
    title: "Power Off (Hard)",
    icon: Icons.power,
    done: "Powering off",
    confirm: "Cut the power of {name}? Like pulling the plug: unsaved data may be lost.",
  },
};

function powerAction(a: Account, s: Server, p: Power): Action {
  const spec = POWER[p];
  return action(spec.title, async () => {
    await power(a, s, p);
    await toast(`${spec.done} ${s.name}`, { style: "success", message: PROVIDER_NAMES[s.provider] });
    return refresh();
  }, {
    icon: spec.icon,
    shortcut: spec.shortcut,
    section: "Power",
    destructive: p !== "on",
    confirm: spec.confirm?.replace("{name}", s.name),
  });
}

function item(s: Server, a: Account, prefs: Prefs): Item {
  const color = STATE_COLORS[s.state];
  const ssh = sshCommand(s, prefs.sshUser ?? "root");
  const price = formatPrice(s.price);
  const actions: Action[] = [];
  if (ssh && s.state === "running") {
    actions.push(action("SSH in Terminal", () => {
      const term = runInTerminal(ssh, prefs.terminal || undefined);
      return close(`Opened in ${term}`);
    }, { icon: Icons.terminal }));
  }
  actions.push(
    ...(s.ipv4 ? [copy(s.ipv4, "Copy IPv4", { icon: Icons.globe, shortcut: "<Ctrl>period", section: "Copy" })] : []),
    open(consoleUrl(s), `Open in ${PROVIDER_NAMES[s.provider]}`, { icon: Icons.external, shortcut: "<Ctrl>o" }),
    ...(s.ipv6 ? [copy(s.ipv6, "Copy IPv6", { icon: Icons.globe, section: "Copy" })] : []),
    ...(s.privateIps[0] ? [copy(s.privateIps[0], "Copy Private IP", { icon: Icons.server, section: "Copy" })] : []),
    ...(ssh ? [copy(shellLine(ssh), "Copy SSH Command", { icon: Icons.terminal, section: "Copy" })] : []),
    copy(s.id, "Copy Server ID", { icon: Icons.hash, section: "Copy" }),
    ...powerChoices(s).map((p) => powerAction(a, s, p)),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  );
  return {
    id: `${s.provider}/${s.id}`,
    title: s.name,
    subtitle: s.ipv4 ?? s.ipv6,
    icon: { source: Icons.server, tint: color },
    section: PROVIDER_NAMES[s.provider],
    keywords: [
      PROVIDER_NAMES[s.provider],
      s.region,
      s.regionName ?? "",
      s.type,
      s.status,
      s.ipv6 ?? "",
      ...s.privateIps,
      ...s.tags,
    ],
    accessories: [
      { text: s.type, tooltip: specs(s) || "Plan" },
      { icon: Icons.pin, text: s.region, tooltip: s.regionName ?? "Region" },
      ...(price ? [{ text: price, tooltip: "Monthly price" }] : []),
      { tag: statusLabel(s.status), color },
    ],
    detail: {
      stats: [
        { label: "status", value: statusLabel(s.status), color },
        { label: "plan", value: s.type || "—" },
        { label: "price", value: price || "—" },
      ],
      metadata: [
        meta.text("Provider", PROVIDER_NAMES[s.provider], { icon: Icons.cloud, color: PROVIDER_COLORS[s.provider] }),
        ...(s.ipv4 ? [meta.text("IPv4", s.ipv4, { icon: Icons.globe })] : []),
        ...(s.ipv6 ? [meta.text("IPv6", s.ipv6, { icon: Icons.globe })] : []),
        ...(s.privateIps.length ? [meta.tags("Private IPs", s.privateIps)] : []),
        meta.separator(),
        meta.text("Region", s.regionName ? `${s.region} · ${s.regionName}` : s.region, { icon: Icons.pin }),
        ...(specs(s) ? [meta.text("Resources", specs(s), { icon: Icons.cpu })] : []),
        ...(s.price?.hourly !== undefined
          ? [meta.text("Hourly", `${s.price.currency === "EUR" ? "€" : "$"}${s.price.hourly.toFixed(4)}`, {
            icon: Icons.coin,
          })]
          : []),
        ...(s.image ? [meta.text("Image", s.image, { icon: Icons.layers })] : []),
        ...(s.tags.length ? [meta.tags("Tags", s.tags.slice(0, 8))] : []),
        ...(s.created
          ? [meta.text("Created", `${formatDate(s.created)} (${age(s.created)} ago)`, { icon: Icons.calendar })]
          : []),
        meta.text("ID", s.id, { icon: Icons.hash }),
      ],
    },
    actions,
  };
}

function errorItem(provider: Provider, err: unknown): Item {
  const token = err instanceof TokenError;
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: `error:${provider}`,
    title: token ? `${PROVIDER_NAMES[provider]} refused the token` : `${PROVIDER_NAMES[provider]} failed`,
    subtitle: token ? "Check it in Settings → Extensions → Cloud Servers" : message,
    icon: { source: token ? Icons.key : Icons.alert, tint: "orange" },
    section: PROVIDER_NAMES[provider],
    detail: { markdown: message },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(TOKEN_PAGES[provider], "Create a Token", { icon: Icons.key }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a cloud provider",
    subtitle: "Add a Hetzner, DigitalOcean, Linode or Scaleway token in Settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your providers",
        "",
        "Set one token per provider you use in **Settings → Extensions → Cloud Servers**:",
        "",
        "- **Hetzner Cloud**: Console → project → Security → API tokens (Read & Write)",
        "- **DigitalOcean**: API → Generate New Token",
        "- **Linode**: Profile → API Tokens (Linodes: Read/Write)",
        "- **Scaleway**: IAM → API keys, the *secret key*, and the zones you use",
        "",
        "Read-only tokens list servers; power actions need write access.",
      ].join("\n"),
    },
    actions: PROVIDERS.map((p) => open(TOKEN_PAGES[p], `Create a ${PROVIDER_NAMES[p]} Token`, { icon: Icons.key })),
  };
}

let summary = "";

export default (ctx: Context) => {
  const configured = accounts(ctx.preferences as Prefs);
  return list({
    placeholder: "Filter servers by name, IP, region, plan, tag…",
    filter: configured.length > 1
      ? {
        options: [
          { value: "all", title: "All" },
          ...configured.map((a) => ({ value: a.provider, title: PROVIDER_NAMES[a.provider] })),
        ],
        default: "all",
      }
      : undefined,
    empty: { title: "No servers", description: "None of your connected providers has a server", icon: Icons.server },
    status: () => summary,
    async *items({ preferences, filter, signal }) {
      const prefs = preferences as Prefs;
      summary = "";
      const all = accounts(prefs);
      if (!all.length) {
        yield [setupItem()];
        return;
      }
      // A remembered chip of a provider whose token was removed shows everything.
      const picked = all.filter((a) => a.provider === filter);
      const shown = picked.length ? picked : all;
      // Each provider shows up as soon as it answers.
      const results = new Map<Provider, Item[]>();
      const servers: Server[] = [];
      const render = () => PROVIDERS.flatMap((p) => results.get(p) ?? []);
      const pending = new Map(shown.map((a) => [
        a.provider,
        loadServers(a, signal).then(
          (found) => {
            servers.push(...found);
            results.set(a.provider, sortServers(found).map((s) => item(s, a, prefs)));
          },
          (err) => {
            if (signal.aborted) throw err;
            results.set(a.provider, [errorItem(a.provider, err)]);
          },
        ).then(() => a.provider),
      ]));
      while (pending.size) {
        const done = await Promise.race(pending.values());
        pending.delete(done);
        const running = servers.filter((s) => s.state === "running").length;
        const total = monthlyTotal(servers);
        summary = `${servers.length} server${servers.length === 1 ? "" : "s"} · ${running} running${
          total ? ` · ${total}` : ""
        }${pending.size ? " · loading…" : ""}`;
        yield render();
      }
      if (shown === all) {
        await updateCommandMetadata({
          subtitle: servers.length ? `${servers.filter((s) => s.state === "running").length} running` : null,
        }).catch(() => {});
      }
    },
  });
};
