// 0x0.st and PrivateBin, and the history of what was shared.

import { storage } from "@backslash/api";
import {
  allowedInstance,
  basename,
  dataUrl,
  deleteUrl,
  encryptPaste,
  type Expiry,
  MAX_0X0,
  mimeType,
  normalizeInstance,
  pasteUrl,
  retentionDays,
  type Share,
} from "./lib.ts";

const ZERO = "https://0x0.st";
/** 0x0.st asks clients to say who they are. */
const USER_AGENT = "Backslash-FileShare/1.0 (+https://github.com/backslash-app/plugins)";

const aborted = (e: unknown) => e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");

async function call(service: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (aborted(e)) throw e;
    throw new Error(`${service} can't be reached: check your connection`);
  }
}

// ---------------------------------------------------------------------------
// 0x0.st

export interface Upload {
  name: string;
  bytes: Uint8Array;
}

/** Uploads one file; `secret` makes the link long and hard to guess. */
export async function upload0x0(
  file: Upload,
  e: Expiry,
  { secret = true, signal }: { secret?: boolean; signal?: AbortSignal } = {},
): Promise<Share> {
  if (file.bytes.length > MAX_0X0) throw new Error(`${file.name} is over 0x0.st's 512 MiB limit: send it with croc`);
  const hours = Math.min(e.hours, Math.floor(retentionDays(file.bytes.length) * 24));
  const form = new FormData();
  form.append("file", new Blob([file.bytes as BlobPart], { type: mimeType(file.name) }), file.name);
  form.append("expires", String(hours));
  if (secret) form.append("secret", "");
  const res = await call("0x0.st", ZERO, { method: "POST", body: form, signal, headers: { "User-Agent": USER_AGENT } });
  const text = (await res.text()).trim();
  if (res.status === 451 || res.status === 403) {
    throw new Error(`0x0.st refused ${file.name}: ${text || res.statusText}`);
  }
  if (res.status === 413) throw new Error(`${file.name} is too large for 0x0.st`);
  if (!res.ok || !/^https?:\/\//.test(text)) {
    throw new Error(`0x0.st answered ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
  const expires = Number(res.headers.get("X-Expires")) || Date.now() + hours * 3600_000;
  return {
    id: text,
    service: "0x0",
    name: file.name,
    kind: "file",
    bytes: file.bytes.length,
    created: Date.now(),
    expires,
    url: text,
    // Only new files get a token: one already on 0x0.st (same content) can't be deleted by us.
    token: res.headers.get("X-Token") ?? undefined,
  };
}

export async function delete0x0(s: Share): Promise<void> {
  if (!s.url || !s.token) throw new Error("0x0.st gave no delete token for this file (it was already there)");
  const form = new FormData();
  form.append("token", s.token);
  form.append("delete", "");
  const res = await call("0x0.st", s.url, { method: "POST", body: form, headers: { "User-Agent": USER_AGENT } });
  if (res.status === 401) throw new Error("0x0.st refused the delete token");
  if (!res.ok && res.status !== 404) throw new Error(`0x0.st answered ${res.status}`);
}

// ---------------------------------------------------------------------------
// PrivateBin

export function instance(preferences: Record<string, unknown>): string {
  let url: string;
  try {
    url = normalizeInstance(preferences.privatebin);
  } catch {
    throw new Error("The PrivateBin instance in Settings is not a URL");
  }
  if (!allowedInstance(url)) {
    throw new Error(
      `${
        new URL(url).hostname
      } is not allowed: use privatebin.net, bin.disroot.org, or an instance on your network or Tailscale`,
    );
  }
  return url;
}

export interface PasteOptions {
  expiry: Expiry;
  burn?: boolean;
  password?: string;
  signal?: AbortSignal;
}

/** Encrypts here, uploads the ciphertext, returns the link with the key in its fragment. */
export async function privatebin(
  base: string,
  what: { text?: string; file?: Upload },
  o: PasteOptions,
): Promise<Share> {
  const content = what.file
    ? { paste: "", attachment: dataUrl(what.file.bytes, mimeType(what.file.name)), attachment_name: what.file.name }
    : { paste: what.text ?? "" };
  const { body, key } = await encryptPaste(content, {
    expire: o.expiry.privatebin,
    burn: o.burn,
    password: o.password,
    formatter: "plaintext",
  });
  const res = await call("PrivateBin", base, {
    method: "POST",
    signal: o.signal,
    headers: { "X-Requested-With": "JSONHttpRequest", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 413) throw new Error("Too large for this PrivateBin instance: use 0x0.st or croc");
  const answer = await res.json().catch(() => undefined) as
    | { status: number; id?: string; deletetoken?: string; message?: string }
    | undefined;
  if (!answer) throw new Error(`${new URL(base).hostname} answered ${res.status}: is it a PrivateBin instance?`);
  if (answer.status !== 0 || !answer.id) throw new Error(`PrivateBin: ${answer.message ?? "the paste was refused"}`);
  const name = what.file?.name ?? "Text";
  return {
    id: `${base}?${answer.id}`,
    service: "privatebin",
    name,
    kind: what.file ? "file" : "text",
    bytes: what.file?.bytes.length ?? new TextEncoder().encode(what.text ?? "").length,
    created: Date.now(),
    expires: Date.now() + o.expiry.hours * 3600_000,
    url: pasteUrl(base, answer.id, key, o.burn),
    deleteUrl: answer.deletetoken ? deleteUrl(base, answer.id, answer.deletetoken) : undefined,
    burn: o.burn,
    password: !!o.password,
  };
}

export async function deletePrivatebin(s: Share): Promise<void> {
  if (!s.deleteUrl) throw new Error("No delete link was kept for this paste");
  const res = await call("PrivateBin", s.deleteUrl, { headers: { "X-Requested-With": "JSONHttpRequest" } });
  const answer = await res.json().catch(() => undefined) as { status: number; message?: string } | undefined;
  // Gone already (burnt, expired) is fine.
  if (answer && answer.status !== 0 && !/not exist|expired|deleted/i.test(answer.message ?? "")) {
    throw new Error(`PrivateBin: ${answer.message}`);
  }
}

// ---------------------------------------------------------------------------
// Files

/** Reads a copied file (folders only go through croc). */
export async function readUpload(path: string): Promise<Upload> {
  const st = await Deno.stat(path);
  if (st.isDirectory) throw new Error(`${basename(path)} is a folder: send it with croc`);
  return { name: basename(path), bytes: await Deno.readFile(path) };
}

// ---------------------------------------------------------------------------
// History

type Json = Parameters<typeof storage.set>[1];

export const history = async (): Promise<Share[]> => ((await storage.get("shares")) ?? []) as unknown as Share[];

export async function remember(shares: Share[]): Promise<void> {
  const ids = new Set(shares.map((s) => s.id));
  const all = [...shares, ...(await history()).filter((s) => !ids.has(s.id))].slice(0, 200);
  await storage.set("shares", all as unknown as Json);
}

export async function forget(s: Share): Promise<void> {
  await storage.set("shares", (await history()).filter((h) => h.id !== s.id) as unknown as Json);
}

export async function update(s: Share): Promise<void> {
  await storage.set("shares", (await history()).map((h) => (h.id === s.id ? s : h)) as unknown as Json);
}
