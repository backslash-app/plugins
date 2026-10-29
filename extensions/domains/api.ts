// The four registrars' APIs behind one interface: list domains, read records,
// create, change and delete them. Porkbun and Gandi speak JSON, OVHcloud wants
// signed requests, Namecheap answers in XML.

import {
  type DnsRecord,
  type Domain,
  gandiName,
  gandiValue,
  mapLimit,
  namecheapErrors,
  namecheapHostParams,
  ovhEndpoint,
  ovhRecordBody,
  ovhSignature,
  parseGandiDomains,
  parseGandiRecords,
  parseNamecheapDomains,
  parseNamecheapHosts,
  parseOvhRecord,
  parseOvhService,
  parsePorkbunDomains,
  parsePorkbunRecords,
  porkbunRecordBody,
  type RecordSpec,
  REGISTRAR_NAMES,
  type RegistrarId,
  rrsetValues,
  splitDomain,
} from "./lib.ts";

/** The hosts of `[permissions] net` (kept equal by a test). */
export const HOSTS = [
  "api.porkbun.com",
  "api.gandi.net",
  "eu.api.ovh.com",
  "ca.api.ovh.com",
  "api.us.ovhcloud.com",
  "api.namecheap.com",
];

export class AuthError extends Error {
  constructor(readonly registrar: RegistrarId, message?: string) {
    super(message ?? `${REGISTRAR_NAMES[registrar]} refused the credentials: check them in Settings`);
  }
}

export interface Registrar {
  id: RegistrarId;
  /** The registrar's lowest TTL. */
  minTtl: number;
  domains(signal?: AbortSignal): Promise<Domain[]>;
  records(domain: Domain, signal?: AbortSignal): Promise<DnsRecord[]>;
  /** `all` is the domain's records as shown: some APIs work on whole record sets. */
  create(domain: Domain, spec: RecordSpec, all: DnsRecord[]): Promise<void>;
  update(domain: Domain, record: DnsRecord, spec: RecordSpec, all: DnsRecord[]): Promise<void>;
  remove(domain: Domain, record: DnsRecord, all: DnsRecord[]): Promise<void>;
}

const str = (v: unknown) => String(v ?? "").trim();

async function request(
  id: RegistrarId,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<{ res: Response; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new Error(`Cannot reach ${REGISTRAR_NAMES[id]}: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text();
  if (res.status === 429) throw new Error(`${REGISTRAR_NAMES[id]} rate limit reached: try again in a minute`);
  return { res, text };
}

const json = (text: string): any => {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Porkbun

function porkbun(apikey: string, secretapikey: string): Registrar {
  const base = "https://api.porkbun.com/api/json/v3";
  const call = async (path: string, body: Record<string, unknown> = {}, signal?: AbortSignal) => {
    const { res, text } = await request("porkbun", `${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ apikey, secretapikey, ...body }),
      signal,
    });
    const data = json(text);
    if (data?.status === "SUCCESS") return data;
    const message = String(data?.message ?? `Porkbun answered ${res.status}`);
    if (res.status === 401 || /invalid api key|api key|secret/i.test(message)) throw new AuthError("porkbun");
    if (/not opted in to api access|api access/i.test(message)) {
      throw new Error(`${message}. Turn on API Access for this domain in Porkbun's domain management`);
    }
    throw new Error(message);
  };
  return {
    id: "porkbun",
    minTtl: 600,
    async domains(signal) {
      const out: Domain[] = [];
      for (let start = 0; start < 10_000; start += 1000) {
        const page = parsePorkbunDomains(await call("/domain/listAll", { start, includeLabels: "no" }, signal));
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    },
    async records(d, signal) {
      return parsePorkbunRecords(await call(`/dns/retrieve/${encodeURIComponent(d.name)}`, {}, signal), d.name);
    },
    async create(d, spec) {
      await call(`/dns/create/${encodeURIComponent(d.name)}`, porkbunRecordBody(spec));
    },
    async update(d, r, spec) {
      await call(`/dns/edit/${encodeURIComponent(d.name)}/${encodeURIComponent(r.id)}`, porkbunRecordBody(spec));
    },
    async remove(d, r) {
      await call(`/dns/delete/${encodeURIComponent(d.name)}/${encodeURIComponent(r.id)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Gandi

function gandi(token: string): Registrar {
  const base = "https://api.gandi.net/v5";
  const call = async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
    const { res, text } = await request("gandi", `${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const data = json(text);
    if (res.status === 401) throw new AuthError("gandi");
    if (!res.ok) {
      const detail = data?.errors?.map((e: any) => e.description ?? e.name).filter(Boolean).join("; ");
      const message = detail || data?.message || `Gandi answered ${res.status}`;
      if (res.status === 403) {
        throw new Error(`Gandi denied it: ${message}. The token needs the Domain and LiveDNS scopes`);
      }
      if (res.status === 404 && path.startsWith("/livedns")) {
        throw new Error("This domain is not on Gandi LiveDNS: its records are managed elsewhere");
      }
      throw new Error(message);
    }
    return data;
  };
  const rrset = (d: Domain, name: string, type: string) =>
    `/livedns/domains/${encodeURIComponent(d.name)}/records/${encodeURIComponent(gandiName(name))}/${type}`;
  /** Puts the values of an rrset, or deletes it when none is left. */
  const write = async (d: Domain, name: string, type: string, values: string[], ttl?: number) => {
    if (!values.length) return void await call("DELETE", rrset(d, name, type));
    await call("PUT", rrset(d, name, type), {
      rrset_values: values,
      ...(ttl ? { rrset_ttl: Math.max(300, ttl) } : {}),
    });
  };
  const add = async (d: Domain, spec: RecordSpec, all: DnsRecord[]) => {
    const same = all.filter((r) => r.name === spec.name && r.type === spec.type);
    if (same.length) {
      return await write(d, spec.name, spec.type, [...same.map(gandiValue), gandiValue(spec)], spec.ttl ?? same[0].ttl);
    }
    await call("POST", `/livedns/domains/${encodeURIComponent(d.name)}/records`, {
      rrset_name: gandiName(spec.name),
      rrset_type: spec.type,
      rrset_values: [gandiValue(spec)],
      ...(spec.ttl ? { rrset_ttl: Math.max(300, spec.ttl) } : {}),
    });
  };
  return {
    id: "gandi",
    minTtl: 300,
    async domains(signal) {
      const out: Domain[] = [];
      for (let page = 1; page <= 50; page++) {
        const items = await call("GET", `/domain/domains?per_page=100&page=${page}`, undefined, signal);
        out.push(...parseGandiDomains(items));
        if (!Array.isArray(items) || items.length < 100) break;
      }
      return out;
    },
    async records(d, signal) {
      return parseGandiRecords(
        await call("GET", `/livedns/domains/${encodeURIComponent(d.name)}/records`, undefined, signal),
        d.name,
      );
    },
    create: add,
    async update(d, r, spec, all) {
      if (r.name === spec.name && r.type === spec.type) {
        return await write(d, r.name, r.type, rrsetValues(all, r, spec), spec.ttl ?? r.ttl);
      }
      // Renamed or retyped: out of its rrset, into the other one.
      await write(d, r.name, r.type, rrsetValues(all, r), r.ttl);
      await add(d, spec, all.filter((x) => x.id !== r.id));
    },
    async remove(d, r, all) {
      await write(d, r.name, r.type, rrsetValues(all, r), r.ttl);
    },
  };
}

// ---------------------------------------------------------------------------
// OVHcloud

function ovh(endpoint: string, appKey: string, appSecret: string, consumerKey: string): Registrar {
  let delta: Promise<number> | undefined;
  /** The API's clock minus ours: signatures carry the server's time. */
  const timeDelta = () =>
    delta ??= fetch(`${endpoint}/auth/time`).then((r) => r.text()).then(
      (t) => Number(t) - Math.floor(Date.now() / 1000) || 0,
      () => 0,
    );
  const call = async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
    const url = `${endpoint}${path}`;
    const payload = body === undefined ? "" : JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000) + await timeDelta();
    const { res, text } = await request("ovh", url, {
      method,
      headers: {
        "X-Ovh-Application": appKey,
        "X-Ovh-Consumer": consumerKey,
        "X-Ovh-Timestamp": String(timestamp),
        "X-Ovh-Signature": await ovhSignature(appSecret, consumerKey, method, url, payload, timestamp),
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload || undefined,
      signal,
    });
    const data = json(text);
    if (!res.ok) {
      const message = String(data?.message ?? `OVHcloud answered ${res.status}`);
      if (res.status === 401 || /invalid (credential|signature|application)|not been granted|expired/i.test(message)) {
        throw new AuthError("ovh", `OVHcloud refused the keys: ${message}`);
      }
      if (res.status === 403) {
        throw new Error(
          `OVHcloud denied it: ${message}. The consumer key needs GET, POST, PUT and DELETE on /domain/*`,
        );
      }
      throw new Error(message);
    }
    return data;
  };
  const zone = (d: Domain) => `/domain/zone/${encodeURIComponent(d.name)}`;
  const apply = (d: Domain) => call("POST", `${zone(d)}/refresh`);
  return {
    id: "ovh",
    minTtl: 60,
    async domains(signal) {
      const [names, zones] = await Promise.all([
        call("GET", "/domain", undefined, signal) as Promise<string[]>,
        (call("GET", "/domain/zone", undefined, signal) as Promise<string[]>).catch(() => [] as string[]),
      ]);
      const hasZone = new Set((zones ?? []).map((z) => z.toLowerCase()));
      return await mapLimit(names ?? [], 8, async (name) => {
        const info = await call("GET", `/domain/${encodeURIComponent(name)}/serviceInfos`, undefined, signal)
          .catch(() => undefined);
        return parseOvhService(name, info, hasZone);
      });
    },
    async records(d, signal) {
      const ids: number[] = await call("GET", `${zone(d)}/record`, undefined, signal);
      const records = await mapLimit(ids ?? [], 10, (id) => call("GET", `${zone(d)}/record/${id}`, undefined, signal));
      return records.map((r) => parseOvhRecord(r, d.name));
    },
    async create(d, spec) {
      await call("POST", `${zone(d)}/record`, ovhRecordBody(spec, true));
      await apply(d);
    },
    async update(d, r, spec) {
      if (r.type !== spec.type) {
        // OVH can't change a record's type: replace it.
        await call("POST", `${zone(d)}/record`, ovhRecordBody(spec, true));
        await call("DELETE", `${zone(d)}/record/${encodeURIComponent(r.id)}`);
      } else await call("PUT", `${zone(d)}/record/${encodeURIComponent(r.id)}`, ovhRecordBody(spec, false));
      await apply(d);
    },
    async remove(d, r) {
      await call("DELETE", `${zone(d)}/record/${encodeURIComponent(r.id)}`);
      await apply(d);
    },
  };
}

// ---------------------------------------------------------------------------
// Namecheap

function namecheap(user: string, apiKey: string, clientIp: string): Registrar {
  const base = "https://api.namecheap.com/xml.response";
  const call = async (command: string, params: Record<string, string> = {}, signal?: AbortSignal) => {
    const all = { ApiUser: user, ApiKey: apiKey, UserName: user, ClientIp: clientIp, Command: command, ...params };
    const form = new URLSearchParams(all).toString();
    // setHosts sends every record: POST keeps the URL short.
    const { res, text } = command.endsWith("setHosts")
      ? await request("namecheap", base, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal,
      })
      : await request("namecheap", `${base}?${form}`, { signal });
    const errors = namecheapErrors(text);
    if (errors.length) {
      const message = errors.map((e) => e.message).join("; ");
      if (/api ?key|ApiUser|UserName|invalid request ip|ip is not|whitelist/i.test(message)) {
        throw new AuthError(
          "namecheap",
          /ip/i.test(message)
            ? `Namecheap refused this IP address (${clientIp}): whitelist it in Profile → Tools → API Access`
            : `Namecheap refused the credentials: ${message}`,
        );
      }
      throw new Error(message);
    }
    if (!res.ok) throw new Error(`Namecheap answered ${res.status}`);
    return text;
  };
  const hosts = async (d: Domain, signal?: AbortSignal) =>
    parseNamecheapHosts(await call("namecheap.domains.dns.getHosts", splitDomain(d.name), signal), d.name);
  const set = (d: Domain, records: (RecordSpec | DnsRecord)[]) =>
    call("namecheap.domains.dns.setHosts", { ...splitDomain(d.name), ...namecheapHostParams(records) });
  return {
    id: "namecheap",
    minTtl: 60,
    async domains(signal) {
      const out: Domain[] = [];
      for (let page = 1; page <= 50; page++) {
        const xml = await call("namecheap.domains.getList", { PageSize: "100", Page: String(page) }, signal);
        const { domains, total } = parseNamecheapDomains(xml);
        out.push(...domains);
        if (!domains.length || out.length >= total) break;
      }
      return out;
    },
    records: hosts,
    // setHosts replaces every record: start from a fresh copy, never from what the list showed.
    async create(d, spec) {
      await set(d, [...await hosts(d), spec]);
    },
    async update(d, r, spec) {
      const fresh = await hosts(d);
      if (!fresh.some((x) => x.id === r.id)) throw new Error("This record changed meanwhile: refresh and try again");
      await set(d, fresh.map((x) => x.id === r.id ? spec : x));
    },
    async remove(d, r) {
      const fresh = await hosts(d);
      if (!fresh.some((x) => x.id === r.id)) throw new Error("This record is already gone: refresh the list");
      await set(d, fresh.filter((x) => x.id !== r.id));
    },
  };
}

// ---------------------------------------------------------------------------

/** The registrars whose credentials are set, in display order, and the half-configured ones. */
export function registrars(p: Record<string, unknown>): { list: Registrar[]; problems: AuthError[] } {
  const list: Registrar[] = [];
  const problems: AuthError[] = [];
  if (str(p.porkbunApiKey) && str(p.porkbunSecretKey)) {
    list.push(porkbun(str(p.porkbunApiKey), str(p.porkbunSecretKey)));
  } else if (str(p.porkbunApiKey) || str(p.porkbunSecretKey)) {
    problems.push(new AuthError("porkbun", "Porkbun needs both the API key and the secret API key"));
  }
  if (str(p.gandiToken)) list.push(gandi(str(p.gandiToken)));
  const ovhKeys = [p.ovhAppKey, p.ovhAppSecret, p.ovhConsumerKey].map(str);
  if (ovhKeys.every(Boolean)) {
    try {
      list.push(ovh(ovhEndpoint(p.ovhEndpoint), ovhKeys[0], ovhKeys[1], ovhKeys[2]));
    } catch (e) {
      problems.push(new AuthError("ovh", (e as Error).message));
    }
  } else if (ovhKeys.some(Boolean)) {
    problems.push(new AuthError("ovh", "OVHcloud needs the application key, application secret and consumer key"));
  }
  if (str(p.namecheapUser) && str(p.namecheapApiKey)) {
    if (str(p.namecheapClientIp)) {
      list.push(namecheap(str(p.namecheapUser), str(p.namecheapApiKey), str(p.namecheapClientIp)));
    } else {
      problems.push(
        new AuthError("namecheap", "Namecheap needs your public IP address (the one you whitelisted) in Settings"),
      );
    }
  } else if (str(p.namecheapUser) || str(p.namecheapApiKey)) {
    problems.push(new AuthError("namecheap", "Namecheap needs both the user name and the API key"));
  }
  return { list, problems };
}

export const TOKEN_PAGES: Record<RegistrarId, string> = {
  porkbun: "https://porkbun.com/account/api",
  gandi: "https://admin.gandi.net/organizations/account/pat",
  ovh: "https://eu.api.ovh.com/createToken/?GET=/domain/*&POST=/domain/*&PUT=/domain/*&DELETE=/domain/*",
  namecheap: "https://ap.www.namecheap.com/settings/tools/apiaccess/",
};
