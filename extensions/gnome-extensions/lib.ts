// Parsing for gnome-extensions, gsettings and the extensions.gnome.org API.

export const EGO = "https://extensions.gnome.org";

export interface Extension {
  uuid: string;
  name: string;
  description: string;
  path: string;
  url?: string;
  author?: string;
  /** `57`, or a version name with its number: `2.1 (12)`. */
  version?: string;
  enabled: boolean;
  /** `ACTIVE`, `INACTIVE`, `ERROR`, `OUT OF DATE`, `INITIALIZED`… (older Shells: `ENABLED`, `DISABLED`). */
  state: string;
  /** Installed in the home folder (removable), not by the system. */
  user: boolean;
  hasPrefs?: boolean;
  hasUpdate?: boolean;
}

const FIELDS: Record<string, keyof Extension> = {
  Name: "name",
  Description: "description",
  Path: "path",
  URL: "url",
  "Original author": "author",
  Version: "version",
  Enabled: "enabled",
  State: "state",
};

/**
 * `gnome-extensions list --details` (with LC_ALL=C): the UUID on its own line,
 * then indented `Key: value` lines; descriptions may span several lines.
 */
export function parseDetails(text: string, home: string): Extension[] {
  const lines = text.split("\n");
  const out: Extension[] = [];
  let cur: Record<string, string> | undefined;
  let last: string | undefined;
  const flush = () => {
    if (!cur) return;
    const state = (cur.state ?? "").trim().toUpperCase();
    const enabled = cur.enabled !== undefined ? /^yes$/i.test(cur.enabled.trim()) : state === "ENABLED";
    const path = cur.path?.trim() ?? "";
    out.push({
      uuid: cur.uuid,
      name: cur.name?.trim() || cur.uuid,
      description: (cur.description ?? "").replace(/\s+$/, ""),
      path,
      url: cur.url?.trim() || undefined,
      author: cur.author?.trim() || undefined,
      version: cur.version?.trim() || undefined,
      enabled,
      state,
      user: !!home && path.startsWith(`${home}/.local/share/gnome-shell/extensions/`),
    });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S+$/.test(line) && (lines[i + 1] ?? "").startsWith("  Name: ")) {
      flush();
      cur = { uuid: line.trim() };
      last = undefined;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^ {2}([A-Za-z ]+?): ?(.*)$/);
    if (m && FIELDS[m[1]]) {
      last = FIELDS[m[1]];
      cur[last] = m[2];
      continue;
    }
    if (last === "description") cur.description += `\n${line}`;
  }
  flush();
  return out;
}

/** UUIDs of `gnome-extensions list` (one per line), e.g. with `--prefs` or `--updates`. */
export function parseUuids(text: string): Set<string> {
  return new Set(text.split("\n").map((l) => l.trim()).filter(Boolean));
}

export type Look = "on" | "off" | "error" | "outdated" | "busy";

export function look(e: Extension): Look {
  if (e.state === "ERROR") return "error";
  if (e.state === "OUT OF DATE") return "outdated";
  if (/DOWNLOADING|ACTIVATING|DEACTIVATING|ENABLING|DISABLING/.test(e.state)) return "busy";
  return e.enabled ? "on" : "off";
}

export const STATE_LABELS: Record<Look, string> = {
  on: "Enabled",
  off: "Disabled",
  error: "Error",
  outdated: "Out of date",
  busy: "Working…",
};

/** Users first, then enabled ones, then by name. */
export function sortExtensions(list: Extension[]): Extension[] {
  const rank = (e: Extension) => look(e) === "error" || look(e) === "outdated" ? 0 : e.enabled ? 1 : 2;
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/** `GNOME Shell 46.2` → `46`; `GNOME Shell 3.38.4` → `3.38`. */
export function parseShellVersion(text: string): string | undefined {
  const m = text.match(/GNOME Shell (\d+)(?:\.(\d+))?/);
  if (!m) return undefined;
  return Number(m[1]) >= 40 ? m[1] : `${m[1]}.${m[2] ?? "0"}`;
}

/** `gsettings get` of a boolean: `true` / `false`. */
export const parseBool = (text: string) => text.trim() === "true";

/** `gdbus call` of InstallRemoteExtension: `('successful',)` or `('cancelled',)`. */
export function parseInstallResult(text: string): "successful" | "cancelled" | string {
  return text.match(/\('([^']*)',?\)/)?.[1] ?? text.trim();
}

export function shellError(stderr: string): string {
  if (/Failed to connect to GNOME Shell|org\.gnome\.Shell.*(not provided|ServiceUnknown)/i.test(stderr)) {
    return "GNOME Shell isn't answering: this works in a GNOME session";
  }
  if (/doesn.t exist|does not exist/i.test(stderr)) return "This extension isn't installed anymore";
  if (/can.t be uninstalled|cannot be uninstalled|system extension/i.test(stderr)) {
    return "System extensions are removed with your package manager";
  }
  return stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "gnome-extensions failed";
}

/** Whether `XDG_CURRENT_DESKTOP` (`ubuntu:GNOME`, `GNOME-Classic:GNOME`) is a GNOME session. */
export const isGnomeDesktop = (desktop: string | undefined) =>
  (desktop ?? "").split(":").some((d) => /^gnome/i.test(d));

// --- extensions.gnome.org ----------------------------------------------------------------

export interface Remote {
  uuid: string;
  name: string;
  creator?: string;
  description: string;
  pk: number;
  link: string;
  icon?: string;
  screenshot?: string;
  downloads?: number;
  url?: string;
  /** Shell versions the extension supports. */
  shells: string[];
  /** The version for this Shell, if any. */
  version?: string;
}

interface RemoteJson {
  uuid: string;
  name: string;
  creator?: string;
  description?: string;
  pk: number;
  link: string;
  icon?: string;
  screenshot?: string | null;
  downloads?: number;
  url?: string;
  shell_version_map?: Record<string, { pk: number; version: number | string; version_name?: string }>;
}

const absolute = (path?: string | null) => !path ? undefined : path.startsWith("http") ? path : `${EGO}${path}`;

/** Sorts Shell versions: `3.38` < `40` < `46`. */
export function compareShell(a: string, b: string): number {
  const [a1, a2] = a.split(".").map(Number), [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || (a2 ?? 0) - (b2 ?? 0);
}

export function parseRemote(r: RemoteJson, shell?: string): Remote {
  const map = r.shell_version_map ?? {};
  const v = shell ? map[shell] : undefined;
  return {
    uuid: r.uuid,
    name: r.name,
    creator: r.creator,
    description: r.description ?? "",
    pk: r.pk,
    link: `${EGO}${r.link}`,
    icon: r.icon && !/plugin\.png$/.test(r.icon) ? absolute(r.icon) : undefined,
    screenshot: absolute(r.screenshot),
    downloads: r.downloads,
    url: r.url || undefined,
    shells: Object.keys(map).sort(compareShell),
    version: v ? (v.version_name ? `${v.version_name} (${v.version})` : String(v.version)) : undefined,
  };
}

/** `/extension-query/?search=…`. */
export function parseQuery(json: string, shell?: string): { extensions: Remote[]; total: number; pages: number } {
  const data = JSON.parse(json) as { extensions?: RemoteJson[]; total?: number; numpages?: number };
  return {
    extensions: (data.extensions ?? []).map((r) => parseRemote(r, shell)),
    total: data.total ?? 0,
    pages: data.numpages ?? 1,
  };
}

export function queryUrl(query: string, shell?: string, page = 1): string {
  const p = new URLSearchParams({
    ...(query.trim() ? { search: query.trim() } : { sort: "popularity" }),
    ...(shell ? { shell_version: shell } : {}),
    page: String(page),
  });
  return `${EGO}/extension-query/?${p}`;
}

export const infoUrl = (uuid: string) => `${EGO}/extension-info/?${new URLSearchParams({ uuid })}`;

/** `12345` → `12.3k`. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** EGO descriptions are plain text: keep paragraphs, escape what markdown would eat. */
export function descriptionMarkdown(text: string): string {
  return text.trim().replace(/([\\`*_<>])/g, "\\$1").replace(/\n(?!\n)/g, "  \n");
}

/** The gdbus call that asks GNOME Shell to download and install an extension (it shows a dialog). */
export function installArgs(uuid: string): string[] {
  return [
    "call",
    "--session",
    "--timeout",
    "300",
    "--dest",
    "org.gnome.Shell.Extensions",
    "--object-path",
    "/org/gnome/Shell/Extensions",
    "--method",
    "org.gnome.Shell.Extensions.InstallRemoteExtension",
    // GVariant text: a quoted string.
    `'${uuid.replace(/['\\]/g, "")}'`,
  ];
}
