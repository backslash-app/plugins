import {
  type Action,
  action,
  close,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  ago,
  bytes,
  type Device,
  deviceIcon,
  exitNodeArgs,
  exitNodeInUse,
  expandPaths,
  explainError,
  installCommand,
  osFamily,
  osName,
  parsePing,
  parseStatus,
  sshArgv,
  stateLook,
  type Status,
  statusLine,
  subtitle,
  taildropArgs,
  until,
} from "../lib.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

const HOME = Deno.env.get("HOME") ?? "";
const ADMIN = "https://login.tailscale.com/admin/machines";

class NotInstalled extends Error {}

/** Runs tailscale; stdout even on a non-zero exit (`status --json` exits 1 when stopped). */
async function tailscale(
  args: string[],
  o: { signal?: AbortSignal } = {},
): Promise<{ ok: boolean; out: string; err: string }> {
  let result;
  try {
    result = await new Deno.Command("tailscale", {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: o.signal,
    })
      .output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled("Tailscale is not installed");
    throw e;
  }
  const decode = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  return { ok: result.success, out: decode(result.stdout), err: decode(result.stderr) };
}

/** Runs a tailscale command for an action, or throws what to do about its failure. */
async function must(args: string[]): Promise<string> {
  const r = await tailscale(args);
  if (!r.ok) throw new Error(explainError(r.err || r.out || `tailscale ${args[0]} failed`));
  return r.out;
}

let current: Status | undefined;

function taildropForm(d: Device) {
  return form({
    title: `Send to ${d.name}`,
    submitTitle: "Send",
    fields: [
      field.textArea("paths", "Files", {
        placeholder: "~/Documents/report.pdf\n~/Pictures/photo.jpg",
        required: true,
      }),
    ],
    async submit(values) {
      const paths = expandPaths(String(values.paths ?? ""), HOME);
      if (!paths.length) throw new Error("Type the path of a file, one per line");
      await toast(`Sending ${paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} files`}…`);
      await must(taildropArgs(paths, d));
      await toast(`Sent to ${d.name}`, { style: "success", message: `Accept it in Taildrop on ${d.name}` });
      return pop();
    },
  });
}

function connectActions(s: Status): Action[] {
  const running = s.state === "Running";
  return [
    running
      ? action("Disconnect", async () => {
        await must(["down"]);
        await toast("Tailscale disconnected");
        return refresh();
      }, {
        icon: Icons.power,
        destructive: true,
        confirm: "Disconnect from the tailnet? Devices stop reaching this one",
        shortcut: "<Ctrl><Shift>d",
        section: "Connection",
      })
      : action(s.state === "NeedsLogin" ? "Sign In" : "Connect", async () => {
        if (s.state === "NeedsLogin" && s.authUrl) return await signIn(s.authUrl);
        const r = await tailscale(["up", "--timeout=15s"]);
        const url = /https:\/\/login\.tailscale\.com\/\S+/.exec(`${r.out}\n${r.err}`)?.[0];
        if (url) return await signIn(url);
        if (!r.ok) throw new Error(explainError(r.err || r.out));
        await toast("Tailscale connected", { style: "success" });
        return refresh();
      }, { icon: Icons.power, shortcut: "<Ctrl><Shift>d", section: "Connection" }),
    ...(exitNodeInUse(s)
      ? [action(`Stop Using ${exitNodeInUse(s)!.name} as Exit Node`, async () => {
        await must(exitNodeArgs());
        await toast("Exit node cleared");
        return refresh();
      }, { icon: Icons.cross, section: "Connection" })]
      : []),
  ];
}

async function signIn(url: string) {
  await openExternal(url);
  return close("Finish signing in in your browser");
}

function deviceDetail(d: Device, s: Status): Metadata[] {
  const look = d.online ? { text: "Online", color: "green" as const } : { text: "Offline", color: "gray" as const };
  return [
    meta.text("Status", d.isSelf ? stateLook(s.state).label : look.text, {
      icon: { source: Icons.dot, tint: d.isSelf ? stateLook(s.state).color : look.color },
    }),
    ...(!d.online && d.lastSeen ? [meta.text("Last seen", ago(d.lastSeen), { icon: Icons.clock })] : []),
    ...(d.ipv4 ? [meta.text("IPv4", d.ipv4, { icon: Icons.hash })] : []),
    ...(d.ipv6 ? [meta.text("IPv6", d.ipv6)] : []),
    ...(d.dnsName ? [meta.text("MagicDNS", d.dnsName, { icon: Icons.globe })] : []),
    meta.separator(),
    meta.text("OS", osName(d.os), { icon: deviceIcon(d) }),
    ...(d.hostName && d.hostName !== d.name ? [meta.text("Hostname", d.hostName)] : []),
    ...(d.owner ? [meta.person("Owner", d.owner)] : []),
    ...(d.tags.length
      ? [meta.tags("Tags", d.tags.map((t) => ({ text: t.replace(/^tag:/, ""), color: "blue" as const })))]
      : []),
    ...(d.exitNode || d.exitNodeOption
      ? [meta.text("Exit node", d.exitNode ? "In use" : "Available", {
        icon: { source: Icons.globe, tint: d.exitNode ? "purple" : "gray" },
        color: d.exitNode ? "purple" : undefined,
      })]
      : []),
    ...(d.tailscaleSsh ? [meta.text("SSH", "Tailscale SSH", { icon: Icons.terminal })] : []),
    ...(!d.isSelf && d.connection
      ? [
        meta.text(
          "Connection",
          d.connection.kind === "direct" ? `Direct (${d.connection.address})` : `Relay ${d.connection.region}`,
          {
            icon: Icons.link,
          },
        ),
      ]
      : []),
    ...(d.rxBytes || d.txBytes
      ? [meta.text("Traffic", `↓ ${bytes(d.rxBytes)}  ↑ ${bytes(d.txBytes)}`, { icon: Icons.activity })]
      : []),
    ...(d.keyExpiry
      ? [
        meta.text("Key expires", until(d.keyExpiry), {
          icon: Icons.key,
          color: until(d.keyExpiry) === "expired" ? "red" : undefined,
        }),
      ]
      : []),
  ];
}

function deviceItem(d: Device, s: Status, prefs: { sshUser?: string; terminal?: string }): Item {
  const ip = d.ipv4 ?? d.ipv6;
  const section = d.isSelf ? "This Device" : d.exitNode ? "Exit Node" : d.online ? "Online" : "Offline";
  const tint = d.isSelf ? stateLook(s.state).color : d.exitNode ? "purple" : d.online ? "green" : "gray";
  const argv = sshArgv(d, prefs.sshUser);
  const copies: Action[] = [
    ...(ip ? [copy(ip, "Copy IP Address", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    ...(d.dnsName ? [copy(d.dnsName, "Copy MagicDNS Name", { shortcut: "<Ctrl>period", section: "Copy" })] : []),
    ...(d.ipv6 && d.ipv4 ? [copy(d.ipv6, "Copy IPv6 Address", { section: "Copy" })] : []),
    ...(d.isSelf ? [] : [copy(shellLine(argv), "Copy SSH Command", { section: "Copy" })]),
  ];
  const peerActions: Action[] = d.isSelf ? [] : [
    action(d.tailscaleSsh ? "Tailscale SSH in Terminal" : "SSH in Terminal", () => {
      runInTerminal(argv, prefs.terminal?.trim() || undefined);
      return close();
    }, { icon: Icons.terminal, shortcut: "<Ctrl>t" }),
    action("Ping", async () => {
      await toast(`Pinging ${d.name}…`);
      const r = await tailscale(["ping", "-c", "1", "--timeout=5s", d.ipv4 ?? d.dnsName]);
      const pong = parsePing(`${r.out}\n${r.err}`);
      if (pong) {
        await toast(`${d.name}: ${pong.ms} ms`, {
          style: "success",
          message: pong.direct ? `Direct via ${pong.via}` : `Through ${pong.via}`,
        });
      } else await toast(`${d.name} did not answer`, { style: "failure", message: explainError(r.err || r.out) });
    }, { icon: Icons.activity, shortcut: "<Ctrl>p" }),
    action("Send Files with Taildrop…", () => taildropForm(d), { icon: Icons.upload, shortcut: "<Ctrl>u" }),
    ...(d.exitNode
      ? [action("Stop Using as Exit Node", async () => {
        await must(exitNodeArgs());
        await toast("Exit node cleared");
        return refresh();
      }, { icon: Icons.cross, shortcut: "<Ctrl>e", section: "Exit Node" })]
      : d.exitNodeOption
      ? [action("Use as Exit Node", async () => {
        await must(exitNodeArgs(d));
        await toast(`Traffic now goes through ${d.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.globe, shortcut: "<Ctrl>e", section: "Exit Node" })]
      : []),
    ...(d.dnsName ? [open(`http://${d.dnsName}`, "Open in Browser", { icon: Icons.globe, section: "Open" })] : []),
  ];
  const selfActions: Action[] = d.isSelf
    ? [
      ...connectActions(s),
      action("Receive Taildrop Files", async () => {
        const dir = `${HOME}/Downloads`;
        const out = await must(["file", "get", "--conflict=rename", dir]);
        const n = (out.match(/\n/g)?.length ?? 0) + (out ? 1 : 0);
        await toast(n ? `Saved to ~/Downloads` : "No file waiting", { style: n ? "success" : "info" });
      }, { icon: Icons.download, section: "Taildrop" }),
    ]
    : [];
  return {
    id: d.id,
    title: d.name,
    subtitle: d.isSelf ? stateLook(s.state).label : osName(d.os),
    icon: { source: deviceIcon(d), tint },
    section,
    keywords: [d.dnsName, d.hostName, d.ipv4 ?? "", d.ipv6 ?? "", d.os, ...d.tags, d.owner ?? "", d.ownerLogin ?? ""],
    accessories: [
      ...(d.exitNode
        ? [{ tag: "exit node", color: "purple" as const }]
        : d.exitNodeOption
        ? [{ tag: "exit node", color: "gray" as const }]
        : []),
      ...d.tags.slice(0, 2).map((t) => ({ tag: t.replace(/^tag:/, ""), color: "blue" as const })),
      ...(!d.online && !d.isSelf && d.lastSeen
        ? [{ text: ago(d.lastSeen), icon: Icons.clock, tooltip: "Last seen" }]
        : []),
      ...(ip ? [{ text: ip }] : []),
    ],
    detail: { metadata: deviceDetail(d, s) },
    actions: [
      ...(ip ? [copy(ip, "Copy IP Address")] : []),
      ...peerActions,
      ...selfActions,
      ...copies.slice(ip ? 1 : 0),
      ...(ip ? [open(`${ADMIN}/${ip}`, "Open in Admin Console", { section: "Open" })] : []),
    ],
  };
}

async function setupItems(e: unknown): Promise<Item[]> {
  if (e instanceof NotInstalled) {
    const family = osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
    const cmd = installCommand(family);
    return [{
      id: "install",
      title: "Tailscale is not installed",
      subtitle: cmd,
      icon: { source: Icons.download, tint: "orange" },
      detail: {
        markdown: [
          "## Install Tailscale",
          "",
          "```",
          cmd,
          "sudo systemctl enable --now tailscaled",
          "sudo tailscale up --operator=$USER",
          "```",
          "",
          "`--operator=$USER` lets you connect, disconnect and pick exit nodes from here without sudo.",
        ].join("\n"),
      },
      actions: [
        copy(cmd, "Copy Install Command"),
        open("https://tailscale.com/download/linux", "Open Install Guide"),
      ],
    }];
  }
  const message = explainError(e instanceof Error ? e.message : String(e));
  const fix = /systemctl/.test(message) ? "sudo systemctl enable --now tailscaled" : undefined;
  return [{
    id: "error",
    title: message.split(":")[0],
    subtitle: fix ?? message,
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: `**${message}**` },
    actions: [
      ...(fix ? [copy(fix, "Copy Command")] : []),
      action("Try Again", () => refresh(), { icon: Icons.refresh }),
    ],
  }];
}

export default (ctx: Context) => {
  const prefs = { sshUser: String(ctx.preferences.sshUser ?? ""), terminal: String(ctx.preferences.terminal ?? "") };
  return list({
    placeholder: "Filter devices by name, IP, OS, tag, owner…",
    filter: {
      options: [
        { value: "all", title: "All Devices" },
        { value: "online", title: "Online" },
        { value: "exit", title: "Exit Nodes" },
      ],
    },
    empty: { title: "No device here", description: "Devices you add to your tailnet show up here", icon: Icons.vpn },
    actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    status: () => (current ? statusLine(current) : "Tailscale"),
    items: async ({ filter, signal }) => {
      current = undefined;
      try {
        const r = await tailscale(["status", "--json"], { signal });
        if (!r.out.startsWith("{")) throw new Error(r.err || r.out || "tailscale status failed");
        const s = parseStatus(r.out);
        current = s;
        updateCommandMetadata({ subtitle: subtitle(s) }).catch(() => {});
        let peers = s.peers;
        if (filter === "online") peers = peers.filter((p) => p.online);
        if (filter === "exit") peers = peers.filter((p) => p.exitNodeOption || p.exitNode);
        const self = s.self ? [deviceItem(s.self, s, prefs)] : [];
        if (s.state === "NeedsLogin" || s.state === "Stopped" || s.state === "NoState") {
          // Peers are stale while disconnected: show this device with its Connect action first.
          return [...self, ...peers.map((p) => deviceItem({ ...p, online: false }, s, prefs))];
        }
        return [...self, ...peers.map((p) => deviceItem(p, s, prefs))];
      } catch (e) {
        if (signal.aborted) throw e;
        updateCommandMetadata({ subtitle: e instanceof NotInstalled ? null : "Not running" }).catch(() => {});
        return setupItems(e);
      }
    },
  });
};
