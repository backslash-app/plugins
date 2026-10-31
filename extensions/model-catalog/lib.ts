// OpenRouter's `/api/v1/models`: prices, context, modalities, sorting and comparing. No I/O here.

import type { Color } from "@backslash/api";

export type Model = {
  id: string;
  /** Without the "Provider: " prefix OpenRouter puts in names. */
  name: string;
  /** `anthropic` in `anthropic/claude-sonnet-4`. */
  provider: string;
  /** "Anthropic", from the name's prefix when there is one. */
  providerName: string;
  description: string;
  /** Milliseconds. */
  created?: number;
  context?: number;
  maxOutput?: number;
  input: string[];
  output: string[];
  /** US dollars per million tokens; undefined when unknown or variable (routers). */
  inPrice?: number;
  outPrice?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoningPrice?: number;
  /** Dollars per request and per input image, when charged. */
  requestPrice?: number;
  imagePrice?: number;
  free: boolean;
  /** The price depends on the model it routes to. */
  variable: boolean;
  tokenizer?: string;
  parameters: string[];
  huggingFace?: string;
  moderated?: boolean;
};

const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

/** "0.000003" per token → 3 per million; "-1" (variable) and garbage → undefined. */
export function perMillion(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  // Floating point: 0.000003 * 1e6 = 2.9999999999999996.
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

/** Per request or per image: dollars as they come, 0 dropped. */
function dollars(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "meta-llama": "Meta",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  "x-ai": "xAI",
  cohere: "Cohere",
  amazon: "Amazon",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  perplexity: "Perplexity",
  moonshotai: "Moonshot AI",
  "z-ai": "Z.AI",
  openrouter: "OpenRouter",
};

export function parseModel(m: any): Model | undefined {
  const id = str(m?.id);
  if (!id) return undefined;
  const provider = id.includes("/") ? id.slice(0, id.indexOf("/")) : "other";
  const rawName = str(m.name) ?? id;
  const colon = /^([^:]{1,40}):\s+(.+)$/.exec(rawName);
  const arch = m.architecture ?? {};
  const modality = str(arch.modality) ?? "text->text";
  const [ins, outs] = modality.split("->");
  const input: string[] = Array.isArray(arch.input_modalities)
    ? arch.input_modalities.map(String)
    : (ins ?? "text").split("+");
  const output: string[] = Array.isArray(arch.output_modalities)
    ? arch.output_modalities.map(String)
    : (outs ?? "text").split("+");
  const p = m.pricing ?? {};
  const inPrice = perMillion(p.prompt), outPrice = perMillion(p.completion);
  const variable = Number(p.prompt) < 0 || Number(p.completion) < 0;
  const created = num(m.created);
  return {
    id,
    name: colon ? colon[2] : rawName,
    provider,
    providerName: colon ? colon[1] : PROVIDER_NAMES[provider] ?? provider,
    description: str(m.description) ?? "",
    created: created ? created * 1000 : undefined,
    context: num(m.context_length) ?? num(m.top_provider?.context_length),
    maxOutput: num(m.top_provider?.max_completion_tokens),
    input,
    output,
    inPrice,
    outPrice,
    cacheRead: perMillion(p.input_cache_read) || undefined,
    cacheWrite: perMillion(p.input_cache_write) || undefined,
    reasoningPrice: perMillion(p.internal_reasoning) || undefined,
    requestPrice: dollars(p.request),
    imagePrice: dollars(p.image),
    free: !variable && inPrice === 0 && outPrice === 0,
    variable,
    tokenizer: str(arch.tokenizer),
    parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters.map(String) : [],
    huggingFace: str(m.hugging_face_id),
    moderated: typeof m.top_provider?.is_moderated === "boolean" ? m.top_provider.is_moderated : undefined,
  };
}

/** `{ data: [...] }` → the models, duplicates dropped. */
export function parseModels(json: any): Model[] {
  const data: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const seen = new Set<string>();
  const out: Model[] = [];
  for (const raw of data) {
    const m = parseModel(raw);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Views

export const VIEWS = [
  { value: "newest", title: "Newest" },
  { value: "cheapest", title: "Cheapest" },
  { value: "context", title: "Largest Context" },
  { value: "providers", title: "By Provider" },
  { value: "free", title: "Free" },
  { value: "vision", title: "Vision" },
  { value: "reasoning", title: "Reasoning" },
  { value: "tools", title: "Tools" },
  { value: "image", title: "Image Output" },
  { value: "audio", title: "Audio" },
] as const;

export type View = typeof VIEWS[number]["value"];

/** A single price to sort by: three input tokens for one output token, as most chats go. */
export function blended(m: Pick<Model, "inPrice" | "outPrice">): number | undefined {
  if (m.inPrice === undefined || m.outPrice === undefined) return undefined;
  return (3 * m.inPrice + m.outPrice) / 4;
}

export const hasReasoning = (m: Model) =>
  m.parameters.includes("reasoning") || m.parameters.includes("include_reasoning");
export const hasTools = (m: Model) => m.parameters.includes("tools");

/** The models a view shows, in its order. */
export function select(models: Model[], view: string): Model[] {
  const byNewest = (a: Model, b: Model) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id);
  switch (view) {
    case "cheapest":
      return models
        .filter((m) => blended(m) !== undefined && !m.free)
        .sort((a, b) => blended(a)! - blended(b)! || (b.context ?? 0) - (a.context ?? 0));
    case "context":
      return models.filter((m) => m.context).sort((a, b) => b.context! - a.context! || byNewest(a, b));
    case "providers":
      return [...models].sort((a, b) => a.providerName.localeCompare(b.providerName) || byNewest(a, b));
    case "free":
      return models.filter((m) => m.free).sort(byNewest);
    case "vision":
      return models.filter((m) => m.input.includes("image")).sort(byNewest);
    case "reasoning":
      return models.filter(hasReasoning).sort(byNewest);
    case "tools":
      return models.filter(hasTools).sort(byNewest);
    case "image":
      return models.filter((m) => m.output.includes("image")).sort(byNewest);
    case "audio":
      return models.filter((m) => m.input.includes("audio") || m.output.includes("audio")).sort(byNewest);
    default:
      return [...models].sort(byNewest);
  }
}

// ---------------------------------------------------------------------------
// Formatting

/** 3 → "$3", 0.15 → "$0.15", 0.0375 → "$0.0375", 0 → "free". */
export function price(n: number | undefined): string {
  if (n === undefined) return "–";
  if (n === 0) return "free";
  if (n >= 100) return `$${Math.round(n)}`;
  if (n >= 1) return `$${Number(n.toFixed(2))}`;
  return `$${Number(n.toPrecision(3))}`;
}

/** "$3 / $15" per million tokens in and out. */
export function priceText(m: Model): string {
  if (m.variable) return "varies";
  if (m.free) return "free";
  return `${price(m.inPrice)} / ${price(m.outPrice)}`;
}

/** 200000 → "200K", 1048576 → "1M", 131072 → "131K". */
export function tokens(n: number | undefined): string {
  if (!n) return "–";
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(n % 1_000_000 < 50_000 ? 0 : 1))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** What a request of `inTok` + `outTok` tokens costs, in dollars. */
export function cost(m: Model, inTok: number, outTok: number): number | undefined {
  if (m.variable || m.inPrice === undefined || m.outPrice === undefined) return undefined;
  return (m.inPrice * inTok + m.outPrice * outTok) / 1e6 + (m.requestPrice ?? 0);
}

/** $0.0123 → "$0.0123", $0.00004 → "$0.00004", $12.3 → "$12.30". */
export function money(n: number | undefined): string {
  if (n === undefined) return "–";
  if (n === 0) return "free";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${Number(n.toPrecision(2))}`;
}

export function priceColor(m: Model): Color {
  const b = blended(m);
  if (m.free) return "green";
  if (b === undefined) return "gray";
  if (b < 0.5) return "green";
  if (b < 3) return "teal";
  if (b < 10) return "orange";
  return "red";
}

export const MODALITY_TITLE: Record<string, string> = {
  text: "Text",
  image: "Image",
  audio: "Audio",
  video: "Video",
  file: "Files",
};

export function modalities(list: string[]): string {
  return list.map((m) => MODALITY_TITLE[m] ?? m).join(", ");
}

export function date(ms: number | undefined): string {
  return ms ? new Date(ms).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "–";
}

export const modelUrl = (id: string) => `https://openrouter.ai/${id.replace(/:free$/, "")}`;

/** A ready-to-run request, for the clipboard. */
export function curlSnippet(id: string): string {
  return [
    "curl https://openrouter.ai/api/v1/chat/completions \\",
    '  -H "Authorization: Bearer $OPENROUTER_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model": "${id}", "messages": [{"role": "user", "content": "Hello"}]}'`,
  ].join("\n");
}

/** Markdown table of a few models side by side; the best value of each line in bold. */
export function comparison(models: Model[], inTok: number, outTok: number): string {
  if (!models.length) return "_Nothing to compare yet: add models with Ctrl+M._";
  const best = (values: (number | undefined)[], low: boolean) => {
    const known = values.filter((v): v is number => v !== undefined);
    return known.length > 1 ? (low ? Math.min(...known) : Math.max(...known)) : undefined;
  };
  const row = (title: string, values: (number | undefined)[], fmt: (n: number | undefined) => string, low: boolean) => {
    const b = best(values, low);
    return `| ${title} | ${values.map((v) => (v !== undefined && v === b ? `**${fmt(v)}**` : fmt(v))).join(" | ")} |`;
  };
  return [
    `| | ${models.map((m) => m.name).join(" | ")} |`,
    `| --- | ${models.map(() => "---:").join(" | ")} |`,
    `| Provider | ${models.map((m) => m.providerName).join(" | ")} |`,
    row("Input / M", models.map((m) => (m.variable ? undefined : m.inPrice)), price, true),
    row("Output / M", models.map((m) => (m.variable ? undefined : m.outPrice)), price, true),
    row(`${tokens(inTok)} in + ${tokens(outTok)} out`, models.map((m) => cost(m, inTok, outTok)), money, true),
    row("Context", models.map((m) => m.context), tokens, false),
    row("Max output", models.map((m) => m.maxOutput), tokens, false),
    `| Input | ${models.map((m) => modalities(m.input)).join(" | ")} |`,
    `| Output | ${models.map((m) => modalities(m.output)).join(" | ")} |`,
    `| Reasoning | ${models.map((m) => (hasReasoning(m) ? "yes" : "–")).join(" | ")} |`,
    `| Tools | ${models.map((m) => (hasTools(m) ? "yes" : "–")).join(" | ")} |`,
    `| Released | ${models.map((m) => date(m.created)).join(" | ")} |`,
  ].join("\n");
}

/** Adds or removes `id`, keeping at most `max` (the oldest one leaves). */
export function toggle(ids: string[], id: string, max = 4): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return [...ids, id].slice(-max);
}

export const CACHE_HOURS = 6;

export function stale(at: number | undefined, now = Date.now()): boolean {
  return !at || now - at > CACHE_HOURS * 3600_000;
}
