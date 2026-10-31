// The four image services, saving to ~/Pictures and the history in storage.

import { storage } from "@backslash/api";
import {
  addGeneration,
  type Aspect,
  comfyCheckpoints,
  comfyError,
  comfyWorkflow,
  decodeBase64,
  falError,
  falInput,
  falModel,
  fileName,
  type Generation,
  imageExtension,
  imageSize,
  openaiError,
  openaiImage,
  openaiRequest,
  parseComfyHistory,
  parseFal,
  parsePrediction,
  parseProvider,
  type Prediction,
  type Provider,
  type Quality,
  replicateError,
  replicateInput,
  replicateModel,
  resolveFolder,
} from "./lib.ts";

/**
 * As declared in `[permissions] net` (kept equal by a test): the services,
 * their image hosts, and a ComfyUI on this computer, the local network or
 * Tailscale.
 */
export const HOSTS = [
  "api.openai.com",
  "api.replicate.com",
  "replicate.delivery",
  "*.replicate.delivery",
  "fal.run",
  "fal.media",
  "*.fal.media",
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `comfy.lan:8188/` → `http://comfy.lan:8188`. */
export function normalizeComfyUrl(input: unknown): string {
  let url = String(input ?? "").trim() || "http://127.0.0.1:8188";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/[?#].*$/, "").replace(/\/+$/, "");
}

export class SetupError extends Error {}

const env = (key: string) => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};
export const HOME = env("HOME") ?? "";

export interface Settings {
  provider: Provider;
  openaiKey: string;
  replicateToken: string;
  replicateModel?: string;
  falKey: string;
  falModel?: string;
  comfyUrl: string;
  comfyCheckpoint: string;
  comfySteps: number;
  folder: string;
}

export function settings(p: Record<string, unknown>): Settings {
  return {
    provider: parseProvider(p.provider) ?? "openai",
    openaiKey: String(p.openaiKey ?? "").trim(),
    replicateToken: String(p.replicateToken ?? "").trim(),
    replicateModel: replicateModel(p.replicateModel || "black-forest-labs/flux-schnell"),
    falKey: String(p.falKey ?? "").trim(),
    falModel: falModel(p.falModel || "fal-ai/flux/schnell"),
    comfyUrl: normalizeComfyUrl(p.comfyUrl),
    comfyCheckpoint: String(p.comfyCheckpoint ?? "").trim(),
    comfySteps: Number(p.comfySteps) || 25,
    folder: String(p.folder ?? "").trim() || "~/Pictures/Generated",
  };
}

/** What is missing to use a provider, as a sentence; undefined when it's ready. */
export function missing(s: Settings, provider: Provider): string | undefined {
  if (provider === "openai" && !s.openaiKey) return "Add an OpenAI API key in Settings";
  if (provider === "replicate") {
    if (!s.replicateToken) return "Add a Replicate API token in Settings";
    if (!s.replicateModel) return "The Replicate model must be owner/name, like black-forest-labs/flux-schnell";
  }
  if (provider === "fal") {
    if (!s.falKey) return "Add a fal.ai API key in Settings";
    if (!s.falModel) return "The fal.ai model must be an endpoint id, like fal-ai/flux/schnell";
  }
  if (provider === "comfyui") {
    let host: string;
    try {
      host = new URL(s.comfyUrl).hostname;
    } catch {
      return `“${s.comfyUrl}” is not an address`;
    }
    if (!isAllowedHost(host)) return `${host} is outside the networks this extension may reach`;
  }
  return undefined;
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

async function call(service: string, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach ${service}: ${message(e)}`);
  }
}

const json = (res: Response) => res.json().catch(() => undefined);

async function download(service: string, url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (url.startsWith("data:")) return decodeBase64(url);
  const host = new URL(url).hostname;
  if (!isAllowedHost(host)) throw new Error(`${service} put the image on ${host}, which this extension may not reach`);
  const res = await call(service, url, {}, signal);
  if (!res.ok) throw new Error(`${service}'s image answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface Request {
  prompt: string;
  provider: Provider;
  aspect: Aspect;
  quality: Quality;
}

export interface Result {
  bytes: Uint8Array;
  model: string;
  seed?: number;
}

async function openai(s: Settings, r: Request, signal?: AbortSignal): Promise<Result> {
  const res = await call("OpenAI", "https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(openaiRequest(r.prompt, r.aspect, r.quality)),
  }, signal);
  const body = await json(res);
  if (!res.ok) throw new Error(openaiError(res.status, body));
  return { bytes: openaiImage(body), model: "gpt-image-1" };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

async function replicate(s: Settings, r: Request, signal?: AbortSignal): Promise<Result> {
  const headers = { Authorization: `Bearer ${s.replicateToken}`, "Content-Type": "application/json" };
  const res = await call("Replicate", `https://api.replicate.com/v1/models/${s.replicateModel}/predictions`, {
    method: "POST",
    // Waits up to a minute for the result instead of returning at once.
    headers: { ...headers, Prefer: "wait=60" },
    body: JSON.stringify(replicateInput(r.prompt, r.aspect)),
  }, signal);
  const body = await json(res);
  if (!res.ok) throw new Error(replicateError(res.status, body));
  let p: Prediction = parsePrediction(body);
  const deadline = Date.now() + 5 * 60_000;
  while (p.status !== "succeeded" && p.status !== "failed" && p.status !== "canceled") {
    if (!p.poll || !p.poll.startsWith("https://api.replicate.com/")) break;
    if (Date.now() > deadline) throw new Error("Replicate took more than 5 minutes: look for it on replicate.com");
    await sleep(1500, signal);
    const poll = await call("Replicate", p.poll, { headers }, signal);
    if (!poll.ok) throw new Error(replicateError(poll.status, await json(poll)));
    p = parsePrediction(await json(poll));
  }
  if (p.status === "failed") throw new Error(`Replicate failed${p.error ? `: ${p.error}` : ""}`);
  if (p.status === "canceled") throw new Error("The prediction was canceled on Replicate");
  if (!p.output) throw new Error("Replicate sent no image");
  return { bytes: await download("Replicate", p.output, signal), model: s.replicateModel!, seed: p.seed };
}

async function fal(s: Settings, r: Request, signal?: AbortSignal): Promise<Result> {
  const res = await call("fal.ai", `https://fal.run/${s.falModel}`, {
    method: "POST",
    headers: { Authorization: `Key ${s.falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(falInput(r.prompt, r.aspect)),
  }, signal);
  const body = await json(res);
  if (!res.ok) throw new Error(falError(res.status, body));
  const out = parseFal(body);
  return { bytes: await download("fal.ai", out.url, signal), model: s.falModel!, seed: out.seed };
}

export async function checkpoints(s: Settings, signal?: AbortSignal): Promise<string[]> {
  const res = await call("ComfyUI", `${s.comfyUrl}/object_info/CheckpointLoaderSimple`, {}, signal);
  if (!res.ok) throw new Error(`ComfyUI answered ${res.status}: is ${s.comfyUrl} a ComfyUI?`);
  return comfyCheckpoints(await json(res));
}

async function comfy(s: Settings, r: Request, signal?: AbortSignal): Promise<Result> {
  let checkpoint = s.comfyCheckpoint;
  if (!checkpoint) {
    checkpoint = (await checkpoints(s, signal))[0];
    if (!checkpoint) throw new Error("ComfyUI has no checkpoint: put one in models/checkpoints");
  }
  const seed = Math.floor(Math.random() * 2 ** 32);
  const res = await call("ComfyUI", `${s.comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: comfyWorkflow({ prompt: r.prompt, checkpoint, aspect: r.aspect, steps: s.comfySteps, seed }),
      client_id: "backslash",
    }),
  }, signal);
  const body = await json(res);
  if (!res.ok) throw new Error(comfyError(body, res.status));
  const id = String(body?.prompt_id ?? "");
  if (!id) throw new Error("ComfyUI didn't queue the prompt");
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    await sleep(1000, signal);
    const h = await call("ComfyUI", `${s.comfyUrl}/history/${encodeURIComponent(id)}`, {}, signal);
    const state = h.ok ? parseComfyHistory(await json(h), id) : { done: false as const };
    if (state.done) {
      if (state.error || !state.image) throw new Error(state.error ?? "ComfyUI finished without an image");
      const q = new URLSearchParams(state.image);
      const img = await call("ComfyUI", `${s.comfyUrl}/view?${q}`, {}, signal);
      if (!img.ok) throw new Error(`ComfyUI's image answered ${img.status}`);
      return { bytes: new Uint8Array(await img.arrayBuffer()), model: checkpoint, seed };
    }
    if (Date.now() > deadline) {
      throw new Error("ComfyUI took more than 10 minutes: the image may still come in ComfyUI");
    }
  }
}

export async function generate(s: Settings, r: Request, signal?: AbortSignal): Promise<Result> {
  const problem = missing(s, r.provider);
  if (problem) throw new SetupError(problem);
  if (!r.prompt.trim()) throw new Error("Type a prompt first");
  switch (r.provider) {
    case "openai":
      return await openai(s, r, signal);
    case "replicate":
      return await replicate(s, r, signal);
    case "fal":
      return await fal(s, r, signal);
    case "comfyui":
      return await comfy(s, r, signal);
  }
}

// ---------------------------------------------------------------------------
// Saving and history

type Json = Parameters<typeof storage.set>[1];
const HISTORY = "history";

export async function loadHistory(): Promise<Generation[]> {
  const h = await storage.get(HISTORY).catch(() => undefined);
  return Array.isArray(h) ? h as unknown as Generation[] : [];
}

export async function saveHistory(list: Generation[]): Promise<void> {
  await storage.set(HISTORY, list as unknown as Json);
}

/** Generates, writes the file and records it. */
export async function generateAndSave(s: Settings, r: Request, signal?: AbortSignal): Promise<Generation> {
  const started = Date.now();
  const folder = resolveFolder(s.folder, HOME);
  const out = await generate(s, r, signal);
  const at = new Date();
  await Deno.mkdir(folder, { recursive: true });
  const path = `${folder}/${fileName(r.prompt, at, imageExtension(out.bytes))}`;
  await Deno.writeFile(path, out.bytes);
  const size = imageSize(out.bytes);
  const g: Generation = {
    id: `${at.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    path,
    prompt: r.prompt.trim(),
    provider: r.provider,
    model: out.model,
    aspect: r.aspect,
    ...(r.provider === "openai" ? { quality: r.quality } : {}),
    at: at.getTime(),
    ms: Date.now() - started,
    ...(size ?? {}),
    ...(out.seed !== undefined ? { seed: out.seed } : {}),
    bytes: out.bytes.length,
  };
  await saveHistory(addGeneration(await loadHistory(), g));
  return g;
}

export async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}
