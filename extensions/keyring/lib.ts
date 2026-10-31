// Secret Service items: busctl JSON, gdbus GVariant text and secret-tool output
// parsed into plain values, plus how to show them. No I/O here.

export const SERVICE = "org.freedesktop.secrets";
export const SERVICE_PATH = "/org/freedesktop/secrets";
export const IFACE = {
  service: "org.freedesktop.Secret.Service",
  collection: "org.freedesktop.Secret.Collection",
  item: "org.freedesktop.Secret.Item",
  prompt: "org.freedesktop.Secret.Prompt",
  properties: "org.freedesktop.DBus.Properties",
} as const;

export interface Collection {
  path: string;
  label: string;
  locked: boolean;
  items: string[];
  created?: number;
  modified?: number;
  /** The `default` alias points to it: where apps store new secrets. */
  isDefault?: boolean;
}

export interface SecretItem {
  path: string;
  collection: string;
  label: string;
  attributes: Record<string, string>;
  locked: boolean;
  /** Unix seconds. */
  created?: number;
  modified?: number;
}

/** `/org/freedesktop/secrets/collection/login/12` → `/org/freedesktop/secrets/collection/login`. */
export function collectionOf(itemPath: string): string {
  return itemPath.replace(/\/[^/]+$/, "");
}

/** The last element of an object path, unescaped: `_32021_20Passwords` → `2021 Passwords`. */
export function pathName(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/_([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------------------------------------------------------------------------
// busctl --json=short

interface Typed {
  type: string;
  data: unknown;
}

/**
 * The out values of `busctl --json=short call …`: `{"type":"aoo","data":[[…],"/"]}`
 * → `[[…], "/"]`. Variants (`{"type":"v","data":[{"type":"s","data":"x"}]}`) are unwrapped.
 */
export function parseBusctl(json: string): unknown[] {
  const v = JSON.parse(json || "null") as Typed | null;
  if (!v || !Array.isArray(v.data)) return [];
  if (v.type === "v") return v.data.length ? [unwrapTyped(v.data[0])] : [];
  return v.data;
}

function unwrapTyped(v: unknown): unknown {
  return v && typeof v === "object" && "data" in v && "type" in v ? (v as Typed).data : v;
}

/** `a{sv}` from busctl: every variant's `{ type, data }` → data. */
export function unwrapVariants(dict: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!dict || typeof dict !== "object") return out;
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) out[k] = unwrapTyped(v);
  return out;
}

// ---------------------------------------------------------------------------
// gdbus: GVariant text format

/**
 * Parses what `gdbus call` prints, e.g.
 * `({'Label': <'Login'>, 'Items': <[objectpath '/a/1', '/a/2']>, 'Created': <uint64 1690000000>},)`,
 * into plain values: tuples and arrays → arrays, dictionaries → objects,
 * variants unwrapped, numbers as numbers.
 */
export function parseGVariant(text: string): unknown {
  let i = 0;
  const s = text.trim();
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (what: string): never => {
    throw new Error(`Unexpected gdbus output (${what} at ${i}): ${s.slice(0, 120)}`);
  };

  function str(): string {
    const q = s[i++];
    let out = "";
    while (i < s.length && s[i] !== q) {
      if (s[i] === "\\") {
        const c = s[++i];
        i++;
        if (c === "n") out += "\n";
        else if (c === "t") out += "\t";
        else if (c === "r") out += "\r";
        else if (c === "u" || c === "x") {
          const len = c === "u" ? 4 : 2;
          out += String.fromCharCode(parseInt(s.slice(i, i + len), 16));
          i += len;
        } else if (c === "U") {
          out += String.fromCodePoint(parseInt(s.slice(i, i + 8), 16));
          i += 8;
        } else out += c;
      } else out += s[i++];
    }
    if (s[i] !== q) fail("unterminated string");
    i++;
    return out;
  }

  function value(): unknown {
    ws();
    const c = s[i];
    if (c === "(" || c === "[") {
      const close = c === "(" ? ")" : "]";
      i++;
      const arr: unknown[] = [];
      ws();
      while (s[i] !== close) {
        arr.push(value());
        ws();
        if (s[i] === ",") i++;
        ws();
        if (i >= s.length) fail("unterminated list");
      }
      i++;
      return arr;
    }
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      while (s[i] !== "}") {
        const k = value();
        ws();
        if (s[i] !== ":") fail("expected ':'");
        i++;
        obj[String(k)] = value();
        ws();
        if (s[i] === ",") i++;
        ws();
        if (i >= s.length) fail("unterminated dictionary");
      }
      i++;
      return obj;
    }
    if (c === "<") {
      i++;
      const v = value();
      ws();
      if (s[i] !== ">") fail("expected '>'");
      i++;
      return v;
    }
    if (c === "'" || c === '"') return str();
    if (c === "@") {
      // A type annotation for an empty container: @a{ss} {}, @ao []
      while (i < s.length && !/\s/.test(s[i])) i++;
      return value();
    }
    const word = /^[A-Za-z_][\w]*/.exec(s.slice(i))?.[0];
    if (word) {
      i += word.length;
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "nothing") return null;
      // Type prefixes: uint64 12, objectpath '/x', byte 0x41, just <v>…
      return value();
    }
    const num = /^[-+]?(0x[0-9a-f]+|\d+(\.\d+)?(e[-+]?\d+)?)/i.exec(s.slice(i))?.[0];
    if (num) {
      i += num.length;
      return Number(num);
    }
    return fail("unknown token");
  }

  const v = value();
  return v;
}

/** gdbus call output → its out values (the tuple). */
export function parseGdbus(text: string): unknown[] {
  const v = parseGVariant(text);
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// Properties → records

const num = (v: unknown) => typeof v === "number" && v > 0 ? v : undefined;

export function toCollection(path: string, props: Record<string, unknown>, defaultPath?: string): Collection {
  return {
    path,
    label: typeof props.Label === "string" && props.Label ? props.Label : pathName(path),
    locked: props.Locked === true,
    items: Array.isArray(props.Items) ? props.Items.map(String) : [],
    created: num(props.Created),
    modified: num(props.Modified),
    isDefault: defaultPath ? defaultPath === path : undefined,
  };
}

export function toItem(path: string, props: Record<string, unknown>): SecretItem {
  const attrs: Record<string, string> = {};
  if (props.Attributes && typeof props.Attributes === "object") {
    for (const [k, v] of Object.entries(props.Attributes as Record<string, unknown>)) attrs[k] = String(v);
  }
  return {
    path,
    collection: collectionOf(path),
    label: typeof props.Label === "string" ? props.Label : "",
    attributes: attrs,
    locked: props.Locked === true,
    created: num(props.Created),
    modified: num(props.Modified),
  };
}

// ---------------------------------------------------------------------------
// secret-tool

export interface SearchResult {
  path: string;
  label?: string;
  secret?: string;
  attributes: Record<string, string>;
}

const KNOWN_LINE = /^(label|secret|created|modified|schema|attribute\.[^=]+?) = ?(.*)$/;

/**
 * `secret-tool search --all --unlock k v` prints one block per item:
 *
 * ```
 * [/org/freedesktop/secrets/collection/login/3]
 * label = GitHub
 * secret = hunter2
 * created = 2024-03-02 10:11:12
 * modified = 2024-03-02 10:11:12
 * schema = org.gnome.keyring.NetworkPassword
 * attribute.user = ada
 * ```
 *
 * A secret spanning several lines keeps them, up to the next known line.
 */
export function parseSearch(text: string): SearchResult[] {
  const out: SearchResult[] = [];
  let cur: SearchResult | undefined;
  let inSecret = false;
  for (const line of text.split("\n")) {
    const head = /^\[(\/[^\]]+)\]$/.exec(line);
    if (head) {
      cur = { path: head[1], attributes: {} };
      out.push(cur);
      inSecret = false;
      continue;
    }
    if (!cur) continue;
    const m = KNOWN_LINE.exec(line);
    if (m) {
      inSecret = false;
      const [, key, value] = m;
      if (key === "label") cur.label = value;
      else if (key === "secret") {
        cur.secret = value;
        inSecret = true;
      } else if (key === "schema") cur.attributes["xdg:schema"] = value;
      else if (key.startsWith("attribute.")) cur.attributes[key.slice(10)] = value;
    } else if (inSecret) cur.secret += `\n${line}`;
  }
  // A trailing newline after a multi-line secret is the block separator, not the secret.
  for (const r of out) if (r.secret !== undefined) r.secret = r.secret.replace(/\n+$/, "");
  return out;
}

/** `k1 v1 k2 v2…` for secret-tool, xdg:schema included (it matches like any attribute). */
export function attributeArgs(attrs: Record<string, string>): string[] {
  return Object.entries(attrs).flatMap(([k, v]) => [k, v]);
}

/**
 * Whether `secret-tool lookup` with these attributes can only find this
 * item: no other item has all of them (lookup returns the first match).
 */
export function lookupIsUnique(item: SecretItem, all: SecretItem[]): boolean {
  const entries = Object.entries(item.attributes);
  if (!entries.length) return false;
  return !all.some((o) => o.path !== item.path && entries.every(([k, v]) => o.attributes[k] === v));
}

// ---------------------------------------------------------------------------
// Presentation

export interface SchemaInfo {
  name: string;
  /** Kept by an app for itself rather than typed by the user. */
  app?: boolean;
}

const SCHEMAS: Record<string, SchemaInfo> = {
  "org.gnome.keyring.Note": { name: "Note" },
  "org.gnome.keyring.NetworkPassword": { name: "Network password" },
  "org.gnome.keyring.ChainedKeyring": { name: "Keyring password", app: true },
  "org.gnome.keyring.EncryptionKey": { name: "Encryption key", app: true },
  "org.gnome.keyring.PkStorage": { name: "Key storage", app: true },
  "org.freedesktop.NetworkManager.connection": { name: "Network connection" },
  "org.gnome.OnlineAccounts": { name: "Online account", app: true },
  "org.gnome.Evolution.Data.Source": { name: "Evolution account" },
  "org.gnome.Geary": { name: "Geary account" },
  "org.gnome.Polari.Identify": { name: "IRC identity" },
  "org.gnome.Fractal": { name: "Fractal session", app: true },
  "org.gnome.RemoteDesktop.RdpCredentials": { name: "Remote desktop", app: false },
  "org.remmina.Password": { name: "Remmina password" },
  "org.epiphany.FormPassword": { name: "Web password" },
  "chrome_libsecret_os_crypt_password_v1": { name: "Browser Safe Storage", app: true },
  "chrome_libsecret_os_crypt_password_v2": { name: "Browser Safe Storage", app: true },
  "chrome_libsecret_password_schema": { name: "Chrome password" },
  "org.freedesktop.Secret.Generic": { name: "Generic secret" },
  "org.kde.KWallet.Password": { name: "Password" },
  "org.kde.KWallet.Map": { name: "Map" },
  "org.kde.KWallet.Stream": { name: "Binary data" },
  "org.qt.keychain": { name: "Qt Keychain", app: true },
  "com.github.git-credential-libsecret": { name: "Git credential" },
};

/** What kind of secret: from `xdg:schema`, or guessed from the attributes. */
export function schemaInfo(item: Pick<SecretItem, "attributes" | "label">): SchemaInfo {
  const schema = item.attributes["xdg:schema"];
  if (schema && SCHEMAS[schema]) return SCHEMAS[schema];
  const a = item.attributes;
  if (/safe storage/i.test(item.label) || a.application === "chrome" || a.application === "chromium") {
    return { name: "Browser Safe Storage", app: true };
  }
  if ("git" in a || a.protocol === "https" && "server" in a && /git/i.test(item.label)) {
    return { name: "Git credential" };
  }
  if ("goa-identity" in a) return { name: "Online account", app: true };
  if ("setting-name" in a || "connection-uuid" in a) return { name: "Network connection" };
  if (schema) return { name: schema.replace(/^.*\./, "").replace(/([a-z])([A-Z])/g, "$1 $2") };
  if ("server" in a || "host" in a || "url" in a || "origin_url" in a) return { name: "Password" };
  return { name: "Secret" };
}

const USER_KEYS = ["username", "user", "login", "account", "email", "username_value", "id"];
const PLACE_KEYS = ["server", "host", "domain", "service", "origin_url", "url", "signon_realm", "action_url", "uri"];

/** The user name an item is for, when its attributes say. */
export function userOf(attrs: Record<string, string>): string | undefined {
  for (const k of USER_KEYS) if (attrs[k]) return attrs[k];
  return undefined;
}

/** Where it is used: a server, URL or service. */
export function placeOf(attrs: Record<string, string>): string | undefined {
  for (const k of PLACE_KEYS) if (attrs[k]) return attrs[k];
  if (attrs.ssid || attrs["connection-uuid"]) return attrs.ssid ?? attrs["setting-name"];
  return undefined;
}

/** The row's subtitle: `ada @ github.com`, `github.com`, or the first attributes. */
export function summary(item: Pick<SecretItem, "attributes">): string {
  const user = userOf(item.attributes);
  const place = placeOf(item.attributes);
  if (user && place && user !== place) return `${user} @ ${place}`;
  if (user || place) return (user ?? place)!;
  return Object.entries(item.attributes)
    .filter(([k]) => k !== "xdg:schema")
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
}

/** A title for an item with an empty label. */
export function titleOf(item: SecretItem): string {
  return item.label.trim() || placeOf(item.attributes) || pathName(item.path);
}

/** Attributes as a markdown table, the schema first. */
export function attributeTable(attrs: Record<string, string>): string {
  const rows = Object.entries(attrs).sort(([a], [b]) =>
    Number(b === "xdg:schema") - Number(a === "xdg:schema") || a.localeCompare(b)
  );
  if (!rows.length) return "_No attributes: secret-tool can't find this item, use Seahorse or KWalletManager._";
  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    "| Attribute | Value |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| \`${cell(k)}\` | ${cell(v) || "—"} |`),
  ].join("\n");
}

/** 1700000000 → "14 Nov 2023". */
export function formatDate(seconds?: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A short age for the row: "today", "3d", "2mo", "1y". */
export function age(seconds: number, now = Date.now()): string {
  const days = Math.floor((now - seconds * 1000) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Errors from busctl / gdbus / secret-tool, said for people. */
export function explain(message: string): string {
  if (/ServiceUnknown|was not provided by any \.service|name is not activatable|not activatable/i.test(message)) {
    return "No keyring is running: start GNOME Keyring, KWallet or KeePassXC (with Secret Service integration)";
  }
  if (/IsLocked|is locked/i.test(message)) return "This keyring is locked: unlock it first";
  if (/dismissed|cancel/i.test(message)) return "The keyring prompt was dismissed";
  if (/NoSuchObject|No such object|UnknownObject/i.test(message)) {
    return "This item no longer exists: it was changed or deleted elsewhere";
  }
  if (/DBUS_SESSION_BUS_ADDRESS|Failed to connect to bus|session bus/i.test(message)) {
    return "No D-Bus session bus: the keyring can only be reached from your desktop session";
  }
  return message.replace(/^\w[\w-]* exited with \d+: /, "");
}
