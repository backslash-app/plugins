// Parsing what waydroid prints and the launchers it exports. Pure, tested in lib_test.ts.

export type SessionState = "RUNNING" | "STOPPED" | "UNKNOWN";
export type ContainerState = "RUNNING" | "FROZEN" | "STOPPED" | "UNKNOWN";

export interface Status {
  session: SessionState;
  container: ContainerState;
  vendor?: string;
  ip?: string;
  user?: string;
  display?: string;
  /** `waydroid init` was never run. */
  uninitialized: boolean;
}

/** `waydroid status`: `Session:\tRUNNING`, `Container:\tFROZEN`, `IP address:\t192.168.240.112`… */
export function parseStatus(text: string): Status {
  const field = (key: string) => text.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))?.[1]?.trim();
  const session = (field("Session") ?? "").toUpperCase();
  const container = (field("Container") ?? "").toUpperCase();
  return {
    session: session === "RUNNING" ? "RUNNING" : session === "STOPPED" ? "STOPPED" : "UNKNOWN",
    container: ["RUNNING", "FROZEN", "STOPPED"].includes(container)
      ? container as ContainerState
      : session === "STOPPED"
      ? "STOPPED"
      : "UNKNOWN",
    vendor: field("Vendor type"),
    ip: field("IP address") || undefined,
    user: field("Session user"),
    display: field("Wayland display"),
    uninitialized: /not initiali[sz]ed/i.test(text),
  };
}

export interface App {
  name: string;
  package: string;
  categories: string[];
  /** The icon Waydroid exported, if any. */
  icon?: string;
}

/** `waydroid app list`: `Name:`, `packageName:` and indented `categories:` lines, one block per app. */
export function parseAppList(text: string): App[] {
  const apps: App[] = [];
  let current: App | undefined;
  let inCategories = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const name = line.match(/^Name:\s*(.*)$/);
    if (name) {
      if (current?.package) apps.push(current);
      current = { name: name[1].trim(), package: "", categories: [] };
      inCategories = false;
      continue;
    }
    if (!current) continue;
    const pkg = line.match(/^packageName:\s*(\S+)/);
    if (pkg) {
      current.package = pkg[1];
      inCategories = false;
      continue;
    }
    if (/^categories:/.test(line)) {
      inCategories = true;
      continue;
    }
    if (inCategories && /^\s+\S/.test(line)) current.categories.push(line.trim());
    else if (line.trim()) inCategories = false;
  }
  if (current?.package) apps.push(current);
  return apps;
}

/** `~/.local/share/applications/waydroid.<package>.desktop`, as Waydroid writes them. */
export function parseDesktopEntry(text: string): App | undefined {
  const field = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
  const exec = field("Exec") ?? "";
  const pkg = exec.match(/waydroid\s+app\s+launch\s+(\S+)/)?.[1];
  if (!pkg) return undefined;
  return { name: field("Name") || pkg, package: pkg, categories: [], icon: field("Icon") || undefined };
}

/** `waydroid.com.android.settings.desktop` → `com.android.settings`. */
export const packageOfDesktopFile = (file: string) => file.match(/^waydroid\.(.+)\.desktop$/)?.[1];

/** The running list wins; exported launchers fill in icons and the apps when the session is stopped. */
export function mergeApps(listed: App[], exported: App[]): App[] {
  const byPkg = new Map(exported.map((a) => [a.package, a]));
  const base = listed.length ? listed : exported;
  return base.map((a) => ({ ...a, icon: a.icon ?? byPkg.get(a.package)?.icon }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const SYSTEM =
  /^(com\.android\.|com\.google\.android\.(gms|gsf|packageinstaller)|org\.lineageos\.|android$|com\.waydroid\.)/;

/** Apps that come with the Android image. */
export const isSystemApp = (pkg: string) =>
  SYSTEM.test(pkg) || ["org.lineageos.jelly", "org.lineageos.etar", "org.lineageos.eleven"].includes(pkg);

// ---------------------------------------------------------------------------
// APKs copied in the file manager

/** `text/uri-list` or `x-special/gnome-copied-files` (or paths as text) → local paths. */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^["']|["']$/g, "");
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue;
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && line.startsWith("~/")) path = home + line.slice(1);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

export const isApk = (path: string) => /\.apk$/i.test(path);
export const basename = (path: string) => path.split("/").pop() ?? path;

/** waydroid's errors in words. */
export function waydroidError(message: string): string {
  const t = message.replace(/^waydroid exited with \d+:\s*/, "");
  if (/not initiali[sz]ed/i.test(t)) return "Waydroid isn't set up yet: run sudo waydroid init";
  if (/session is stopped|no session|WayDroid session is not/i.test(t)) return "The Waydroid session isn't running";
  if (/container.*(not running|failed)|Failed to start container|lxc/i.test(t)) {
    return "The Waydroid container isn't running: sudo systemctl start waydroid-container";
  }
  if (/INSTALL_FAILED_NO_MATCHING_ABIS/.test(t)) return "This APK isn't built for this computer's processor";
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/.test(t)) return "A newer version of this app is already installed";
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(t)) {
    return "An app with this name but another signature is installed: remove it first";
  }
  if (/INSTALL_PARSE_FAILED|not a valid|Failed to parse/i.test(t)) return "This file isn't a valid APK";
  const line = t.split("\n").map((l) => l.replace(/^\[\d\d:\d\d:\d\d\]\s*/, "").trim()).filter(Boolean).pop();
  return line || "waydroid failed";
}

// ---------------------------------------------------------------------------
// Running it outside the launcher

export const SESSION_UNIT = "backslash-waydroid-session";
export const UI_UNIT = "backslash-waydroid-ui";

/**
 * systemd-run arguments for a long-running waydroid command: it lives in its own unit, so it outlives the
 * launcher. The Wayland variables are passed along, as the user manager doesn't always have them.
 */
export function unitArgs(unit: string, description: string, argv: string[], env: Record<string, string>): string[] {
  return [
    "--user",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    `--description=${description}`,
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    ...argv,
  ];
}

export const playStoreUrl = (pkg: string) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`;
export const fdroidUrl = (pkg: string) => `https://f-droid.org/packages/${encodeURIComponent(pkg)}/`;

/** "RUNNING", "FROZEN"… in words. */
export function stateText(s: Status): string {
  if (s.uninitialized) return "Not set up";
  if (s.session === "RUNNING") return s.container === "FROZEN" ? "Running (idle)" : "Running";
  if (s.session === "STOPPED") return "Stopped";
  return "Unknown";
}
