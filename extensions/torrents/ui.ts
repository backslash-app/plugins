// Rows for torrents and the setup guide.

import {
  type Action,
  action,
  clipboard,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import { type Client, SetupError } from "./api.ts";
import { ago, bytes, duration, magnetOf, percent, PRIORITY_NAMES, speed, STATE_LOOK, type Torrent } from "./lib.ts";

// Views share one process: a change wakes the live list up at once.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

function act(title: string, run: () => Promise<unknown>, done: string, o: Parameters<typeof action>[2] = {}): Action {
  return action(title, async () => {
    await run();
    await toast(done, { style: "success" });
    changed();
    return refresh();
  }, o);
}

export function torrentItem(c: Client, t: Torrent): Item {
  const look = STATE_LOOK[t.state];
  const stopped = t.state === "paused" || t.state === "completed";
  const accessories: Item["accessories"] = [];
  if (t.down > 0) accessories.push({ text: `↓ ${speed(t.down)}`, color: "blue", tooltip: "Download speed" });
  if (t.up > 0) accessories.push({ text: `↑ ${speed(t.up)}`, color: "green", tooltip: "Upload speed" });
  if (t.progress < 1 && !stopped && t.eta) {
    accessories.push({ text: duration(t.eta), icon: Icons.clock, tooltip: "ETA" });
  }
  if (t.progress >= 1) accessories.push({ text: t.ratio.toFixed(2), tooltip: "Ratio" });
  accessories.push({ tag: t.progress < 1 ? percent(t.progress) : look.label, color: look.tint, tooltip: look.label });

  const metadata: Metadata[] = [
    meta.progress("Progress", t.progress, `${percent(t.progress)} of ${bytes(t.size)}`),
    meta.text("State", look.label, { icon: look.icon, color: look.tint }),
  ];
  if (t.error) metadata.push(meta.text("Error", t.error, { icon: Icons.alert, color: "red" }));
  metadata.push(
    meta.text("Download", speed(t.down), { icon: Icons.arrowDown }),
    meta.text("Upload", speed(t.up), { icon: Icons.arrowUp }),
  );
  if (t.progress < 1 && t.eta) metadata.push(meta.text("Time left", duration(t.eta), { icon: Icons.clock }));
  metadata.push(meta.text("Ratio", t.ratio.toFixed(2), { icon: Icons.refresh }));
  if (t.uploaded !== undefined) metadata.push(meta.text("Uploaded", bytes(t.uploaded), { icon: Icons.upload }));
  if (t.seeds !== undefined || t.peers !== undefined) {
    metadata.push(
      meta.text(
        "Peers",
        [t.seeds !== undefined ? `${t.seeds} seeds` : "", t.peers !== undefined ? `${t.peers} peers` : ""]
          .filter(Boolean).join(", "),
        { icon: Icons.person },
      ),
    );
  }
  if (c.kind === "transmission" && t.priority !== undefined) {
    metadata.push(meta.text("Priority", PRIORITY_NAMES[t.priority] ?? String(t.priority), { icon: Icons.flag }));
  }
  if (t.queue !== undefined) metadata.push(meta.text("Queue", `#${t.queue}`, { icon: Icons.layers }));
  metadata.push(meta.separator());
  if (t.savePath) metadata.push(meta.text("Folder", t.savePath, { icon: Icons.folder }));
  if (t.tracker) metadata.push(meta.text("Tracker", t.tracker, { icon: Icons.globe }));
  if (t.category) metadata.push(meta.tags("Category", [t.category]));
  if (t.labels?.length) metadata.push(meta.tags("Labels", t.labels));
  if (t.added) metadata.push(meta.text("Added", ago(t.added), { icon: Icons.calendar }));
  if (t.hash) metadata.push(meta.text("Info hash", t.hash, { icon: Icons.hash }));

  const actions: Action[] = [
    stopped
      ? act("Resume", () => c.resume([t.id]), `Resumed ${t.name}`, { icon: Icons.play, shortcut: "<Ctrl>p" })
      : act("Pause", () => c.pause([t.id]), `Paused ${t.name}`, { icon: Icons.pause, shortcut: "<Ctrl>p" }),
  ];
  if (t.savePath) {
    actions.push(
      c.local
        ? open(t.savePath, "Open Download Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" })
        : copy(t.savePath, "Copy Download Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
    );
  }
  actions.push(
    t.magnet
      ? copy(t.magnet, "Copy Magnet Link", { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Copy" })
      : action("Copy Magnet Link", async () => {
        const link = (await c.magnet(t)) ?? (t.hash ? magnetOf(t) : undefined);
        if (!link) throw new Error("This client doesn't give a magnet link for the torrent");
        await clipboard.write(link);
        await toast("Magnet link copied", { style: "success" });
      }, { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(t.name, "Copy Name", { section: "Copy" }),
  );
  if (t.hash) actions.push(copy(t.hash, "Copy Info Hash", { section: "Copy" }));
  actions.push(
    submenu(
      c.kind === "transmission" ? "Set Priority" : "Queue Position",
      c.priorities.map((p) =>
        act(p.title, () => c.setPriority([t.id], p.value), `${t.name}: ${p.title.toLowerCase()}`, { icon: p.icon })
      ),
      { icon: Icons.flag, section: "Manage" },
    ),
    act("Remove", () => c.remove([t.id], false), `Removed ${t.name}`, {
      icon: Icons.minus,
      section: "Manage",
      shortcut: "<Ctrl>Delete",
      confirm: `Remove “${t.name}” from ${c.title}? Downloaded files are kept`,
    }),
    act("Remove with Data", () => c.remove([t.id], true), `Removed ${t.name} and its files`, {
      icon: Icons.trash,
      section: "Manage",
      shortcut: "<Ctrl><Shift>Delete",
      destructive: true,
      confirm: `Delete “${t.name}” and its ${bytes(t.downloaded || t.size)} of files?`,
    }),
    open(c.webUrl, `Open ${c.title} Web UI`, { icon: Icons.globe, section: c.title }),
  );

  return {
    id: t.id,
    title: t.name,
    subtitle: t.error ?? (t.progress < 1 ? `${bytes(t.downloaded)} of ${bytes(t.size)}` : bytes(t.size)),
    icon: { source: look.icon, tint: look.tint },
    keywords: [look.label, t.tracker ?? "", t.category ?? "", ...(t.labels ?? [])],
    accessories,
    detail: {
      stats: [
        { label: "Done", value: percent(t.progress), color: t.progress >= 1 ? "green" : undefined },
        { label: "Down", value: speed(t.down) },
        { label: "Up", value: speed(t.up) },
        { label: t.progress < 1 ? "ETA" : "Ratio", value: t.progress < 1 ? duration(t.eta) : t.ratio.toFixed(2) },
      ],
      metadata,
    },
    actions,
  };
}

/** Turns the alternative speed limits on or off, whichever they are not. */
export async function toggleAltSpeed(c: Client): Promise<string> {
  if (!c.altSpeed) throw new Error(`${c.title} has no alternative speed limits`);
  const on = await c.altSpeed.get();
  await c.altSpeed.set(!on);
  changed();
  return on ? "Alternative speed limits off: full speed" : "Alternative speed limits on";
}

/** The alternative speed limits, as a list-wide action. */
export function altSpeedAction(c: Client): Action[] {
  if (!c.altSpeed) return [];
  return [
    action("Toggle Alternative Speed Limits", async () => {
      await toast(await toggleAltSpeed(c), { style: "success" });
      return refresh();
    }, { icon: Icons.timer, shortcut: "<Ctrl>t" }),
  ];
}

const CONFIGURE = "**Settings → Extensions → Torrents → Configure**";

export function setupItems(e: SetupError): Item[] {
  const md: Record<SetupError["kind"], string[]> = {
    url: [
      "## Connect your torrent client",
      "",
      `In ${CONFIGURE}, pick the client and its web address:`,
      "",
      "- **Transmission**: `http://localhost:9091` (enable remote access in Preferences → Remote, or `rpc-enabled` in settings.json)",
      "- **qBittorrent**: `http://localhost:8080` (Tools → Options → Web UI → enable)",
      "- **Deluge**: `http://localhost:8112` (enable the Web UI plugin, or run `deluge-web`)",
      "",
      "Leave the client on **auto** and the address empty to find one running on this computer.",
    ],
    auth: [
      "## Sign in to the client",
      "",
      `Set the user name and password of the web UI in ${CONFIGURE}. Deluge only needs the password (default \`deluge\`).`,
      "",
      "qBittorrent can skip it for this computer: Options → Web UI → **Bypass authentication for clients on localhost**.",
    ],
    host: [
      "## Address not reachable from Backslash",
      "",
      "Extensions declare the hosts they may reach. This one covers this computer, local names (`*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale (`100.64.x.x`, `*.ts.net`).",
      "",
      `Use the machine's local IP address in ${CONFIGURE}.`,
    ],
    down: [
      "## The client doesn't answer",
      "",
      `Check that it is running and its web UI is enabled at \`${
        e.base ?? "http://localhost:…"
      }\`. The address is in ${CONFIGURE}.`,
    ],
    daemon: [
      "## Connect Deluge's web UI to a daemon",
      "",
      "Open the web UI, then **Connection Manager**: add the daemon (usually `127.0.0.1:58846`) and connect.",
    ],
  };
  const actions: Action[] = [];
  if (e.base && e.kind !== "host") actions.push(open(e.base, "Open Web UI", { icon: Icons.globe }));
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Torrent client settings",
    icon: { source: e.kind === "auth" ? Icons.key : Icons.plug, tint: "orange" },
    detail: { markdown: md[e.kind].join("\n") },
    actions,
  }];
}
