import {
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Cli, cli, errorItems, inTerminal, type Prefs, raw, vault, VaultError } from "../cli.ts";
import {
  duration,
  formatDate,
  parseStatus,
  parseToken,
  PRODUCT,
  relative,
  type Status,
  type Token,
  ttlColor,
} from "../lib.ts";

const fence = (text: string, lang = "") => `\`\`\`${lang}\n${text.replace(/```/g, "ʼʼʼ")}\n\`\`\``;

/** `vault status` exits 2 when sealed, with its JSON anyway. */
async function serverStatus(c: Cli, signal: AbortSignal): Promise<Status | Error> {
  const r = await raw(c, ["status", "-format=json"], signal);
  if (r.stdout.startsWith("{")) return parseStatus(r.stdout);
  try {
    await vault(c, ["status", "-format=json"], signal);
  } catch (e) {
    return e as Error;
  }
  return new Error("No status");
}

function serverItem(c: Cli, s: Status | Error): Item {
  const product = PRODUCT[c.program];
  const ui = open(`${c.address}/ui/`, `Open ${product} UI`, { icon: Icons.globe, shortcut: "<Ctrl>o" });
  const copyAddr = copy(`export VAULT_ADDR=${c.address}`, "Copy export VAULT_ADDR", {
    section: "Copy",
    icon: Icons.terminal,
  });
  if (s instanceof Error) {
    return {
      id: "server",
      title: c.address.replace(/^https?:\/\//, ""),
      subtitle: s.message,
      icon: { source: Icons.server, tint: "red" },
      section: "Server",
      accessories: [{ tag: "Unreachable", color: "red" }],
      detail: { markdown: s instanceof VaultError && s.detail ? fence(s.detail.slice(0, 1500)) : s.message },
      actions: [action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }), ui, copyAddr],
    };
  }
  const state = !s.initialized ? "Not initialized" : s.sealed ? "Sealed" : "Unsealed";
  const color = !s.initialized || s.sealed ? "red" : "green";
  return {
    id: "server",
    title: c.address.replace(/^https?:\/\//, ""),
    subtitle: `${product} ${s.version}`,
    icon: { source: s.sealed ? Icons.lock : Icons.server, tint: color },
    section: "Server",
    accessories: [
      ...(s.haMode ? [{ tag: s.haMode === "active" ? "Active" : "Standby", color: "blue" as const }] : []),
      { tag: state, color },
    ],
    detail: {
      stats: [
        { label: "Version", value: s.version || "?" },
        { label: "Seal", value: state, color },
        ...(s.sealed
          ? [{ label: "Unseal progress", value: `${s.progress}/${s.threshold}`, color: "orange" as const }]
          : []),
      ],
      metadata: [
        meta.link("Address", c.address, `${c.address}/ui/`),
        meta.text("Address from", c.addressSource),
        meta.text("CLI", c.program, { icon: Icons.terminal }),
        meta.separator(),
        meta.text("Storage", s.storage || "—", { icon: Icons.database }),
        meta.text("Seal type", s.sealType ? `${s.sealType}${s.shares ? ` (${s.threshold} of ${s.shares})` : ""}` : "—"),
        ...(s.clusterName ? [meta.text("Cluster", s.clusterName)] : []),
        meta.text("High availability", s.haEnabled ? `Enabled (${s.haMode})` : "Disabled"),
        ...(s.leader && s.haMode === "standby" ? [meta.text("Leader", s.leader)] : []),
      ],
    },
    actions: [ui, action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }), copyAddr],
  };
}

function tokenItem(c: Cli, t: Token): Item {
  const color = ttlColor(t.ttl);
  const left = t.ttl ? `expires in ${duration(t.ttl)}` : "never expires";
  const actions = [
    ...(t.renewable
      ? [action("Renew Token", async () => {
        const renewed = JSON.parse(await vault(c, ["token", "renew", "-format=json"]));
        const ttl = Number(renewed?.auth?.lease_duration) || 0;
        await toast("Token renewed", { style: "success", message: ttl ? `Valid for ${duration(ttl)}` : undefined });
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })]
      : []),
    inTerminal(c, `Log In Again (${c.program} login)`, ["login"], { icon: Icons.key, shortcut: "<Ctrl>l" }),
    copy(t.accessor, "Copy Token Accessor", { section: "Copy" }),
    ...(t.entityId ? [copy(t.entityId, "Copy Entity ID", { section: "Copy" })] : []),
  ];
  return {
    id: "token",
    title: t.displayName || "Token",
    subtitle: left,
    icon: { source: Icons.key, tint: color },
    section: "Token",
    keywords: ["token", "ttl", ...t.policies],
    accessories: [
      { tag: t.ttl ? duration(t.ttl) : "No expiry", color },
      { text: `${t.policies.length} polic${t.policies.length === 1 ? "y" : "ies"}` },
    ],
    detail: {
      stats: [
        { label: "Time left", value: t.ttl ? duration(t.ttl) : "∞", color },
        { label: "Policies", value: t.policies.length },
        ...(t.numUses ? [{ label: "Uses left", value: t.numUses }] : []),
      ],
      metadata: [
        meta.text("Display name", t.displayName || "—", { icon: Icons.person }),
        meta.tags("Policies", t.policies.map((p) => ({ text: p, color: p === "root" ? "red" : "blue" }))),
        meta.separator(),
        ...(t.expireTime ? [meta.text("Expires", `${formatDate(t.expireTime)} (${relative(t.expireTime)})`)] : []),
        ...(t.creationTtl ? [meta.text("Initial TTL", duration(t.creationTtl))] : []),
        ...(t.issueTime ? [meta.text("Issued", formatDate(t.issueTime))] : []),
        meta.text("Renewable", t.renewable ? "Yes" : "No"),
        meta.text("Type", `${t.type}${t.orphan ? ", orphan" : ""}`),
        ...(t.path ? [meta.text("Auth path", t.path)] : []),
        meta.text("Token from", c.tokenSource),
        ...Object.entries(t.meta).map(([k, v]) => meta.text(k, String(v), { icon: Icons.tag })),
      ],
    },
    actions,
  };
}

function policyItem(c: Cli, name: string): Item {
  const read = async () => await vault(c, ["policy", "read", name]);
  return {
    id: `policy:${name}`,
    title: name,
    icon: { source: Icons.shield, tint: name === "root" ? "red" : "blue" },
    section: "Policies",
    keywords: ["policy"],
    accessories: name === "root" ? [{ tag: "Everything", color: "red" }] : [],
    actions: [
      action("Show Policy", async () => {
        if (name === "root") {
          return detail({ title: "root", markdown: "The **root** policy can do anything; it has no rules to show." });
        }
        let text: string;
        try {
          text = await read();
        } catch (e) {
          text = e instanceof VaultError && e.kind === "denied"
            ? "_Your token may not read this policy (it needs `read` on `sys/policy/" + name + "`)._"
            : String((e as Error).message);
          return detail({ title: name, markdown: text });
        }
        return detail({
          title: `Policy ${name}`,
          markdown: fence(text, "hcl"),
          actions: [copy(text, "Copy Policy")],
        });
      }, { icon: Icons.shield }),
      copy(name, "Copy Name", { section: "Copy" }),
      open(`${c.address}/ui/vault/policy/acl/${encodeURIComponent(name)}`, `Open in ${PRODUCT[c.program]} UI`, {
        shortcut: "<Ctrl>o",
      }),
    ],
  };
}

export default list({
  placeholder: "Server, token and policies…",
  empty: { title: "No status", icon: Icons.server },
  items: async ({ preferences, signal }) => {
    let c: Cli | undefined;
    try {
      c = await cli(preferences as Prefs);
      const [server, token] = await Promise.all([
        serverStatus(c, signal),
        vault(c, ["token", "lookup", "-format=json"], signal).then(parseToken, (e) => e as Error),
      ]);
      const items: Item[] = [serverItem(c, server)];
      if (token instanceof Error) {
        if (server instanceof VaultError && token instanceof VaultError && server.kind !== "other") {
          return errorItems(server, c);
        }
        items.push(...errorItems(token, c).map((i) => ({ ...i, id: "token", section: "Token" })));
        updateCommandMetadata({ subtitle: "Not logged in" }).catch(() => {});
        return items;
      }
      items.push(tokenItem(c, token));
      items.push(...token.policies.map((p) => policyItem(c!, p)));
      updateCommandMetadata({
        subtitle: token.ttl ? `Token expires in ${duration(token.ttl)}` : null,
      }).catch(() => {});
      return items;
    } catch (e) {
      return errorItems(e, c);
    }
  },
});
