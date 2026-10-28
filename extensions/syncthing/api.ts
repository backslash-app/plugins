// Syncthing's REST API, with the API key of the local config.xml or the one in the preferences.

import { action, copy, exec, Icons, type Item, open, refresh } from "@backslash/api";
import { baseFromGui, type GuiConfig, parseConfigXml } from "./lib.ts";

/**
 * Where a Syncthing GUI usually listens, as declared in `[permissions] net`
 * (kept equal by a test): this computer, and a NAS or server on the local
 * network or Tailscale.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

export const DEFAULT_BASE = "http://127.0.0.1:8384";

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `localhost:8384/` → `http://localhost:8384`. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "").replace(/\/rest$/, "").replace(/\/#.*$/, "");
}

export type SetupKind = "down" | "key" | "host" | "tls";

export class SetupError extends Error {
  constructor(message: string, readonly kind: SetupKind, readonly base?: string) {
    super(message);
  }
}

export interface Server {
  base: string;
  key: string;
}

export const HOME = (() => {
  try {
    return Deno.env.get("HOME");
  } catch {
    return undefined;
  }
})();

/** config.xml of a Syncthing 1.27+ (XDG state) or older (XDG config) install. */
export const CONFIG_FILES = HOME
  ? [`${HOME}/.local/state/syncthing/config.xml`, `${HOME}/.config/syncthing/config.xml`]
  : [];

async function localGui(): Promise<GuiConfig | undefined> {
  for (const file of CONFIG_FILES) {
    try {
      return parseConfigXml(await Deno.readTextFile(file));
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

export async function server(preferences: Record<string, unknown>): Promise<Server> {
  const gui = await localGui();
  const base = normalizeUrl(preferences.url) || (gui && baseFromGui(gui)) || DEFAULT_BASE;
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${preferences.url}” is not an address`, "host");
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, "host");
  const key = String(preferences.apiKey ?? "").trim() || gui?.apiKey || "";
  if (!key) {
    throw new SetupError(
      gui ? "No API key in Syncthing's configuration" : "Syncthing's configuration was not found",
      gui ? "key" : "down",
      base,
    );
  }
  return { base, key };
}

export async function st<T>(
  s: Server,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: { "X-API-Key": s.key, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).host} is outside the networks this extension may reach`, "host");
    }
    let text = "";
    for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) text += ` ${x}`;
    if (/certificate|UnknownIssuer|NotValidForName/i.test(text)) {
      throw new SetupError("Syncthing's Web UI uses a self-signed HTTPS certificate", "tls", s.base);
    }
    throw new SetupError(`Syncthing is not running at ${new URL(s.base).host}`, "down", s.base);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SetupError("Syncthing rejected the API key", "key", s.base);
  }
  if (!res.ok) {
    const text = (await res.text()).trim().slice(0, 200);
    throw new Error(`Syncthing answered ${res.status}${text ? `: ${text}` : ""}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------------------
// Setup

/** `ID` and `ID_LIKE` of /etc/os-release. */
export function osIds(osRelease: string): string[] {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(osRelease)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  return `${get("ID")} ${get("ID_LIKE")}`.toLowerCase().split(/\s+/).filter(Boolean);
}

export function installCommand(osRelease: string): string {
  const ids = osIds(osRelease);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "sudo pacman -S syncthing";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "sudo dnf install syncthing";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "sudo zypper install syncthing";
  if (ids.includes("nixos")) return "services.syncthing.enable = true; # configuration.nix";
  return "sudo apt install syncthing";
}

async function startSyncthing() {
  try {
    await exec("systemctl", ["--user", "enable", "--now", "syncthing.service"]);
  } catch (e) {
    throw new Error(`Couldn't start syncthing.service: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  return refresh();
}

export async function setupItems(error: SetupError): Promise<Item[]> {
  if (error.kind === "host") {
    return [{
      id: "setup",
      title: error.message,
      subtitle: "Use a local or Tailscale address",
      icon: { source: Icons.globe, tint: "orange" },
      detail: {
        markdown: [
          "## Address not reachable from Backslash",
          "",
          "Extensions declare the hosts they may reach. This one covers this computer (`localhost`, `127.0.0.1`), local names (`*.local`, `*.lan`, `*.home.arpa`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale (`100.64.x.x`, `*.ts.net`).",
          "",
          "Change the address in **Settings → Extensions → Syncthing → Configure**.",
        ].join("\n"),
      },
      actions: [],
    }];
  }
  if (error.kind === "tls") {
    return [{
      id: "setup",
      title: error.message,
      subtitle: "Turn off “Use HTTPS for GUI” for this computer",
      icon: { source: Icons.lock, tint: "orange" },
      detail: {
        markdown: [
          "## HTTPS with a self-signed certificate",
          "",
          "Backslash can't skip certificate checks, and Syncthing's own certificate can't be verified.",
          "",
          "The GUI listens on this computer only (`127.0.0.1`), so plain HTTP is safe: in the Web UI, **Actions → Settings → GUI**, uncheck **Use HTTPS for GUI**.",
        ].join("\n"),
      },
      actions: error.base ? [open(error.base, "Open Syncthing Web UI", { icon: Icons.globe })] : [],
    }];
  }
  if (error.kind === "key") {
    return [{
      id: "setup",
      title: error.message,
      subtitle: "Copy it from Syncthing → Actions → Settings → GUI",
      icon: { source: Icons.key, tint: "orange" },
      detail: {
        markdown: [
          "## Connect to Syncthing",
          "",
          "Backslash reads the API key from `~/.local/state/syncthing/config.xml` (or `~/.config/syncthing/config.xml`).",
          "",
          "For another Syncthing (a NAS, a Flatpak or Snap install), open its Web UI → **Actions → Settings → GUI**, copy the **API Key** and paste it, with the address, in **Settings → Extensions → Syncthing → Configure**.",
        ].join("\n"),
      },
      actions: error.base ? [open(error.base, "Open Syncthing Web UI", { icon: Icons.globe })] : [],
    }];
  }
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const install = installCommand(os);
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Start it, or install it first",
    icon: { source: Icons.cloud, tint: "orange" },
    detail: {
      markdown: [
        "## Syncthing is not running",
        "",
        "Start the user service (Enter), or install Syncthing:",
        "",
        "```",
        install,
        "systemctl --user enable --now syncthing.service",
        "```",
        "",
        "Syncthing elsewhere (a NAS, a Flatpak like SyncThingy)? Set its address and API key in **Settings → Extensions → Syncthing → Configure**.",
      ].join("\n"),
    },
    actions: [
      action("Start Syncthing", startSyncthing, { icon: Icons.play }),
      copy(install, "Copy Install Command", { section: "Copy" }),
      open("https://syncthing.net/downloads/", "Download Syncthing", { icon: Icons.download, section: "Help" }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return await setupItems(e);
    throw e;
  }
}
