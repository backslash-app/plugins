// The three clients behind one interface: Transmission RPC (with its
// session-id handshake), qBittorrent Web API v2 (cookie login) and Deluge
// Web JSON-RPC (cookie login, then connect the web UI to a daemon).

import { storage } from "@backslash/api";
import {
  type ClientKind,
  clientKind,
  CLIENTS,
  cookieFrom,
  DELUGE_FIELDS,
  type DelugeTorrent,
  fromDeluge,
  fromQbit,
  fromTransmission,
  guessKind,
  isAllowedHost,
  isLocalHost,
  normalizeUrl,
  type QbitTorrent,
  sessionIdFrom,
  type Torrent,
  TRANSMISSION_FIELDS,
  type TransmissionTorrent,
} from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly kind: "url" | "auth" | "host" | "down" | "daemon", readonly base?: string) {
    super(message);
  }
}

export interface Priority {
  value: string;
  title: string;
  icon: string;
}

export interface Client {
  kind: ClientKind;
  title: string;
  base: string;
  /** The web UI, to open in the browser. */
  webUrl: string;
  /** Downloads are on this computer, so their folders can be opened. */
  local: boolean;
  list(signal?: AbortSignal): Promise<Torrent[]>;
  pause(ids: string[]): Promise<void>;
  resume(ids: string[]): Promise<void>;
  remove(ids: string[], withData: boolean): Promise<void>;
  add(link: string): Promise<string | undefined>;
  magnet(t: Torrent): Promise<string | undefined>;
  priorities: Priority[];
  setPriority(ids: string[], value: string): Promise<void>;
  /** Undefined when the client has no alternative speed limits (Deluge). */
  altSpeed?: { get(signal?: AbortSignal): Promise<boolean>; set(on: boolean): Promise<void> };
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function call(base: string, title: string, url: string, init: RequestInit & { signal?: AbortSignal }) {
  const timeout = AbortSignal.timeout(15_000);
  try {
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(base).hostname} is outside the networks this extension may reach`, "host", base);
    }
    throw new SetupError(`Can't reach ${title} at ${new URL(base).host}: ${describe(e)}`, "down", base);
  }
}

const basic = (user: string, password: string) =>
  `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`;

// ---------------------------------------------------------------------------
// Transmission

const transmissionSessions = new Map<string, string>();

function transmission(base: string, user: string, password: string): Client {
  const url = `${base}/transmission/rpc`;
  const title = "Transmission";
  async function rpc<T>(method: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await call(base, title, url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(transmissionSessions.has(base) ? { "X-Transmission-Session-Id": transmissionSessions.get(base)! } : {}),
          ...(user || password ? { Authorization: basic(user, password) } : {}),
        },
        body: JSON.stringify({ method, arguments: args }),
      });
      const session = sessionIdFrom(res.status, res.headers);
      if (session) {
        await res.body?.cancel();
        transmissionSessions.set(base, session);
        continue;
      }
      if (res.status === 401) {
        throw new SetupError(
          user ? "Transmission refused the user name or password" : "Transmission asks for a user name and password",
          "auth",
          base,
        );
      }
      if (res.status === 403) {
        throw new SetupError(
          "Transmission refused this computer: add its address to rpc-whitelist in settings.json",
          "auth",
          base,
        );
      }
      if (!res.ok) throw new Error(`Transmission answered ${res.status} ${res.statusText}`);
      const body = await res.json() as { result?: string; arguments?: T };
      if (body.result && body.result !== "success") throw new Error(`Transmission: ${body.result}`);
      return body.arguments as T;
    }
    throw new Error("Transmission keeps changing its session id");
  }
  const toIds = (ids: string[]) => ids.map(Number);
  return {
    kind: "transmission",
    title,
    base,
    webUrl: `${base}/transmission/web/`,
    local: isLocalHost(new URL(base).hostname),
    async list(signal) {
      const r = await rpc<{ torrents: TransmissionTorrent[] }>("torrent-get", { fields: TRANSMISSION_FIELDS }, signal);
      return (r.torrents ?? []).map(fromTransmission);
    },
    async pause(ids) {
      await rpc("torrent-stop", { ids: toIds(ids) });
    },
    async resume(ids) {
      await rpc("torrent-start", { ids: toIds(ids) });
    },
    async remove(ids, withData) {
      await rpc("torrent-remove", { ids: toIds(ids), "delete-local-data": withData });
    },
    async add(link) {
      const r = await rpc<{ "torrent-added"?: { name?: string }; "torrent-duplicate"?: { name?: string } }>(
        "torrent-add",
        { filename: link },
      );
      if (r["torrent-duplicate"]) throw new Error(`Already in Transmission: ${r["torrent-duplicate"].name ?? link}`);
      return r["torrent-added"]?.name;
    },
    magnet: (t) => Promise.resolve(t.magnet),
    priorities: [
      { value: "1", title: "High", icon: "bs-priority-high" },
      { value: "0", title: "Normal", icon: "bs-priority-medium" },
      { value: "-1", title: "Low", icon: "bs-priority-low" },
    ],
    async setPriority(ids, value) {
      await rpc("torrent-set", { ids: toIds(ids), bandwidthPriority: Number(value) });
    },
    altSpeed: {
      async get(signal) {
        const r = await rpc<{ "alt-speed-enabled"?: boolean }>(
          "session-get",
          { fields: ["alt-speed-enabled"] },
          signal,
        );
        return !!r["alt-speed-enabled"];
      },
      async set(on) {
        await rpc("session-set", { "alt-speed-enabled": on });
      },
    },
  };
}

// ---------------------------------------------------------------------------
// qBittorrent

const qbitCookies = new Map<string, string>();

function qbittorrent(base: string, user: string, password: string): Client {
  const title = "qBittorrent";
  // One session per address and account: changing the password in Settings signs in again.
  const session = `${base}\n${user}\n${password}`;
  // The Web UI's CSRF protection wants a Referer or Origin from the same host.
  const origin = { Referer: `${base}/`, Origin: new URL(base).origin };

  async function login(): Promise<void> {
    const res = await call(base, title, `${base}/api/v2/auth/login`, {
      method: "POST",
      headers: { ...origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: user, password }).toString(),
    });
    const text = (await res.text()).trim();
    if (res.status === 403) {
      throw new SetupError(
        "qBittorrent banned this computer after too many failed logins: wait, then retry",
        "auth",
        base,
      );
    }
    if (!res.ok || /^Fails/i.test(text)) {
      throw new SetupError("qBittorrent refused the user name or password", "auth", base);
    }
    const cookie = cookieFrom(res.headers.get("set-cookie"));
    if (cookie) qbitCookies.set(session, cookie);
  }

  async function request(
    path: string,
    o: { form?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 0 && !qbitCookies.has(session) && (user || password)) await login();
      const res = await call(base, title, `${base}/api/v2${path}`, {
        method: o.form ? "POST" : "GET",
        signal: o.signal,
        headers: {
          ...origin,
          ...(qbitCookies.has(session) ? { Cookie: qbitCookies.get(session)! } : {}),
          ...(o.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: o.form ? new URLSearchParams(o.form).toString() : undefined,
      });
      if (res.status === 403 || res.status === 401) {
        await res.body?.cancel();
        qbitCookies.delete(session);
        if (attempt === 0 && (user || password)) {
          await login();
          continue;
        }
        throw new SetupError(
          user ? "qBittorrent refused the user name or password" : "qBittorrent asks for a user name and password",
          "auth",
          base,
        );
      }
      return res;
    }
    throw new SetupError("qBittorrent refused the user name or password", "auth", base);
  }

  async function ok(path: string, form: Record<string, string>): Promise<Response> {
    const res = await request(path, { form });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).trim().slice(0, 160);
      throw new Error(`qBittorrent answered ${res.status}${text ? `: ${text}` : ""}`);
    }
    return res;
  }

  /** v5 renamed pause/resume to stop/start (Web API 2.11). */
  async function either(paths: [string, string], form: Record<string, string>) {
    const res = await request(paths[0], { form });
    if (res.status === 404) {
      await res.body?.cancel();
      await ok(paths[1], form);
    } else if (!res.ok) {
      throw new Error(`qBittorrent answered ${res.status}`);
    } else await res.body?.cancel();
  }

  const hashes = (ids: string[]) => ({ hashes: ids.join("|") });
  return {
    kind: "qbittorrent",
    title,
    base,
    webUrl: `${base}/`,
    local: isLocalHost(new URL(base).hostname),
    async list(signal) {
      const res = await request("/torrents/info", { signal });
      if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
      return ((await res.json()) as QbitTorrent[]).map(fromQbit);
    },
    pause: (ids) => either(["/torrents/stop", "/torrents/pause"], hashes(ids)),
    resume: (ids) => either(["/torrents/start", "/torrents/resume"], hashes(ids)),
    async remove(ids, withData) {
      await (await ok("/torrents/delete", { ...hashes(ids), deleteFiles: String(withData) })).body?.cancel();
    },
    async add(link) {
      const res = await ok("/torrents/add", { urls: link });
      const text = (await res.text()).trim();
      if (/^Fails/i.test(text)) throw new Error("qBittorrent couldn't add it (already there, or not a torrent)");
      return undefined;
    },
    magnet: (t) => Promise.resolve(t.magnet),
    priorities: [
      { value: "topPrio", title: "Top of Queue", icon: "bs-arrow-up" },
      { value: "increasePrio", title: "Move Up", icon: "bs-chevron-right" },
      { value: "decreasePrio", title: "Move Down", icon: "bs-chevron-right" },
      { value: "bottomPrio", title: "Bottom of Queue", icon: "bs-arrow-down" },
    ],
    async setPriority(ids, value) {
      const res = await request(`/torrents/${value}`, { form: hashes(ids) });
      if (res.status === 409) throw new Error("Turn on torrent queueing in qBittorrent's options to reorder the queue");
      if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
      await res.body?.cancel();
    },
    altSpeed: {
      async get(signal) {
        const res = await request("/transfer/speedLimitsMode", { signal });
        return (await res.text()).trim() === "1";
      },
      async set(on) {
        const res = await request("/transfer/speedLimitsMode");
        const current = (await res.text()).trim() === "1";
        if (current !== on) await (await ok("/transfer/toggleSpeedLimitsMode", {})).body?.cancel();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Deluge

const delugeCookies = new Map<string, string>();
let delugeId = 0;

function deluge(base: string, password: string): Client {
  const title = "Deluge";
  async function raw<T>(method: string, params: unknown[], signal?: AbortSignal) {
    const res = await call(base, title, `${base}/json`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(delugeCookies.has(base) ? { Cookie: delugeCookies.get(base)! } : {}),
      },
      body: JSON.stringify({ method, params, id: ++delugeId }),
    });
    if (!res.ok) throw new Error(`Deluge answered ${res.status} ${res.statusText}`);
    const cookie = cookieFrom(res.headers.get("set-cookie"));
    if (cookie) delugeCookies.set(base, cookie);
    return await res.json() as { result: T; error: { message: string; code: number } | null };
  }
  let connected = false;
  async function login(signal?: AbortSignal) {
    const r = await raw<boolean>("auth.login", [password], signal);
    if (!r.result) throw new SetupError("Deluge refused the password", "auth", base);
  }
  async function connect(signal?: AbortSignal) {
    if (connected) return;
    const c = await raw<boolean>("web.connected", [], signal);
    if (c.error?.code === 1) {
      await login(signal);
      return connect(signal);
    }
    if (!c.result) {
      const hosts = await raw<[string, string, number, string?][]>("web.get_hosts", [], signal);
      const first = hosts.result?.[0];
      if (!first) {
        throw new SetupError(
          "Deluge's web UI isn't connected to a daemon: add one in its Connection Manager",
          "daemon",
          base,
        );
      }
      const r = await raw<unknown>("web.connect", [first[0]], signal);
      if (r.error) throw new SetupError(`Deluge can't connect to its daemon: ${r.error.message}`, "daemon", base);
    }
    connected = true;
  }
  async function rpc<T>(method: string, params: unknown[] = [], signal?: AbortSignal): Promise<T> {
    if (!delugeCookies.has(base)) await login(signal);
    await connect(signal);
    let r = await raw<T>(method, params, signal);
    if (r.error?.code === 1) {
      await login(signal);
      connected = false;
      await connect(signal);
      r = await raw<T>(method, params, signal);
    }
    if (r.error) throw new Error(`Deluge: ${r.error.message}`);
    return r.result;
  }
  /** Deluge 2 takes lists in pause_torrents; 1.3 took them in pause_torrent. */
  async function plural(methods: [string, string], ids: string[]) {
    try {
      await rpc(methods[0], [ids]);
    } catch (e) {
      if (!/unknown method|not found/i.test(describe(e))) throw e;
      await rpc(methods[1], [ids]);
    }
  }
  return {
    kind: "deluge",
    title,
    base,
    webUrl: `${base}/`,
    local: isLocalHost(new URL(base).hostname),
    async list(signal) {
      const r = await rpc<{ torrents: Record<string, DelugeTorrent> | null }>(
        "web.update_ui",
        [DELUGE_FIELDS, {}],
        signal,
      );
      return Object.entries(r.torrents ?? {}).map(([hash, t]) => fromDeluge(hash, t));
    },
    pause: (ids) => plural(["core.pause_torrents", "core.pause_torrent"], ids),
    resume: (ids) => plural(["core.resume_torrents", "core.resume_torrent"], ids),
    async remove(ids, withData) {
      for (const id of ids) await rpc("core.remove_torrent", [id, withData]);
    },
    async add(link) {
      const id = link.startsWith("magnet:")
        ? await rpc<string | null>("core.add_torrent_magnet", [link, {}])
        : await rpc<string | null>("core.add_torrent_url", [link, {}]);
      if (!id) throw new Error("Deluge couldn't add it (already there, or not a torrent)");
      return undefined;
    },
    async magnet(t) {
      try {
        return await rpc<string>("core.get_magnet_uri", [t.id]) || undefined;
      } catch {
        return undefined;
      }
    },
    priorities: [
      { value: "queue_top", title: "Top of Queue", icon: "bs-arrow-up" },
      { value: "queue_up", title: "Move Up", icon: "bs-chevron-right" },
      { value: "queue_down", title: "Move Down", icon: "bs-chevron-right" },
      { value: "queue_bottom", title: "Bottom of Queue", icon: "bs-arrow-down" },
    ],
    async setPriority(ids, value) {
      await rpc(`core.${value}`, [ids]);
    },
  };
}

// ---------------------------------------------------------------------------
// Choosing the client

export interface Prefs {
  client?: string;
  url?: string;
  username?: string;
  password?: string;
}

function make(kind: ClientKind, base: string, p: Prefs): Client {
  const user = String(p.username ?? "").trim();
  const password = String(p.password ?? "");
  if (kind === "transmission") return transmission(base, user, password);
  if (kind === "qbittorrent") return qbittorrent(base, user, password);
  return deluge(base, password);
}

/** Probes an address for the three APIs, without credentials. */
async function probe(base: string, signal?: AbortSignal): Promise<ClientKind | undefined> {
  const timeout = AbortSignal.timeout(3000);
  const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const tries: [ClientKind, () => Promise<boolean>][] = [
    ["transmission", async () => {
      const res = await fetch(`${base}/transmission/rpc`, { method: "POST", body: "{}", signal: s });
      await res.body?.cancel();
      return res.status === 409 || !!res.headers.get("x-transmission-session-id") ||
        (res.status === 401 && /transmission/i.test(res.headers.get("www-authenticate") ?? ""));
    }],
    ["qbittorrent", async () => {
      const res = await fetch(`${base}/api/v2/app/webapiVersion`, { signal: s, headers: { Referer: `${base}/` } });
      const text = (await res.text()).trim();
      return (res.ok && /^\d+\.\d+/.test(text)) || (res.status === 403 && /forbidden/i.test(text));
    }],
    ["deluge", async () => {
      const res = await fetch(`${base}/json`, {
        method: "POST",
        signal: s,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "web.connected", params: [], id: 0 }),
      });
      const text = await res.text();
      return /"id"\s*:\s*0/.test(text) && /"(result|error)"/.test(text);
    }],
  ];
  const found = await Promise.all(tries.map(async ([kind, t]) => (await t().catch(() => false)) ? kind : undefined));
  return found.find(Boolean);
}

let cached: { key: string; client: Client } | undefined;

export async function client(p: Prefs, signal?: AbortSignal): Promise<Client> {
  const key = JSON.stringify([p.client, p.url, p.username, p.password]);
  if (cached?.key === key) return cached.client;
  let kind = clientKind(p.client);
  let base = normalizeUrl(p.url);
  if (base) {
    let host: string;
    try {
      host = new URL(base).hostname;
    } catch {
      throw new SetupError(`“${p.url}” is not an address`, "url");
    }
    if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, "host");
  }
  if (!kind) {
    const remembered = await storage.get<{ base: string; kind: ClientKind }>("detected").catch(() => undefined);
    if (remembered && (remembered.base === base || (!base && remembered.base))) {
      kind = remembered.kind;
      base ||= remembered.base;
    } else if (base) {
      kind = await probe(base, signal) ?? guessKind(p.url);
    } else {
      for (const k of Object.keys(CLIENTS) as ClientKind[]) {
        if (await probe(CLIENTS[k].defaultUrl, signal) === k) {
          kind = k;
          base = CLIENTS[k].defaultUrl;
          break;
        }
      }
    }
    if (!kind) {
      throw new SetupError(
        base
          ? `No Transmission, qBittorrent or Deluge answers at ${new URL(base).host}`
          : "No torrent client found on this computer (Transmission on 9091, qBittorrent on 8080, Deluge on 8112)",
        base ? "down" : "url",
        base || undefined,
      );
    }
    await storage.set("detected", { base, kind }).catch(() => {});
  }
  base ||= CLIENTS[kind].defaultUrl;
  const c = make(kind, base, p);
  cached = { key, client: c };
  return c;
}

/** Forget the detected client, e.g. after an error, so the next run probes again. */
export async function forgetDetected(): Promise<void> {
  cached = undefined;
  await storage.delete("detected").catch(() => {});
}
