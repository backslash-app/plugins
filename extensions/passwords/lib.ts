// Password manager CLIs: parsing what `pass`, `bw`, `op` and `keepassxc-cli`
// print. Only metadata (names, usernames, URLs) is kept; secrets are read
// on demand, copied, and never stored or displayed.

export type BackendId = "pass" | "bitwarden" | "1password" | "keepassxc";

export interface Backend {
  id: BackendId;
  name: string;
  program: string;
  tint: "orange" | "blue" | "teal" | "green";
}

export const BACKENDS: Backend[] = [
  { id: "pass", name: "pass", program: "pass", tint: "orange" },
  { id: "bitwarden", name: "Bitwarden", program: "bw", tint: "blue" },
  { id: "1password", name: "1Password", program: "op", tint: "teal" },
  { id: "keepassxc", name: "KeePassXC", program: "keepassxc-cli", tint: "green" },
];

/** One entry of any manager, without its secrets. */
export interface Entry {
  backend: BackendId;
  /** What the backend needs to fetch the secrets: path, id, or `op://vault/item`. */
  ref: string;
  title: string;
  username?: string;
  url?: string;
  /** Folder, vault or group. */
  folder?: string;
  /** Known to have a one-time code; undefined when only decrypting would tell. */
  totp?: boolean;
  category?: string;
  favorite?: boolean;
  modified?: number;
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// pass (https://www.passwordstore.org)

/** Entry names from the store's `.gpg` files (relative paths). */
export function passEntries(files: { path: string; modified?: number }[]): Entry[] {
  return files
    .filter((f) => f.path.endsWith(".gpg") && !f.path.split("/").some((s) => s.startsWith(".")))
    .map((f) => {
      const name = f.path.replace(/\.gpg$/, "");
      const parts = name.split("/");
      const title = parts.pop()!;
      const folder = parts.join("/") || undefined;
      // "github.com/ada": the entry is the username, its folder the site.
      const site = parts.length && /\.[a-z]{2,}$/i.test(parts[parts.length - 1]) ? parts[parts.length - 1] : undefined;
      const isSite = /\.[a-z]{2,}$/i.test(title);
      return {
        backend: "pass" as const,
        ref: name,
        title,
        folder,
        username: site && !isSite ? title : undefined,
        url: isSite ? title : site,
        modified: f.modified,
      };
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

/** Entry names from `pass ls` (a `tree` drawing), when the store is elsewhere. */
export function parsePassTree(output: string): string[] {
  // "│   ├── name": 4 characters per level, then the branch; tree may use no-break spaces.
  // deno-lint-ignore no-control-regex
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u00a0/g, " ").split("\n");
  const LINE = /^((?:[│|` ] {3})*)[├└|`][─-]{2} (.+)$/;
  const parsed = lines.slice(1).map((l) => LINE.exec(l)).filter((m) => m !== null)
    .map((m) => ({ depth: m[1].length / 4, name: m[2].trim() }));
  const out: string[] = [];
  const stack: string[] = [];
  parsed.forEach(({ depth, name }, i) => {
    stack.length = depth;
    stack.push(name);
    const isFolder = (parsed[i + 1]?.depth ?? -1) > depth;
    if (!isFolder) out.push(stack.join("/"));
  });
  return out;
}

export interface PassContent {
  password: string;
  username?: string;
  url?: string;
  otp: boolean;
}

/** `pass show`: the password, then `key: value` lines (login, user, url, otpauth://…). */
export function parsePassShow(text: string, entry?: Entry): PassContent {
  const [password = "", ...rest] = text.replace(/\r/g, "").split("\n");
  const field = (...names: string[]) => {
    for (const line of rest) {
      const m = /^([\w -]+?)\s*:\s*(.+)$/.exec(line);
      if (m && names.includes(m[1].toLowerCase())) return m[2].trim();
    }
    return undefined;
  };
  return {
    password,
    username: field("login", "user", "username", "email", "e-mail") ?? entry?.username,
    url: field("url", "website", "site") ?? entry?.url,
    otp: rest.some((l) => l.trim().startsWith("otpauth://")),
  };
}

// ---------------------------------------------------------------------------
// Bitwarden CLI (https://bitwarden.com/help/cli/)

export type BwStatus = "unauthenticated" | "locked" | "unlocked" | "unknown";

export function parseBwStatus(json: string): { status: BwStatus; email?: string } {
  try {
    const s = JSON.parse(json);
    const status = ["unauthenticated", "locked", "unlocked"].includes(s.status) ? s.status : "unknown";
    return { status, email: s.userEmail ?? undefined };
  } catch {
    return { status: "unknown" };
  }
}

interface BwItem {
  id: string;
  name: string;
  type: number;
  folderId?: string | null;
  favorite?: boolean;
  revisionDate?: string;
  login?: { username?: string | null; password?: string | null; totp?: string | null; uris?: { uri?: string }[] };
}

/** Login items of `bw list items`; passwords and TOTP seeds are dropped here. */
export function parseBwItems(json: string, folders: Record<string, string> = {}): Entry[] {
  const items = JSON.parse(json) as BwItem[];
  return items
    .filter((i) => i.type === 1)
    .map((i) => ({
      backend: "bitwarden" as const,
      ref: i.id,
      title: i.name,
      username: i.login?.username || undefined,
      url: i.login?.uris?.find((u) => u.uri)?.uri,
      folder: i.folderId ? folders[i.folderId] : undefined,
      totp: !!i.login?.totp,
      favorite: !!i.favorite,
      modified: i.revisionDate ? Date.parse(i.revisionDate) : undefined,
    }));
}

export function parseBwFolders(json: string): Record<string, string> {
  try {
    const folders = JSON.parse(json) as { id: string | null; name: string }[];
    return Object.fromEntries(folders.filter((f) => f.id).map((f) => [f.id!, f.name]));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 1Password CLI (https://developer.1password.com/docs/cli/)

interface OpItem {
  id: string;
  title: string;
  category: string;
  favorite?: boolean;
  updated_at?: string;
  additional_information?: string;
  vault?: { id: string; name: string };
  urls?: { href: string; primary?: boolean }[];
}

/** `op item list --format json`; `ref` is `op://<vault id>/<item id>` for `op read`. */
export function parseOpItems(json: string): Entry[] {
  const items = JSON.parse(json) as OpItem[];
  return items
    .filter((i) => i.category !== "DOCUMENT")
    .map((i) => {
      const login = i.category === "LOGIN";
      return {
        backend: "1password" as const,
        ref: `op://${i.vault?.id ?? ""}/${i.id}`,
        title: i.title,
        username: login && i.additional_information ? i.additional_information : undefined,
        url: (i.urls?.find((u) => u.primary) ?? i.urls?.[0])?.href,
        folder: i.vault?.name,
        category: i.category.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
        favorite: !!i.favorite,
        modified: i.updated_at ? Date.parse(i.updated_at) : undefined,
      };
    });
}

export function opSignedOut(message: string): boolean {
  return /not currently signed in|no accounts configured|sign ?in|authorization|session expired|unauthorized/i.test(
    message,
  );
}

// ---------------------------------------------------------------------------
// KeePassXC CLI

/** `keepassxc-cli ls -R -f`: one path per line, groups end with "/". The recycle bin is left out. */
export function parseKeepassList(output: string): Entry[] {
  return output.split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.endsWith("/") && !/^\[empty\]$/i.test(l.trim()))
    .filter((l) => !/^(Recycle Bin|Corbeille|Papierkorb)\//.test(l))
    .map((path) => {
      const parts = path.split("/");
      const title = parts.pop()!;
      return { backend: "keepassxc" as const, ref: path, title, folder: parts.join("/") || undefined };
    });
}

/** `keepassxc-cli show` prints `Key: value` lines (with `-a` only the values). */
export function parseKeepassShow(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const m = /^(\w[\w ]*?):\s?(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function keepassWrongPassword(message: string): boolean {
  return /invalid credentials|wrong key|HMAC mismatch|error while reading the database/i.test(message);
}

// ---------------------------------------------------------------------------

/** Expands `~/` with the home folder. */
export const expandHome = (p: string, home: string) => (p.startsWith("~/") ? `${home}${p.slice(1)}` : p);

/** Removes anything that looks like a secret from a CLI error before showing it. */
export function safeError(program: string, stderr: string): string {
  const first = stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "failed";
  const clean = first.replace(/(password|session|token)[=:]\s*\S+/gi, "$1=…").slice(0, 200);
  return `${program}: ${clean}`;
}

/** Favorites first, then by name; entries of several managers interleaved alphabetically. */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) =>
    Number(!!b.favorite) - Number(!!a.favorite) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
}
