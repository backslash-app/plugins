// OpenWrt (ubus JSON-RPC with a session), UniFi Network (UniFi OS API key) and Freebox OS (app token, HMAC-SHA1 challenge).

import { storage } from "@backslash/api";
import {
  band,
  type Client,
  FREEBOX_APP,
  freeboxApiPath,
  freeboxClients,
  type FreeboxConnection,
  FreeboxError,
  type FreeboxHost,
  freeboxPassword,
  freeboxResult,
  freeboxRouter,
  type FreeboxSystem,
  type Kind,
  kindFrom,
  openwrtClients,
  openwrtRouter,
  rate,
  type Router,
  TITLES,
  UBUS_STATUS,
  type UbusBoard,
  type UbusHints,
  type UbusInfo,
  type UbusInterface,
  type UbusLeases,
  ubusResult,
  type UbusStation,
  unifiClients,
  unifiData,
  type UnifiDevice,
  type UnifiHealth,
  unifiRouter,
  type UnifiStation,
} from "./lib.ts";
import { checkBase, failureDetail, httpClient, request, SetupError } from "./net.ts";

export interface Backend {
  kind: Kind;
  base: string;
  /** The router's web interface. */
  admin: string;
  load(signal?: AbortSignal): Promise<{ router: Router; clients: Client[] }>;
  reboot(router: Router): Promise<void>;
  /** UniFi only: disconnect a Wi-Fi client so it reconnects, block or unblock it. */
  kick?(mac: string): Promise<void>;
  block?(mac: string, blocked: boolean): Promise<void>;
}

interface Prefs {
  url?: string;
  kind?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  site?: string;
  appToken?: string;
  certificate?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// OpenWrt

const NO_SESSION = "00000000000000000000000000000000";

function openwrt(base: string, username: string, password: string, client?: Deno.HttpClient): Backend {
  const key = `ubus:${base}:${username}`;
  let sid: string | undefined;

  async function rpc<T>(
    session: string,
    object: string,
    method: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) {
    const res = await request(`${base}/ubus`, {
      method: "POST",
      signal,
      client,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params: [session, object, method, args] }),
    }, "OpenWrt");
    if (res.status === 404) {
      throw new SetupError("No ubus at this address: install uhttpd-mod-ubus (it comes with LuCI)", "unknown", base);
    }
    if (!res.ok) throw new Error(`OpenWrt answered ${res.status}: ${await failureDetail(res)}`);
    return ubusResult<T>(await res.json());
  }

  async function login(): Promise<string> {
    if (!password) throw new SetupError("Add the password of the OpenWrt user", "auth", base);
    const r = await rpc<{ ubus_rpc_session: string }>(NO_SESSION, "session", "login", {
      username,
      password,
      timeout: 3600,
    });
    if (r.status !== 0 || !r.data?.ubus_rpc_session) {
      throw new SetupError(`OpenWrt rejected the user ${username} or its password`, "auth", base);
    }
    await storage.set(key, { sid: r.data.ubus_rpc_session, expires: Date.now() + 3500_000 }).catch(() => {});
    return r.data.ubus_rpc_session;
  }

  let pending: Promise<string> | undefined;
  function session(): Promise<string> {
    if (sid) return Promise.resolve(sid);
    pending ??= (async () => {
      const saved = await storage.get<{ sid: string; expires: number }>(key).catch(() => undefined);
      sid = saved && saved.expires > Date.now() ? saved.sid : await login();
      return sid;
    })().finally(() => pending = undefined);
    return pending;
  }

  async function call<T>(object: string, method: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await session();
      const r = await rpc<T>(s, object, method, args, signal);
      if (r.status === 6 && attempt === 0) {
        // Expired: sign in again once, shared by the parallel calls.
        if (sid === s) {
          sid = undefined;
          await storage.delete(key).catch(() => {});
        }
        continue;
      }
      if (r.status === 6) {
        throw new SetupError(`${username} may not call ${object} ${method} (rpcd ACL)`, "permission", base);
      }
      if (r.status !== 0) throw new Error(`ubus ${object} ${method}: ${r.error ?? UBUS_STATUS[r.status] ?? r.status}`);
      return r.data as T;
    }
    throw new SetupError("OpenWrt rejected the session", "auth", base);
  }

  const optional = <T>(p: Promise<T>) =>
    p.catch((e) => {
      if (e instanceof SetupError && e.kind !== "permission") throw e;
      return undefined;
    });

  async function stations(signal?: AbortSignal) {
    const devices = await optional(call<{ devices: string[] }>("iwinfo", "devices", {}, signal));
    return await Promise.all((devices?.devices ?? []).map(async (device) => {
      const [info, assoc] = await Promise.all([
        optional(call<{ ssid?: string; frequency?: number }>("iwinfo", "info", { device }, signal)),
        optional(call<{ results: UbusStation[] }>("iwinfo", "assoclist", { device }, signal)),
      ]);
      return { device, ssid: info?.ssid, band: band(info?.frequency), list: assoc?.results ?? [] };
    }));
  }

  async function counters(device: string | undefined, signal?: AbortSignal) {
    if (!device) return undefined;
    const s = await optional(
      call<{ statistics?: { rx_bytes?: number; tx_bytes?: number } }>(
        "network.device",
        "status",
        { name: device },
        signal,
      ),
    );
    return s?.statistics ? { at: performance.now(), rx: s.statistics.rx_bytes, tx: s.statistics.tx_bytes } : undefined;
  }

  return {
    kind: "openwrt",
    base,
    admin: `${base}/cgi-bin/luci/`,
    async load(signal) {
      const wan = await optional(call<UbusInterface>("network.interface.wan", "status", {}, signal));
      const device = wan?.l3_device ?? wan?.device;
      const before = counters(device, signal);
      const [board, info, leases, hints, aps, first] = await Promise.all([
        optional(call<UbusBoard>("system", "board", {}, signal)),
        optional(call<UbusInfo>("system", "info", {}, signal)),
        optional(call<UbusLeases>("luci-rpc", "getDHCPLeases", {}, signal)),
        optional(call<UbusHints>("luci-rpc", "getHostHints", {}, signal)),
        stations(signal),
        before,
      ]);
      // A second sample of the WAN counters for the throughput.
      const wait = Math.max(0, 1000 - (performance.now() - (first?.at ?? 0)));
      await sleep(wait);
      const second = await counters(device, signal);
      const seconds = first && second ? (second.at - first.at) / 1000 : 0;
      return {
        router: openwrtRouter(board, info, wan, {
          down: rate(first?.rx, second?.rx, seconds),
          up: rate(first?.tx, second?.tx, seconds),
          totalDown: second?.rx,
          totalUp: second?.tx,
        }),
        clients: openwrtClients(aps, leases, hints),
      };
    },
    async reboot() {
      await call("system", "reboot");
    },
  };
}

// ---------------------------------------------------------------------------
// UniFi Network on UniFi OS

function unifi(base: string, apiKey: string, site: string, client?: Deno.HttpClient): Backend {
  if (!apiKey) throw new SetupError("Add a UniFi API key", "auth", base);
  const root = `${base}/proxy/network/api/s/${encodeURIComponent(site)}`;

  async function api<T>(path: string, init: { body?: unknown; signal?: AbortSignal } = {}): Promise<T[]> {
    const res = await request(`${root}${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      signal: init.signal,
      client,
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, "UniFi");
    if (res.status === 401 || res.status === 403) {
      throw new SetupError("UniFi refused the API key: check it in Settings", "auth", base);
    }
    if (res.status === 404) {
      throw new SetupError(
        site === "default"
          ? "No UniFi Network here: Backslash needs a UniFi OS console (UDM, UCG, Cloud Key) or UniFi OS Server"
          : `UniFi has no site “${site}”`,
        "unknown",
        base,
      );
    }
    if (!res.ok) throw new Error(`UniFi answered ${res.status}: ${await failureDetail(res)}`);
    return unifiData<T>(await res.json());
  }

  return {
    kind: "unifi",
    base,
    admin: `${base}/network/${encodeURIComponent(site)}/dashboard`,
    async load(signal) {
      const [stations, health, devices] = await Promise.all([
        api<UnifiStation>("/stat/sta", { signal }),
        api<UnifiHealth>("/stat/health", { signal }).catch(() => []),
        api<UnifiDevice>("/stat/device", { signal }).catch(() => []),
      ]);
      return { router: unifiRouter(health, devices), clients: unifiClients(stations) };
    },
    async reboot(router) {
      if (!router.gatewayMac) throw new Error("UniFi didn't say which device is the gateway");
      await api("/cmd/devmgr", { body: { cmd: "restart", mac: router.gatewayMac } });
    },
    async kick(mac) {
      await api("/cmd/stamgr", { body: { cmd: "kick-sta", mac } });
    },
    async block(mac, blocked) {
      await api("/cmd/stamgr", { body: { cmd: blocked ? "block-sta" : "unblock-sta", mac } });
    },
  };
}

// ---------------------------------------------------------------------------
// Freebox OS

/** `/api_version` gives the API path; it never changes for a box, so it is remembered. */
export async function freeboxApi(base: string, client?: Deno.HttpClient, signal?: AbortSignal): Promise<string> {
  const saved = await storage.get<Record<string, string>>("freebox-api").catch(() => undefined);
  if (saved?.[base]) return `${base}${saved[base]}`;
  const res = await request(`${base}/api_version`, { signal, client }, "the Freebox");
  if (!res.ok) throw new SetupError(`No Freebox OS at ${new URL(base).host}`, "unknown", base);
  const info = await res.json().catch(() => undefined);
  if (!info?.api_version) throw new SetupError(`No Freebox OS at ${new URL(base).host}`, "unknown", base);
  const path = freeboxApiPath(info);
  await storage.set("freebox-api", { ...(saved ?? {}), [base]: path }).catch(() => {});
  return `${base}${path}`;
}

/** Freebox OS JSON, `{ success, result }`, errors as {@link FreeboxError}. */
export async function freeboxCall<T>(
  url: string,
  init: { method?: string; body?: unknown; session?: string; signal?: AbortSignal; client?: Deno.HttpClient },
): Promise<T> {
  const res = await request(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    signal: init.signal,
    client: init.client,
    headers: {
      ...(init.session ? { "X-Fbx-App-Auth": init.session } : {}),
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, "the Freebox");
  const body = await res.json().catch(() => undefined);
  if (!body) throw new Error(`The Freebox answered ${res.status}`);
  return freeboxResult<T>(body);
}

function freebox(base: string, appToken: string, client?: Deno.HttpClient): Backend {
  if (!appToken) throw new SetupError("Pair Backslash with the Freebox first", "auth", base);
  const key = `freebox-session:${base}`;
  let token: string | undefined;

  async function login(api: string): Promise<string> {
    const { challenge } = await freeboxCall<{ challenge: string }>(`${api}/login/`, { client });
    try {
      const s = await freeboxCall<{ session_token: string }>(`${api}/login/session/`, {
        client,
        body: {
          app_id: FREEBOX_APP.app_id,
          app_version: FREEBOX_APP.app_version,
          password: await freeboxPassword(appToken, challenge),
        },
      });
      await storage.set(key, s.session_token).catch(() => {});
      return s.session_token;
    } catch (e) {
      if (e instanceof FreeboxError) {
        if (e.code === "pending_token") {
          throw new SetupError("Accept Backslash on the Freebox's screen first", "auth", base);
        }
        if (e.code === "invalid_token" || e.code === "invalid_request" || e.code === "denied_from_external_ip") {
          throw new SetupError("The Freebox doesn't know this app token: pair again", "auth", base);
        }
      }
      throw e;
    }
  }

  async function call<T>(path: string, init: { body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const api = await freeboxApi(base, client, init.signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      token ??= await storage.get<string>(key).catch(() => undefined) ?? await login(api);
      try {
        return await freeboxCall<T>(`${api}${path}`, { ...init, session: token, client });
      } catch (e) {
        if (
          e instanceof FreeboxError && (e.code === "auth_required" || e.code === "invalid_session") && attempt === 0
        ) {
          token = undefined;
          await storage.delete(key).catch(() => {});
          continue;
        }
        if (e instanceof FreeboxError && e.code === "insufficient_rights") {
          throw new SetupError(
            "Backslash may not do that: in Freebox OS, give it the rights it needs (Settings → Access management → Applications)",
            "permission",
            base,
          );
        }
        throw e;
      }
    }
    throw new SetupError("The Freebox rejected the session", "auth", base);
  }

  return {
    kind: "freebox",
    base,
    admin: base,
    async load(signal) {
      const [hosts, connection, system] = await Promise.all([
        call<FreeboxHost[]>("/lan/browser/pub/", { signal }),
        call<FreeboxConnection>("/connection/", { signal }).catch(() => undefined),
        call<FreeboxSystem>("/system/", { signal }).catch(() => undefined),
      ]);
      return { router: freeboxRouter(connection, system), clients: freeboxClients(hosts ?? []) };
    },
    async reboot() {
      await call("/system/reboot/", { body: {} });
    },
  };
}

// ---------------------------------------------------------------------------

/** UniFi only speaks HTTPS; the others usually answer on plain HTTP on the local network. */
export function backend(preferences: Record<string, unknown>): Backend {
  const p = preferences as Prefs;
  const guess = kindFrom(p.kind, String(p.url ?? ""));
  const base = checkBase(p.url, "router", guess === "unifi" ? "https" : "http");
  const kind = guess ??
    (String(p.apiKey ?? "").trim() ? "unifi" : String(p.appToken ?? "").trim() ? "freebox" : "openwrt");
  const client = httpClient(p.certificate);
  switch (kind) {
    case "unifi":
      return unifi(base, String(p.apiKey ?? "").trim(), String(p.site ?? "").trim() || "default", client);
    case "freebox":
      return freebox(base, String(p.appToken ?? "").trim(), client);
    default:
      return openwrt(base, String(p.username ?? "").trim() || "root", String(p.password ?? ""), client);
  }
}

export { SetupError, TITLES };
