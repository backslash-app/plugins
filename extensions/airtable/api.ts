// Airtable (Bearer personal access token), NocoDB (xc-token, API v2) and
// Baserow (Token, database token) behind the same few functions.

import { storage } from "@backslash/api";
import {
  airtableFormula,
  type AirtableTable,
  apiError,
  type BaserowField,
  baserowWeb,
  type Field,
  fromAirtableTable,
  fromBaserowFields,
  fromNocoColumns,
  isAllowedHost,
  type Kind,
  KIND_NAMES,
  type NocoColumn,
  nocoPk,
  nocoWhere,
  normalizeUrl,
  type Row,
  SetupError,
  type Table,
  tableKey,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export interface Backend {
  kind: Kind;
  /** API root. */
  base: string;
  token: string;
}

const AIRTABLE = "https://api.airtable.com/v0";

function checkHost(base: string, kind: Kind) {
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${base}” is not an address`, kind);
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, kind);
}

/** The services the preferences set up; a SetupError when there is none. */
export function backends(prefs: Record<string, unknown>): Backend[] {
  const out: Backend[] = [];
  const tok = (k: string) => String(prefs[k] ?? "").trim().replace(/^(Bearer|Token)\s+/i, "");
  if (tok("airtableToken")) out.push({ kind: "airtable", base: AIRTABLE, token: tok("airtableToken") });
  for (const kind of ["nocodb", "baserow"] as const) {
    const base = normalizeUrl(prefs[`${kind}Url`]);
    const token = tok(`${kind}Token`);
    if (!base && !token) continue;
    if (!base) throw new SetupError(`Add the address of your ${KIND_NAMES[kind]}`, kind);
    checkHost(base, kind);
    if (!token) throw new SetupError(`Add a ${KIND_NAMES[kind]} token`, kind, base);
    out.push({ kind, base, token });
  }
  if (!out.length) throw new SetupError("Connect Airtable, NocoDB or Baserow");
  return out;
}

async function request<T>(
  b: Backend,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (b.kind === "airtable") headers.Authorization = `Bearer ${b.token}`;
  else if (b.kind === "nocodb") headers["xc-token"] = b.token;
  else headers.Authorization = `Token ${b.token}`;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${b.base}${path}`, {
      method: o.method ?? "GET",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(b.base).hostname} is outside the networks this extension may reach`, b.kind);
    }
    throw new SetupError(
      `Can't reach ${KIND_NAMES[b.kind]} at ${new URL(b.base).host}: ${(e as Error).message}`,
      b.kind,
      b.base,
    );
  }
  const text = await res.text();
  if (res.ok && /^\s*</.test(text)) {
    throw new SetupError(
      `${b.base} answers, but not as ${KIND_NAMES[b.kind]}'s API: check the address`,
      b.kind,
      b.base,
    );
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw apiError(b.kind, res.status, json);
  return json as T;
}

/** Each service's result, or its error: one down doesn't hide the others. */
export async function each<T>(
  list: Backend[],
  load: (b: Backend) => Promise<T>,
): Promise<{ ok: { backend: Backend; value: T }[]; errors: { backend: Backend; error: Error }[] }> {
  const settled = await Promise.allSettled(list.map(load));
  const ok: { backend: Backend; value: T }[] = [];
  const errors: { backend: Backend; error: Error }[] = [];
  settled.forEach((r, i) =>
    r.status === "fulfilled"
      ? ok.push({ backend: list[i], value: r.value })
      : errors.push({ backend: list[i], error: r.reason })
  );
  return { ok, errors };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Tables

async function loadTables(b: Backend, signal?: AbortSignal): Promise<Table[]> {
  if (b.kind === "airtable") {
    const bases: { id: string; name: string }[] = [];
    let offset: string | undefined;
    do {
      const r: { bases: { id: string; name: string }[]; offset?: string } = await request(
        b,
        `/meta/bases${offset ? `?offset=${encodeURIComponent(offset)}` : ""}`,
        { signal },
      );
      bases.push(...r.bases);
      offset = r.offset;
    } while (offset && bases.length < 500);
    // Airtable allows 5 requests a second per base: a few at a time is fine.
    const tables = await pool(
      bases,
      4,
      (base) =>
        request<{ tables: AirtableTable[] }>(b, `/meta/bases/${base.id}/tables`, { signal })
          .then((r) => r.tables.map((t) => fromAirtableTable(t, base)), () => []),
    );
    return tables.flat();
  }
  if (b.kind === "nocodb") {
    const { list } = await request<{ list: { id: string; title: string }[] }>(b, "/api/v2/meta/bases", { signal });
    const tables = await pool(
      list,
      4,
      (base) =>
        request<{ list: { id: string; title: string; mm?: boolean }[] }>(b, `/api/v2/meta/bases/${base.id}/tables`, {
          signal,
        }).then(
          (r) =>
            r.list.filter((t) => !t.mm).map((t): Table => ({
              kind: "nocodb",
              id: t.id,
              name: t.title,
              baseId: base.id,
              baseName: base.title,
            })),
          () => [],
        ),
    );
    return tables.flat();
  }
  // A database token can't list workspaces, but it can list the tables it may use.
  const list = await request<{ id: number; name: string; database_id: number }[]>(
    b,
    "/api/database/tables/all-tables/",
    { signal },
  );
  return list.map((t) => ({
    kind: "baserow",
    id: String(t.id),
    name: t.name,
    baseId: String(t.database_id),
    baseName: `Database ${t.database_id}`,
  }));
}

const tablesKey = (b: Backend) => `tables:${b.kind}:${b.base}`;

/** The tables saved last time (refreshed for next time), else loaded now. */
export async function tables(b: Backend, signal?: AbortSignal, fresh = false): Promise<Table[]> {
  const saved = fresh ? undefined : await storage.get(tablesKey(b)).catch(() => undefined) as Table[] | undefined;
  const load = loadTables(b, signal).then(async (list) => {
    await storage.set(tablesKey(b), list as unknown as Json).catch(() => {});
    return list;
  });
  if (saved?.length) {
    load.catch(() => {});
    return saved;
  }
  return await load;
}

// ---------------------------------------------------------------------------
// Fields

const nocoColumns = new Map<string, NocoColumn[]>();

export async function fields(b: Backend, t: Table, signal?: AbortSignal): Promise<Field[]> {
  if (t.fields) return t.fields;
  if (b.kind === "nocodb") {
    const r = await request<{ columns: NocoColumn[] }>(b, `/api/v2/meta/tables/${t.id}`, { signal });
    nocoColumns.set(t.id, r.columns);
    return (t.fields = fromNocoColumns(r.columns));
  }
  const list = await request<BaserowField[]>(b, `/api/database/fields/table/${t.id}/`, { signal });
  return (t.fields = fromBaserowFields(list));
}

// ---------------------------------------------------------------------------
// Records

export async function search(b: Backend, t: Table, query: string, signal?: AbortSignal): Promise<Row[]> {
  const fs = await fields(b, t, signal);
  if (b.kind === "airtable") {
    const params = new URLSearchParams({ pageSize: "50", maxRecords: "50" });
    const formula = airtableFormula(query, fs);
    if (formula) params.set("filterByFormula", formula);
    const r = await request<{ records: { id: string; createdTime?: string; fields: Record<string, unknown> }[] }>(
      b,
      `/${t.baseId}/${t.id}?${params}`,
      { signal },
    );
    return r.records.map((x) => ({ id: x.id, fields: x.fields, created: x.createdTime }));
  }
  if (b.kind === "nocodb") {
    const params = new URLSearchParams({ limit: "50" });
    const where = nocoWhere(query, fs);
    if (where) params.set("where", where);
    const r = await request<{ list: Record<string, unknown>[] }>(b, `/api/v2/tables/${t.id}/records?${params}`, {
      signal,
    });
    const pk = nocoPk(nocoColumns.get(t.id) ?? []);
    return r.list.map((x) => ({ id: String(x[pk] ?? x.Id ?? x.id ?? ""), fields: x }));
  }
  const params = new URLSearchParams({ user_field_names: "true", size: "50" });
  if (query.trim()) params.set("search", query.trim());
  const r = await request<{ results: (Record<string, unknown> & { id: number })[] }>(
    b,
    `/api/database/rows/table/${t.id}/?${params}`,
    { signal },
  );
  return r.results.map(({ id, order: _order, ...rest }) => ({ id: String(id), fields: rest }));
}

export async function create(b: Backend, t: Table, values: Record<string, unknown>): Promise<Row> {
  await remember(t);
  if (b.kind === "airtable") {
    const r = await request<{ id: string; createdTime?: string; fields: Record<string, unknown> }>(
      b,
      `/${t.baseId}/${t.id}`,
      { method: "POST", body: { fields: values, typecast: true } },
    );
    return { id: r.id, fields: r.fields, created: r.createdTime };
  }
  if (b.kind === "nocodb") {
    const r = await request<Record<string, unknown>>(b, `/api/v2/tables/${t.id}/records`, {
      method: "POST",
      body: values,
    });
    const pk = nocoPk(nocoColumns.get(t.id) ?? []);
    return { id: String(r[pk] ?? r.Id ?? r.id ?? ""), fields: { ...values, ...r } };
  }
  const r = await request<Record<string, unknown> & { id: number }>(
    b,
    `/api/database/rows/table/${t.id}/?user_field_names=true`,
    { method: "POST", body: values },
  );
  const { id, order: _order, ...rest } = r;
  return { id: String(id), fields: rest };
}

// ---------------------------------------------------------------------------
// Links

export function tableUrl(b: Backend, t: Table): string {
  if (b.kind === "airtable") return `https://airtable.com/${t.baseId}/${t.id}`;
  if (b.kind === "nocodb") return `${b.base}/dashboard/#/nc/${t.baseId}/${t.id}`;
  return `${baserowWeb(b.base)}/database/${t.baseId}/table/${t.id}`;
}

export function rowUrl(b: Backend, t: Table, row: Row): string {
  if (b.kind === "airtable") return `${tableUrl(b, t)}/${row.id}`;
  if (b.kind === "nocodb") return `${tableUrl(b, t)}?rowId=${encodeURIComponent(row.id)}`;
  return `${tableUrl(b, t)}/row/${row.id}`;
}

// ---------------------------------------------------------------------------
// Recently used tables come first

export async function remember(t: Table): Promise<void> {
  const recent = await storage.get<string[]>("recent").catch(() => undefined) ?? [];
  await storage.set("recent", [tableKey(t), ...recent.filter((k) => k !== tableKey(t))].slice(0, 20)).catch(() => {});
}

export async function recent(): Promise<string[]> {
  return await storage.get<string[]>("recent").catch(() => undefined) ?? [];
}
