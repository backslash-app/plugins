// TrueNAS (REST v2.0 with an API key), Synology DSM (SYNO.API.Auth session) and Unraid (GraphQL with an API key).

import { storage } from "@backslash/api";
import {
  healthAlerts,
  type Kind,
  kindFrom,
  type Nas,
  synologyError,
  synologyShares,
  synologyStorage,
  synologySystem,
  type SynoStorage,
  type SynoSystem,
  type SynoUtilization,
  TITLES,
  type TnAlert,
  type TnDataset,
  type TnPool,
  type TnSystemInfo,
  truenasAlerts,
  truenasDatasets,
  truenasPools,
  truenasShares,
  truenasSystem,
  type UnArray,
  type UnContainer,
  type UnNotification,
  unraidAlerts,
  unraidArray,
  unraidContainers,
  unraidUptime,
} from "./lib.ts";
import { checkBase, failureDetail, httpClient, request, SetupError } from "./net.ts";

export interface Backend {
  kind: Kind;
  base: string;
  /** The web interface. */
  admin: string;
  load(signal?: AbortSignal): Promise<Nas>;
  dismissAlert?(id: string): Promise<void>;
  setContainer?(id: string, running: boolean): Promise<void>;
}

interface Prefs {
  url?: string;
  kind?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  certificate?: string;
}

// ---------------------------------------------------------------------------
// TrueNAS

function truenas(base: string, apiKey: string, client?: Deno.HttpClient): Backend {
  if (!apiKey) throw new SetupError("Add a TrueNAS API key", "auth", base);

  async function api<T>(path: string, init: { body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const res = await request(`${base}/api/v2.0${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      signal: init.signal,
      client,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, "TrueNAS");
    if (res.status === 401 || res.status === 403) {
      throw new SetupError(
        base.startsWith("http:")
          ? "TrueNAS refused the API key: TrueNAS revokes keys sent over plain HTTP, use https:// and a new key"
          : "TrueNAS refused the API key: check it in Settings",
        "auth",
        base,
      );
    }
    if (res.status === 404 && path === "/system/info") {
      throw new SetupError("No TrueNAS REST API here (TrueNAS 26 and later only speak JSON-RPC)", "unknown", base);
    }
    if (!res.ok) throw new Error(`TrueNAS answered ${res.status} for ${path}: ${await failureDetail(res)}`);
    return await res.json() as T;
  }

  const soft = <T>(p: Promise<T>, fallback: T) =>
    p.catch((e) => {
      if (e instanceof SetupError) throw e;
      return fallback;
    });

  return {
    kind: "truenas",
    base,
    admin: base,
    async load(signal) {
      const [info, pools, datasets, alerts, smb, nfs] = await Promise.all([
        api<TnSystemInfo>("/system/info", { signal }),
        api<TnPool[]>("/pool", { signal }),
        soft(api<TnDataset[]>("/pool/dataset?extra.retrieve_children=true&extra.flat=true", { signal }), []),
        soft(api<TnAlert[]>("/alert/list", { signal }), []),
        soft(
          api<{ id: number; name?: string; path?: string; enabled?: boolean; comment?: string }[]>("/sharing/smb", {
            signal,
          }),
          [],
        ),
        soft(
          api<{ id: number; path?: string; paths?: string[]; enabled?: boolean; comment?: string }[]>(
            "/sharing/nfs",
            { signal },
          ),
          [],
        ),
      ]);
      const { volumes, disks } = truenasPools(pools);
      const own = truenasAlerts(alerts);
      return {
        kind: "truenas",
        system: truenasSystem(info),
        volumes,
        disks,
        datasets: truenasDatasets(datasets),
        shares: truenasShares(smb, nfs),
        // TrueNAS raises its own alerts for pools; derived ones only add "almost full".
        alerts: [...own, ...healthAlerts(volumes, []).filter((a) => a.key.startsWith("full:"))],
        containers: [],
      };
    },
    async dismissAlert(id) {
      await api("/alert/dismiss", { body: id });
    },
  };
}

// ---------------------------------------------------------------------------
// Synology DSM

function synology(base: string, account: string, password: string, client?: Deno.HttpClient): Backend {
  if (!account || !password) throw new SetupError("Add your Synology account and password", "auth", base);
  const key = `dsm-sid:${base}:${account}`;
  let sid: string | undefined;

  async function post(cgi: string, params: Record<string, string>, signal?: AbortSignal) {
    const res = await request(`${base}/webapi/${cgi}`, {
      method: "POST",
      signal,
      client,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }, "Synology");
    if (!res.ok) throw new Error(`Synology answered ${res.status}: ${await failureDetail(res)}`);
    return await res.json() as { success: boolean; data?: any; error?: { code?: number } };
  }

  async function login(): Promise<string> {
    const params = {
      api: "SYNO.API.Auth",
      version: "6",
      method: "login",
      account,
      passwd: password,
      session: "Backslash",
      format: "sid",
    };
    let r = await post("entry.cgi", params);
    // DSM 6 serves the sign-in from auth.cgi only.
    if (!r.success && (r.error?.code === 102 || r.error?.code === 103)) r = await post("auth.cgi", params);
    if (!r.success || !r.data?.sid) {
      throw new SetupError(synologyError(r.error?.code, true), "auth", base);
    }
    await storage.set(key, r.data.sid).catch(() => {});
    return r.data.sid;
  }

  let pending: Promise<string> | undefined;
  function session(): Promise<string> {
    if (sid) return Promise.resolve(sid);
    pending ??= (async () => {
      sid = await storage.get<string>(key).catch(() => undefined) ?? await login();
      return sid;
    })().finally(() => pending = undefined);
    return pending;
  }

  async function api<T>(
    api: string,
    method: string,
    version: number,
    extra: Record<string, string> = {},
    signal?: AbortSignal,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await session();
      const r = await post("entry.cgi", { api, method, version: String(version), ...extra, _sid: s }, signal);
      if (r.success) return r.data as T;
      const code = r.error?.code;
      if ((code === 106 || code === 107 || code === 119) && attempt === 0) {
        if (sid === s) {
          sid = undefined;
          await storage.delete(key).catch(() => {});
        }
        continue;
      }
      if (code === 105) throw new SetupError(synologyError(code), "permission", base);
      throw new Error(`${api}: ${synologyError(code)}`);
    }
    throw new SetupError("Synology rejected the session", "auth", base);
  }

  return {
    kind: "synology",
    base,
    admin: base,
    async load(signal) {
      const [store, info, usage, shares, network] = await Promise.all([
        api<SynoStorage>("SYNO.Storage.CGI.Storage", "load_info", 1, {}, signal),
        api<SynoSystem>("SYNO.Core.System", "info", 1, {}, signal).catch(() => undefined),
        api<SynoUtilization>("SYNO.Core.System.Utilization", "get", 1, {}, signal).catch(() => undefined),
        api<{ shares?: { name: string; vol_path?: string; desc?: string }[] }>(
          "SYNO.Core.Share",
          "list",
          1,
          {},
          signal,
        ).catch(() => undefined),
        api<{ server_name?: string }>("SYNO.Core.Network", "get", 1, {}, signal).catch(() => undefined),
      ]);
      const { volumes, disks } = synologyStorage(store);
      return {
        kind: "synology",
        system: synologySystem(info, usage, network?.server_name),
        volumes,
        disks,
        datasets: [],
        shares: synologyShares(shares?.shares ?? []),
        alerts: healthAlerts(volumes, disks),
        containers: [],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Unraid

const ARRAY_QUERY = `query {
  array {
    state
    capacity { kilobytes { free used total } }
    parities { id name device size status temp numErrors }
    disks { id name device size status temp numErrors fsSize fsFree fsUsed fsType }
    caches { id name device size status temp numErrors fsSize fsFree fsUsed fsType }
  }
}`;
const INFO_QUERY = `query { info { os { hostname uptime } cpu { brand } } vars { version name } }`;
const DOCKER_QUERY = `query { docker { containers { id names image state status autoStart } } }`;
const NOTIFICATIONS_QUERY = `query {
  notifications {
    list(filter: { type: UNREAD, offset: 0, limit: 25 }) { id title subject description importance timestamp }
  }
}`;

function unraid(base: string, apiKey: string, client?: Deno.HttpClient): Backend {
  if (!apiKey) throw new SetupError("Add an Unraid API key", "auth", base);

  async function gql<T>(query: string, signal?: AbortSignal): Promise<T> {
    const res = await request(`${base}/graphql`, {
      method: "POST",
      signal,
      client,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query }),
    }, "Unraid");
    if (res.status === 401 || res.status === 403) {
      throw new SetupError("Unraid refused the API key: check it in Settings", "auth", base);
    }
    if (res.status === 404) {
      throw new SetupError(
        "No Unraid API here: it comes with Unraid 7.2, or the Unraid Connect plugin",
        "unknown",
        base,
      );
    }
    const body = await res.json().catch(() => undefined) as { data?: T; errors?: { message?: string }[] } | undefined;
    if (body?.errors?.length) {
      const message = body.errors[0].message ?? "GraphQL error";
      if (/unauthori[sz]ed|forbidden|api key/i.test(message)) {
        throw new SetupError(`Unraid refused the API key: ${message}`, "auth", base);
      }
      if (!body.data) throw new Error(`Unraid: ${message}`);
    }
    if (!res.ok || !body?.data) throw new Error(`Unraid answered ${res.status}`);
    return body.data;
  }

  const soft = <T>(p: Promise<T>) =>
    p.catch((e) => {
      if (e instanceof SetupError) throw e;
      return undefined;
    });

  return {
    kind: "unraid",
    base,
    admin: `${base}/Dashboard`,
    async load(signal) {
      const [arr, info, docker, notifications] = await Promise.all([
        gql<{ array: UnArray }>(ARRAY_QUERY, signal),
        soft(
          gql<{ info?: { os?: { hostname?: string; uptime?: unknown } }; vars?: { version?: string; name?: string } }>(
            INFO_QUERY,
            signal,
          ),
        ),
        soft(gql<{ docker?: { containers?: UnContainer[] } }>(DOCKER_QUERY, signal)),
        soft(gql<{ notifications?: { list?: UnNotification[] } }>(NOTIFICATIONS_QUERY, signal)),
      ]);
      const { volumes, disks } = unraidArray(arr.array);
      return {
        kind: "unraid",
        system: {
          name: info?.vars?.name || info?.info?.os?.hostname || "Unraid",
          version: info?.vars?.version ? `Unraid ${info.vars.version}` : undefined,
          uptime: unraidUptime(info?.info?.os?.uptime),
        },
        volumes,
        disks,
        datasets: [],
        shares: [],
        alerts: [...unraidAlerts(notifications?.notifications?.list ?? []), ...healthAlerts(volumes, disks)],
        containers: unraidContainers(docker?.docker?.containers ?? []),
      };
    },
    async setContainer(id, running) {
      // An inline literal: the id's GraphQL type changed between API versions.
      await gql(`mutation { docker { ${running ? "start" : "stop"}(id: ${JSON.stringify(id)}) { id state } } }`);
    },
  };
}

// ---------------------------------------------------------------------------

/** TrueNAS answers /api/v2.0 (401 without a key); Unraid has /graphql. Remembered per address. */
async function detect(base: string, client?: Deno.HttpClient, signal?: AbortSignal): Promise<Kind> {
  const saved = await storage.get<Record<string, Kind>>("kinds").catch(() => undefined);
  if (saved?.[base]) return saved[base];
  let kind: Kind | undefined;
  const tn = await request(`${base}/api/v2.0/system/state`, { signal, client }, "the NAS");
  await tn.body?.cancel();
  if ((tn.status === 200 || tn.status === 401) && tn.headers.get("content-type")?.includes("json")) kind = "truenas";
  if (!kind) {
    const un = await request(`${base}/graphql`, {
      method: "POST",
      signal,
      client,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    }, "the NAS");
    await un.body?.cancel();
    if (un.status !== 404 && un.headers.get("content-type")?.includes("json")) kind = "unraid";
  }
  if (!kind) {
    throw new SetupError(`No TrueNAS or Unraid API at ${new URL(base).host}: set the kind`, "unknown", base);
  }
  await storage.set("kinds", { ...(saved ?? {}), [base]: kind }).catch(() => {});
  return kind;
}

export async function backend(preferences: Record<string, unknown>, signal?: AbortSignal): Promise<Backend> {
  const p = preferences as Prefs;
  const account = String(p.username ?? "").trim();
  const base = checkBase(p.url, "NAS").replace(/\/(ui|webman|Dashboard)(\/.*)?$/, "");
  const client = httpClient(p.certificate);
  const kind = kindFrom(p.kind, Boolean(account) && !String(p.apiKey ?? "").trim()) ??
    await detect(base, client, signal);
  const apiKey = String(p.apiKey ?? "").trim();
  switch (kind) {
    case "synology":
      return synology(base, account, String(p.password ?? ""), client);
    case "unraid":
      return unraid(base, apiKey, client);
    default:
      return truenas(base, apiKey, client);
  }
}

export { SetupError, TITLES };
