import {
  type Accessory,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  refresh,
  storage,
} from "@backslash/api";
import { address, ago, type Host, sftpUrl, sortHosts, sshCommand } from "../lib.ts";
import { loadHosts, SSH_DIR, tilde } from "../hosts.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

type Recent = Record<string, number>;

const recentKey = (h: Host) => (h.source === "config" ? h.alias : `known:${h.alias}:${h.port ?? 22}`);

async function remember(h: Host) {
  const recent = (await storage.get<Recent>("recent")) ?? {};
  recent[recentKey(h)] = Date.now();
  // Keep the 30 newest.
  const kept = Object.entries(recent).sort((a, b) => b[1] - a[1]).slice(0, 30);
  await storage.set("recent", Object.fromEntries(kept));
}

async function forget(h: Host) {
  const recent = (await storage.get<Recent>("recent")) ?? {};
  delete recent[recentKey(h)];
  await storage.set("recent", recent);
}

const FORWARDS = ["LocalForward", "RemoteForward", "DynamicForward"];

function metadata(h: Host, last?: number): Metadata[] {
  const lines: Metadata[] = [];
  if (h.source === "config") {
    lines.push(meta.text("HostName", h.hostName ?? h.alias, { icon: Icons.server }));
    if (h.user) lines.push(meta.person("User", h.user));
    lines.push(meta.text("Port", h.port ?? "22", { icon: Icons.plug }));
    if (h.identityFiles.length) {
      lines.push(meta.tags("Identity", h.identityFiles.map((f) => ({ text: tilde(f), color: "yellow" as const }))));
    }
    if (h.proxyJump) lines.push(meta.text("ProxyJump", h.proxyJump, { icon: Icons.arrowRight, color: "purple" }));
    const forwards = h.options.filter(([k]) => FORWARDS.some((f) => f.toLowerCase() === k.toLowerCase()));
    if (forwards.length) {
      lines.push(meta.tags("Forwards", forwards.map(([k, v]) => `${k.replace("Forward", "")} ${v}`)));
    }
    const others = h.options.filter((o) => !forwards.includes(o));
    if (others.length) lines.push(meta.tags("Options", others.slice(0, 10).map(([k, v]) => `${k} ${v}`)));
    lines.push(meta.separator());
    if (h.file) lines.push(meta.text("Defined in", `${tilde(h.file)}:${h.line}`, { icon: Icons.file }));
  } else {
    lines.push(meta.text("Host", h.alias, { icon: Icons.globe }));
    if (h.port) lines.push(meta.text("Port", h.port, { icon: Icons.plug }));
    if (h.addresses?.length) lines.push(meta.tags("Addresses", h.addresses.slice(0, 6)));
    if (h.keyTypes?.length) {
      lines.push(
        meta.tags("Host keys", h.keyTypes.map((k) => ({ text: k.replace(/^ssh-/, ""), color: "green" as const }))),
      );
    }
    lines.push(meta.separator());
    lines.push(meta.text("Found in", "~/.ssh/known_hosts", { icon: Icons.file }));
  }
  if (last) lines.push(meta.text("Last opened", ago(last), { icon: Icons.history }));
  return lines;
}

function item(h: Host, prefs: Prefs, recent: Recent): Item {
  const last = recent[recentKey(h)];
  const argv = sshCommand(h);
  const command = shellLine(argv);
  const addr = address(h);
  const accessories: Accessory[] = [];
  if (h.proxyJump) accessories.push({ icon: Icons.arrowRight, text: h.proxyJump, tooltip: "ProxyJump" });
  if (h.identityFiles.length) {
    accessories.push({ icon: { source: Icons.key, tint: "yellow" }, tooltip: h.identityFiles.map(tilde).join(", ") });
  }
  if (h.source === "known_hosts") accessories.push({ tag: "known_hosts", color: "gray" });
  if (last) accessories.push({ text: ago(last), icon: Icons.history });
  const connect = action("Connect in Terminal", async () => {
    runInTerminal(argv, prefs.terminal || undefined);
    await remember(h);
    return close();
  }, { icon: Icons.terminal });
  return {
    id: recentKey(h),
    title: h.alias,
    subtitle: addr !== h.alias ? addr : undefined,
    icon: {
      source: h.source === "config" ? Icons.server : Icons.globe,
      tint: h.source === "known_hosts" ? "gray" : h.proxyJump ? "purple" : "blue",
    },
    section: last ? "Recent" : h.source === "config" ? "SSH Config" : "Known Hosts",
    keywords: [h.hostName ?? "", h.user ?? "", h.proxyJump ?? "", ...(h.addresses ?? [])],
    accessories,
    detail: {
      markdown: [
        "```sh",
        command,
        "```",
        ...(h.raw.length ? ["", "```", ...h.raw.map((l) => l.trimEnd()), "```"] : []),
      ].join("\n"),
      metadata: metadata(h, last),
    },
    actions: [
      connect,
      action("Open SFTP in File Manager", async () => {
        await openExternal(sftpUrl(h));
        await remember(h);
        return close();
      }, { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      copy(command, "Copy SSH Command", { icon: Icons.terminal, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(h.hostName ?? h.alias, "Copy Hostname", { icon: Icons.server, shortcut: "<Ctrl>period", section: "Copy" }),
      ...(addr !== (h.hostName ?? h.alias) ? [copy(addr, "Copy Address", { section: "Copy" })] : []),
      copy(sftpUrl(h), "Copy SFTP URL", { icon: Icons.link, section: "Copy" }),
      copy(shellLine(["ssh-copy-id", ...argv.slice(1)]), "Copy ssh-copy-id Command", {
        icon: Icons.key,
        section: "Copy",
      }),
      ...(h.file ? [open(h.file, "Open Config File", { icon: Icons.file, section: "Config" })] : []),
      ...(last
        ? [action("Remove from Recent", async () => {
          await forget(h);
          return refresh();
        }, { icon: Icons.history, section: "Config" })]
        : []),
    ],
  };
}

let counts = { config: 0, known: 0 };

export default list({
  placeholder: "Search SSH hosts by alias, hostname, user…",
  empty: {
    title: "No SSH hosts",
    description: "Add hosts to ~/.ssh/config, or connect once so they are remembered in ~/.ssh/known_hosts",
    icon: Icons.server,
  },
  status: () =>
    `${counts.config} host${counts.config === 1 ? "" : "s"} in config` +
    (counts.known ? ` · ${counts.known} more in known_hosts` : ""),
  actions: [open(`${SSH_DIR}/config`, "Open SSH Config", { icon: Icons.file })],
  async items({ preferences }) {
    const prefs = preferences as Prefs;
    const { config, known } = loadHosts();
    counts = { config: config.length, known: known.length };
    const recent = (await storage.get<Recent>("recent")) ?? {};
    const byKey: Record<string, number> = {};
    for (const h of [...config, ...known]) if (recent[recentKey(h)]) byKey[h.alias] = recent[recentKey(h)];
    return sortHosts([...config, ...known], byKey).map((h) => item(h, prefs, recent));
  },
});
