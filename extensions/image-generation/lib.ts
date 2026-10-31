// Requests and answers of the four image services, file names, and the history. No I/O here.

export type Provider = "openai" | "replicate" | "fal" | "comfyui";
export type Aspect = "square" | "landscape" | "portrait";
export type Quality = "auto" | "low" | "medium" | "high";

export const PROVIDERS: { id: Provider; title: string; needs: string }[] = [
  { id: "openai", title: "OpenAI", needs: "an OpenAI API key" },
  { id: "replicate", title: "Replicate", needs: "a Replicate API token" },
  { id: "fal", title: "fal.ai", needs: "a fal.ai API key" },
  { id: "comfyui", title: "ComfyUI", needs: "the address of your ComfyUI" },
];

export const ASPECTS: { id: Aspect; title: string }[] = [
  { id: "square", title: "Square" },
  { id: "landscape", title: "Landscape" },
  { id: "portrait", title: "Portrait" },
];

export function providerTitle(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.title ?? id;
}

/** "OpenAI", "openai", "fal.ai", "comfy" → the provider; undefined when unknown. */
export function parseProvider(text: unknown): Provider | undefined {
  const t = String(text ?? "").trim().toLowerCase().replace(/[\s.]+/g, "");
  if (!t) return undefined;
  if (t === "openai" || t === "gpt" || t === "gptimage1" || t === "dalle") return "openai";
  if (t === "replicate") return "replicate";
  if (t === "fal" || t === "falai") return "fal";
  if (t === "comfyui" || t === "comfy") return "comfyui";
  return undefined;
}

// ---------------------------------------------------------------------------
// OpenAI (gpt-image-1)

export const OPENAI_SIZES: Record<Aspect, string> = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

export function openaiRequest(prompt: string, aspect: Aspect, quality: Quality) {
  return { model: "gpt-image-1", prompt, n: 1, size: OPENAI_SIZES[aspect], quality, output_format: "png" };
}

/** `{ data: [{ b64_json }] }` → the image bytes. */
export function openaiImage(json: any): Uint8Array {
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new Error("OpenAI sent no image");
  return decodeBase64(b64);
}

export function openaiError(status: number, json: any): string {
  const msg = typeof json?.error?.message === "string" ? json.error.message : "";
  const code = String(json?.error?.code ?? "");
  if (status === 401) return "OpenAI refused the API key: check it in Settings";
  if (code === "moderation_blocked" || /safety system/i.test(msg)) {
    return "OpenAI's safety system refused this prompt: rephrase it";
  }
  if (/must be verified/i.test(msg)) {
    return "gpt-image-1 needs a verified organization: platform.openai.com → Settings → Organization → Verify";
  }
  if (status === 429) {
    return /quota|billing/i.test(msg)
      ? "Your OpenAI quota is used up: check billing"
      : "OpenAI is rate limiting: wait a minute";
  }
  return msg ? `OpenAI: ${msg}` : `OpenAI answered ${status}`;
}

// ---------------------------------------------------------------------------
// Replicate

export const REPLICATE_RATIOS: Record<Aspect, string> = { square: "1:1", landscape: "3:2", portrait: "2:3" };

/** `black-forest-labs/flux-schnell` (or a full replicate.com URL) → `owner/name`, or undefined. */
export function replicateModel(text: unknown): string | undefined {
  const t = String(text ?? "").trim().replace(/^https?:\/\/(www\.)?replicate\.com\//, "").replace(/\/+$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(t) ? t : undefined;
}

export function replicateInput(prompt: string, aspect: Aspect) {
  return { input: { prompt, aspect_ratio: REPLICATE_RATIOS[aspect], output_format: "png", num_outputs: 1 } };
}

export type Prediction = {
  id?: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | string;
  output: string | undefined;
  error?: string;
  poll?: string;
  seed?: number;
};

/** A prediction: its output is a URL, a list of URLs, or (file outputs) objects with `url`. */
export function parsePrediction(json: any): Prediction {
  const out = json?.output;
  const first = Array.isArray(out) ? out[0] : out;
  const url = typeof first === "string" ? first : typeof first?.url === "string" ? first.url : undefined;
  const seed = /seed[:\s]+(\d+)/i.exec(String(json?.logs ?? ""))?.[1];
  return {
    id: typeof json?.id === "string" ? json.id : undefined,
    status: String(json?.status ?? "starting"),
    output: url,
    error: json?.error ? String(json.error) : undefined,
    poll: typeof json?.urls?.get === "string" ? json.urls.get : undefined,
    seed: seed ? Number(seed) : undefined,
  };
}

export function replicateError(status: number, json: any): string {
  const detail = String(json?.detail ?? json?.title ?? "").trim();
  if (status === 401) return "Replicate refused the API token: check it in Settings";
  if (status === 402) return "Replicate needs billing set up for this model: replicate.com → Account → Billing";
  if (status === 404) return "Replicate has no such model: check the model in Settings (owner/name)";
  if (status === 422) return `Replicate refused the input${detail ? `: ${detail}` : ""}`;
  if (status === 429) return "Replicate is rate limiting: wait a minute";
  return detail ? `Replicate: ${detail}` : `Replicate answered ${status}`;
}

// ---------------------------------------------------------------------------
// fal.ai

export const FAL_SIZES: Record<Aspect, string> = {
  square: "square_hd",
  landscape: "landscape_4_3",
  portrait: "portrait_4_3",
};

export function falModel(text: unknown): string | undefined {
  const t = String(text ?? "").trim().replace(/^https?:\/\/(fal\.run|fal\.ai\/models)\//, "").replace(/\/+$/, "");
  return /^[\w.-]+(\/[\w.-]+)+$/.test(t) ? t : undefined;
}

export function falInput(prompt: string, aspect: Aspect) {
  return { prompt, image_size: FAL_SIZES[aspect], num_images: 1, enable_safety_checker: true };
}

/** `{ images: [{ url, width, height }], seed, has_nsfw_concepts }`. */
export function parseFal(json: any): { url: string; width?: number; height?: number; seed?: number } {
  const img = json?.images?.[0] ?? json?.image;
  if (typeof img?.url !== "string") throw new Error("fal.ai sent no image");
  if (json?.has_nsfw_concepts?.[0] === true) {
    throw new Error("fal.ai's safety checker blanked this image: rephrase the prompt");
  }
  return {
    url: img.url,
    width: typeof img.width === "number" ? img.width : undefined,
    height: typeof img.height === "number" ? img.height : undefined,
    seed: typeof json.seed === "number" ? json.seed : undefined,
  };
}

export function falError(status: number, json: any): string {
  const detail = json?.detail;
  const msg = typeof detail === "string"
    ? detail
    : Array.isArray(detail)
    ? detail.map((d: any) => d?.msg ?? "").filter(Boolean).join(", ")
    : "";
  if (status === 401 || status === 403) return "fal.ai refused the API key: check it in Settings";
  if (status === 404) return "fal.ai has no such model: check the model in Settings";
  if (/balance|locked|exhausted/i.test(msg)) return "Your fal.ai balance is empty: fal.ai → Billing";
  if (status === 429) return "fal.ai is rate limiting: wait a minute";
  return msg ? `fal.ai: ${msg}` : `fal.ai answered ${status}`;
}

// ---------------------------------------------------------------------------
// ComfyUI

export const COMFY_SIZES: Record<Aspect, [number, number]> = {
  square: [1024, 1024],
  landscape: [1216, 832],
  portrait: [832, 1216],
};

/** The default text-to-image graph, in ComfyUI's API format (what "Save (API)" exports). */
export function comfyWorkflow(o: {
  prompt: string;
  negative?: string;
  checkpoint: string;
  aspect: Aspect;
  steps?: number;
  seed: number;
}): Record<string, unknown> {
  const [width, height] = COMFY_SIZES[o.aspect];
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: o.seed,
        steps: Math.max(1, Math.min(150, Math.round(o.steps ?? 25))),
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: o.checkpoint } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["4", 1] } },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: o.negative ?? "blurry, low quality, watermark", clip: ["4", 1] },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "backslash", images: ["8", 0] } },
  };
}

/** `/object_info/CheckpointLoaderSimple`: the checkpoint names, old (`[[…]]`) and new (`["COMBO", { options }]`) shapes. */
export function comfyCheckpoints(json: any): string[] {
  const spec = json?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  if (!Array.isArray(spec)) return [];
  if (Array.isArray(spec[0])) return spec[0].map(String);
  if (Array.isArray(spec[1]?.options)) return spec[1].options.map(String);
  return [];
}

export type ComfyImage = { filename: string; subfolder: string; type: string };

/**
 * `/history/<prompt_id>`: `{}` while queued or running, then the outputs
 * (images of the SaveImage nodes) or the execution error.
 */
export function parseComfyHistory(
  json: any,
  promptId: string,
): { done: false } | { done: true; image?: ComfyImage; error?: string } {
  const entry = json?.[promptId];
  if (!entry) return { done: false };
  const status = entry.status ?? {};
  if (status.status_str === "error") {
    const err = (status.messages ?? []).find((m: any) => m?.[0] === "execution_error")?.[1];
    return {
      done: true,
      error: err?.exception_message
        ? `ComfyUI failed in ${err.node_type ?? "a node"}: ${String(err.exception_message).trim()}`
        : "ComfyUI failed",
    };
  }
  if (status.completed === false) return { done: false };
  for (const out of Object.values(entry.outputs ?? {}) as any[]) {
    const img = (out?.images ?? []).find((i: any) => i?.type === "output") ?? out?.images?.[0];
    if (img?.filename) {
      return {
        done: true,
        image: { filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" },
      };
    }
  }
  return { done: true, error: "ComfyUI finished without an image" };
}

/** A 400 from `/prompt`: `{ error: { message, details }, node_errors: { id: { errors: [...] } } }`. */
export function comfyError(json: any, status: number): string {
  const nodes = Object.values(json?.node_errors ?? {}) as any[];
  const first = nodes.flatMap((n) => n?.errors ?? [])[0];
  if (
    first?.type === "value_not_in_list" &&
    /ckpt_name/.test(String(first?.details ?? first?.extra_info?.input_name ?? ""))
  ) {
    return "ComfyUI has no such checkpoint: check the checkpoint in Settings";
  }
  const msg = first?.details || first?.message || json?.error?.message;
  return msg ? `ComfyUI: ${String(msg).trim()}` : `ComfyUI answered ${status}`;
}

// ---------------------------------------------------------------------------
// Files

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The extension the bytes call for: png, jpg or webp (png when unknown). */
export function imageExtension(bytes: Uint8Array): "png" | "jpg" | "webp" {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  return "png";
}

/** PNG and JPEG dimensions from the header, without decoding. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return undefined;
      const marker = bytes[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      }
      i += 2 + len;
    }
  }
  return undefined;
}

/** "A red fox, in the snow!" → "a-red-fox-in-the-snow", at most `max` characters, on a word boundary. */
export function slug(text: string, max = 48): string {
  const s = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length <= max) return s || "image";
  const cut = s.slice(0, max);
  return (cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut) || "image";
}

/** `2026-10-31 14-05-09 a-red-fox.png` style names, sortable and readable. */
export function fileName(prompt: string, at: Date, ext: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${
    p(at.getMinutes())
  }${p(at.getSeconds())}`;
  return `${stamp}-${slug(prompt)}.${ext}`;
}

/**
 * The folder preference: `~` expanded, and inside ~/Pictures (the only
 * place the extension may write).
 */
export function resolveFolder(text: unknown, home: string): string {
  const raw = String(text ?? "").trim() || "~/Pictures/Generated";
  const path = (raw.startsWith("~") ? `${home}${raw.slice(1)}` : raw).replace(/\/+$/, "");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const clean = `/${parts.join("/")}`;
  const pictures = `${home}/Pictures`;
  if (clean !== pictures && !clean.startsWith(`${pictures}/`)) {
    throw new Error(`The folder must be inside ~/Pictures, not ${raw}: change it in Settings`);
  }
  return clean;
}

export const tilde = (path: string, home: string) =>
  home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;

// ---------------------------------------------------------------------------
// History

export type Generation = {
  id: string;
  path: string;
  prompt: string;
  provider: Provider;
  model: string;
  aspect: Aspect;
  quality?: Quality;
  at: number;
  ms: number;
  width?: number;
  height?: number;
  seed?: number;
  bytes?: number;
};

export function addGeneration(list: Generation[], g: Generation, max = 300): Generation[] {
  return [g, ...list.filter((x) => x.id !== g.id)].slice(0, max);
}

export function removeGeneration(list: Generation[], id: string): Generation[] {
  return list.filter((x) => x.id !== id);
}

/** "12.4 s", "1 min 5 s". */
export function seconds(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A short title for a tile: the prompt's first words. */
export function shortPrompt(prompt: string, max = 40): string {
  const p = prompt.replace(/\s+/g, " ").trim();
  if (p.length <= max) return p;
  const cut = p.slice(0, max);
  return `${cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut}…`;
}
