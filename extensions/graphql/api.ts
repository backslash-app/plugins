// Sending GraphQL requests, introspecting schemas (cached), and the saved endpoints.

import { storage } from "@backslash/api";
import {
  type Endpoint,
  type GraphQLResponse,
  INTROSPECTION_QUERY,
  requestBody,
  type SavedEndpoint,
  type Schema,
  schemaFrom,
  slotEndpoints,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

const TIMEOUT = 30_000;

export interface Sent {
  response: GraphQLResponse;
  status: number;
  ms: number;
  bytes: number;
}

/** POSTs a GraphQL request and reads the answer, explaining HTTP and network failures. */
export async function send(endpoint: Endpoint, body: unknown, signal?: AbortSignal): Promise<Sent> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/graphql-response+json, application/json",
        ...endpoint.headers,
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`${endpoint.name} didn't answer within ${TIMEOUT / 1000} s`);
    }
    const why = e instanceof Error ? e.message.replace(/^error sending request for url \([^)]*\): /, "") : String(e);
    throw new Error(`Couldn't reach ${endpoint.name}: ${why}`);
  }
  const text = await res.text();
  const ms = Math.round(performance.now() - started);
  let response: GraphQLResponse | undefined;
  try {
    response = JSON.parse(text);
  } catch {
    response = undefined;
  }
  if (res.status === 401 || res.status === 403) {
    const detail = response?.errors?.[0]?.message;
    throw new Error(
      `${endpoint.name} refused the request (${res.status})${detail ? `: ${detail}` : ""}. ${
        endpoint.source === "slot"
          ? "Check its token in Settings → Extensions → GraphQL Explorer"
          : "It needs credentials: set it up in one of the endpoint slots in Settings, where the token is kept in the keyring"
      }`,
    );
  }
  if (!response || typeof response !== "object") {
    const hint = /<html/i.test(text)
      ? "an HTML page: is it the GraphQL endpoint's URL?"
      : `${text.slice(0, 120) || "an empty body"}`;
    throw new Error(`${endpoint.name} answered ${res.status} with ${hint}`);
  }
  return { response, status: res.status, ms, bytes: new TextEncoder().encode(text).length };
}

// ---------------------------------------------------------------------------
// Schemas, cached a day

const DAY = 86_400_000;
const memo = new Map<string, Schema>();

export async function loadSchema(endpoint: Endpoint, signal?: AbortSignal, force = false): Promise<Schema> {
  const key = `schema:${endpoint.url}`;
  if (!force) {
    const hit = memo.get(key);
    if (hit) return hit;
    const cached = await storage.get(key).catch(() => undefined) as { at: number; schema: Schema } | undefined;
    if (cached && Date.now() - cached.at < DAY) {
      memo.set(key, cached.schema);
      return cached.schema;
    }
  }
  const sent = await send(endpoint, requestBody(INTROSPECTION_QUERY, undefined, "IntrospectionQuery"), signal);
  const schema = schemaFrom(sent.response);
  memo.set(key, schema);
  // Huge schemas (GitHub's is several MB) stay in memory only.
  if (sent.bytes < 3_000_000) await storage.set(key, { at: Date.now(), schema } as unknown as Json).catch(() => {});
  return schema;
}

// ---------------------------------------------------------------------------
// Saved endpoints (no secret: those go in the preference slots) and the last query of each

const changes = new EventTarget();

/** Yields `load()` again after every change to the saved endpoints made from this process. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

export async function savedEndpoints(): Promise<SavedEndpoint[]> {
  return ((await storage.get("endpoints").catch(() => undefined)) as SavedEndpoint[] | undefined) ?? [];
}

export async function saveEndpoint(e: SavedEndpoint): Promise<void> {
  const all = await savedEndpoints();
  const i = all.findIndex((x) => x.id === e.id);
  if (i >= 0) all[i] = e;
  else all.push(e);
  await storage.set("endpoints", all as unknown as Json);
  changes.dispatchEvent(new Event("change"));
}

export async function deleteEndpoint(id: string): Promise<void> {
  await storage.set("endpoints", (await savedEndpoints()).filter((e) => e.id !== id) as unknown as Json);
  await storage.delete(`last:${id}`).catch(() => {});
  changes.dispatchEvent(new Event("change"));
}

/** Preference slots first, then saved endpoints. */
export async function allEndpoints(prefs: Record<string, unknown>): Promise<Endpoint[]> {
  const saved = await savedEndpoints();
  return [
    ...slotEndpoints(prefs),
    ...saved.map((s): Endpoint => ({ ...s, source: "saved" })),
  ];
}

export interface LastQuery {
  query: string;
  variables: string;
}

export const lastQuery = async (id: string) =>
  await storage.get(`last:${id}`).catch(() => undefined) as LastQuery | undefined;

export const rememberQuery = (id: string, q: LastQuery) =>
  storage.set(`last:${id}`, q as unknown as Json).catch(() => {});
