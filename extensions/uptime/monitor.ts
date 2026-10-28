// The watchlist (extension storage) and the checks themselves: fetch for HTTP, openssl for the certificate.

import { exec, storage } from "@backslash/api";
import {
  type Certificate,
  type Check,
  fetchError,
  firstPem,
  normalizeUrl,
  parseVerify,
  parseX509,
  record,
  type Record_,
  type Site,
} from "./lib.ts";

export const TIMEOUT_S = 15;

export const loadSites = async () => ((await storage.get("sites")) ?? []) as unknown as Site[];
export const loadRecords = async () => ((await storage.get("records")) ?? {}) as unknown as Record<string, Record_>;

export async function addSite(input: string, name?: string): Promise<Site> {
  const url = normalizeUrl(input);
  const sites = await loadSites();
  if (sites.some((s) => s.url === url)) throw new Error(`${url} is already watched`);
  const site: Site = { url, ...(name?.trim() ? { name: name.trim() } : {}), added: Date.now() };
  await storage.set("sites", [...sites, site] as any);
  notifyChanged();
  return site;
}

export async function updateSite(oldUrl: string, input: string, name?: string): Promise<void> {
  const url = normalizeUrl(input);
  const sites = await loadSites();
  if (url !== oldUrl && sites.some((s) => s.url === url)) throw new Error(`${url} is already watched`);
  await storage.set(
    "sites",
    sites.map((s) =>
      s.url === oldUrl ? { url, ...(name?.trim() ? { name: name.trim() } : {}), added: s.added } : s
    ) as any,
  );
  if (url !== oldUrl) await forget(oldUrl);
  notifyChanged();
}

async function forget(url: string) {
  const records = await loadRecords();
  delete records[url];
  await storage.set("records", records as any);
}

export async function removeSite(url: string): Promise<void> {
  await storage.set("sites", (await loadSites()).filter((s) => s.url !== url) as any);
  await forget(url);
  notifyChanged();
}

export async function saveCheck(url: string, check: Check): Promise<Record_> {
  const records = await loadRecords();
  const next = record(records[url], check);
  records[url] = next;
  await storage.set("records", records as any);
  return next;
}

/** The server certificate, read with `openssl s_client` then `openssl x509`. */
export async function certificate(url: URL, signal: AbortSignal): Promise<Certificate> {
  const host = url.hostname;
  const port = url.port || "443";
  const isIp = /^[\d.]+$/.test(host) || host.startsWith("[");
  const args = ["s_client", "-connect", `${host}:${port}`, ...(isIp ? [] : ["-servername", host])];
  let out: string;
  try {
    // An empty stdin makes s_client close right after the handshake.
    out = await exec("openssl", args, { stdin: "", signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("Install openssl to read certificates");
    throw new Error(
      String(e instanceof Error ? e.message : e).split("\n").find((l) => /error|refused|timeout/i.test(l)) ??
        "No TLS handshake",
    );
  }
  const pem = firstPem(out);
  if (!pem) throw new Error("The server sent no certificate");
  const x509 = await exec("openssl", [
    "x509",
    "-noout",
    "-subject",
    "-issuer",
    "-startdate",
    "-enddate",
    "-ext",
    "subjectAltName",
  ], {
    stdin: pem,
    signal,
  });
  const verify = parseVerify(out);
  return { ...parseX509(x509), verifyCode: verify?.code, verifyText: verify?.text };
}

export async function check(site: Site, signal: AbortSignal): Promise<Check> {
  const url = new URL(site.url);
  const timeout = AbortSignal.timeout(TIMEOUT_S * 1000);
  const both = AbortSignal.any([signal, timeout]);
  const cert = url.protocol === "https:"
    ? certificate(url, both).then(
      (c) => ({ cert: c }),
      (e) => ({ certError: e instanceof Error ? e.message : String(e) }),
    )
    : Promise.resolve({});
  const at = Date.now();
  const start = performance.now();
  let http: Partial<Check>;
  try {
    const res = await fetch(site.url, {
      signal: both,
      redirect: "follow",
      headers: { "User-Agent": "Backslash-Uptime/1.0 (+https://github.com/backslash-app)", Accept: "*/*" },
    });
    const ms = performance.now() - start;
    await res.body?.cancel().catch(() => {});
    http = {
      status: res.status,
      statusText: res.statusText,
      ms,
      ...(res.redirected && res.url !== site.url ? { finalUrl: res.url } : {}),
    };
  } catch (e) {
    if (signal.aborted) throw e;
    http = { error: fetchError(e, timeout.aborted, TIMEOUT_S) };
  }
  return { at, ...http, ...await cert };
}

// --- Live reload: views of this command share one process -------------------

const changes = new EventTarget();

export function notifyChanged() {
  changes.dispatchEvent(new Event("change"));
}

/** Resolves on the next change, or when `signal` aborts. */
export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}
