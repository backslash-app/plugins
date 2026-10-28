// Hugging Face Hub: search URLs, response mapping, model cards and commands. Pure, tested in lib_test.ts.

export type Kind = "model" | "dataset" | "space";

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export const HUB = "https://huggingface.co";

export const KINDS: Record<Kind, { title: string; plural: string; path: string; api: string; tint: Tint }> = {
  model: { title: "Model", plural: "Models", path: "", api: "models", tint: "purple" },
  dataset: { title: "Dataset", plural: "Datasets", path: "datasets/", api: "datasets", tint: "teal" },
  space: { title: "Space", plural: "Spaces", path: "spaces/", api: "spaces", tint: "pink" },
};

/** Fields asked of the list endpoints (`expand[]`): what the rows and side panel show. */
export const EXPAND: Record<Kind, string[]> = {
  model: [
    "author",
    "downloads",
    "likes",
    "lastModified",
    "createdAt",
    "pipeline_tag",
    "library_name",
    "tags",
    "gated",
    "private",
    "gguf",
    "safetensors",
  ],
  dataset: ["author", "downloads", "likes", "lastModified", "createdAt", "tags", "gated", "private", "description"],
  space: ["author", "likes", "lastModified", "createdAt", "tags", "private", "sdk", "cardData", "runtime", "subdomain"],
};

export interface Query {
  text: string;
  /** `gguf` typed in the query: only GGUF repositories. */
  gguf: boolean;
  /** A repository id or page URL was typed: look it up exactly too. */
  exact?: { kind: Kind; id: string };
}

/** `llama gguf`, `meta-llama/Llama-3.1-8B`, `https://huggingface.co/datasets/x/y`. */
export function parseQuery(input: string, kind: Kind): Query {
  let text = input.trim();
  const url = text.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\/(datasets\/|spaces\/)?([^/\s?#]+\/[^/\s?#]+)/,
  );
  if (url) {
    const k: Kind = url[1] === "datasets/" ? "dataset" : url[1] === "spaces/" ? "space" : "model";
    return { text: url[2], gguf: false, exact: { kind: k, id: url[2] } };
  }
  const gguf = kind === "model" && /(^|\s)gguf(\s|$)/i.test(text);
  if (gguf) text = text.replace(/(^|\s)gguf(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
  const exact = /^[\w.-]+\/[\w.-]+$/.test(text) ? { kind, id: text } : undefined;
  return { text, gguf, ...(exact ? { exact } : {}) };
}

export function searchUrl(kind: Kind, q: Query, limit = 30): string {
  const p = new URLSearchParams();
  if (q.text) p.set("search", q.text);
  // No query: what's trending; a query: the most downloaded (Spaces have no download counts).
  p.set("sort", !q.text ? "trendingScore" : kind === "space" ? "likes" : "downloads");
  p.set("direction", "-1");
  p.set("limit", String(limit));
  if (q.gguf) p.set("filter", "gguf");
  for (const e of EXPAND[kind]) p.append("expand[]", e);
  return `${HUB}/api/${KINDS[kind].api}?${p}`;
}

/** The same search without `expand[]`, if the Hub ever rejects a field. */
export const plainSearchUrl = (kind: Kind, q: Query, limit = 30) =>
  searchUrl(kind, q, limit).replace(/&expand%5B%5D=[^&]*/g, "");

export const repoApiUrl = (kind: Kind, id: string) => `${HUB}/api/${KINDS[kind].api}/${id}`;
export const pageUrl = (kind: Kind, id: string) => `${HUB}/${KINDS[kind].path}${id}`;
export const readmeUrl = (kind: Kind, id: string) => `${HUB}/${KINDS[kind].path}${id}/raw/main/README.md`;

export interface Repo {
  kind: Kind;
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  createdAt?: string;
  pipeline?: string;
  library?: string;
  license?: string;
  tags: string[];
  /** "auto", "manual", or false. */
  gated?: string | false;
  private?: boolean;
  gguf?: { architecture?: string; contextLength?: number; total?: number };
  /** Parameter count (safetensors). */
  parameters?: number;
  description?: string;
  // Spaces
  sdk?: string;
  title?: string;
  emoji?: string;
  stage?: string;
  hardware?: string;
  subdomain?: string;
}

/** Tags like `license:mit`, `language:en`, `region:us` carry facts. */
function tagValues(tags: string[], prefix: string): string[] {
  return tags.filter((t) => t.startsWith(`${prefix}:`)).map((t) => t.slice(prefix.length + 1));
}

export function mapRepo(kind: Kind, r: any): Repo {
  const tags: string[] = Array.isArray(r?.tags) ? r.tags.map(String) : [];
  const card = r?.cardData ?? {};
  const license = card.license ?? tagValues(tags, "license")[0];
  const isGguf = kind === "model" && (r?.library_name === "gguf" || tags.includes("gguf") || !!r?.gguf);
  return {
    kind,
    id: String(r?.id ?? r?.modelId ?? ""),
    ...(r?.author ? { author: r.author } : {}),
    ...(typeof r?.downloads === "number" ? { downloads: r.downloads } : {}),
    ...(typeof r?.likes === "number" ? { likes: r.likes } : {}),
    ...(r?.lastModified ? { lastModified: r.lastModified } : {}),
    ...(r?.createdAt ? { createdAt: r.createdAt } : {}),
    ...(r?.pipeline_tag ? { pipeline: r.pipeline_tag } : {}),
    ...(r?.library_name ? { library: r.library_name } : {}),
    ...(license ? { license: Array.isArray(license) ? license.join(", ") : String(license) } : {}),
    tags,
    ...(r?.gated !== undefined ? { gated: r.gated === true ? "auto" : r.gated } : {}),
    ...(r?.private ? { private: true } : {}),
    ...(isGguf
      ? {
        gguf: {
          ...(r?.gguf?.architecture ? { architecture: r.gguf.architecture } : {}),
          ...(r?.gguf?.context_length ? { contextLength: r.gguf.context_length } : {}),
          ...(r?.gguf?.total ? { total: r.gguf.total } : {}),
        },
      }
      : {}),
    ...(r?.safetensors?.total ? { parameters: r.safetensors.total } : {}),
    ...(r?.description ? { description: cleanDescription(r.description) } : {}),
    ...(r?.sdk ?? card.sdk ? { sdk: r?.sdk ?? card.sdk } : {}),
    ...(card.title ? { title: String(card.title) } : {}),
    ...(card.emoji ? { emoji: String(card.emoji) } : {}),
    ...(card.short_description && !r?.description ? { description: String(card.short_description) } : {}),
    ...(r?.runtime?.stage ? { stage: r.runtime.stage } : {}),
    ...(r?.runtime?.hardware?.current ? { hardware: r.runtime.hardware.current } : {}),
    ...(r?.subdomain ? { subdomain: r.subdomain } : {}),
  };
}

/** Dataset descriptions are the README's start, with markup: one readable line. */
export function cleanDescription(s: string): string {
  const text = s.replace(/<[^>]+>/g, " ").replace(/[#*_`>]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Languages, datasets, base models and other facts from the tags. */
export function facts(r: Repo): { languages: string[]; datasets: string[]; baseModels: string[]; tasks: string[] } {
  return {
    languages: tagValues(r.tags, "language").slice(0, 8),
    datasets: tagValues(r.tags, "dataset").slice(0, 5),
    baseModels: tagValues(r.tags, "base_model").map((b) => b.replace(/^(finetune|quantized|adapter|merge):/, ""))
      .filter((b, i, a) => a.indexOf(b) === i).slice(0, 3),
    tasks: tagValues(r.tags, "task_categories").slice(0, 5),
  };
}

/** Tags worth showing as pills (without `key:value` ones). */
export const plainTags = (r: Repo) =>
  r.tags.filter((t) => !t.includes(":") && t !== r.library && t !== r.pipeline && t !== r.sdk).slice(0, 10);

// ---------------------------------------------------------------------------
// Model cards

/** The README without its YAML front matter, HTML and badges, cut after `maxLines`. */
export function modelCard(md: string, maxLines = 100): string {
  let text = md.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  text = text.replace(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/, "");
  text = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(
      /<\/?(p|div|center|span|picture|source|sup|sub|details|summary|table|thead|tbody|tr|td|th|h\d)[^>]*>/gi,
      "",
    );
  const lines = text.split("\n").filter((l) => !/^\s*(\[?!\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?\s*)+$/.test(l));
  const out: string[] = [];
  let blank = false;
  let cut = false;
  for (const [i, l] of lines.entries()) {
    if (!l.trim()) {
      if (!blank && out.length) out.push("");
      blank = true;
      continue;
    }
    blank = false;
    out.push(l.replace(/\s+$/, ""));
    if (out.length >= maxLines) {
      cut = lines.slice(i + 1).some((rest) => rest.trim());
      break;
    }
  }
  if (out.filter((l) => l.trim().startsWith("```")).length % 2) out.push("```");
  const body = out.join("\n").trim();
  return cut ? `${body}\n\n…` : body;
}

// ---------------------------------------------------------------------------
// Commands to copy

export interface Snippet {
  title: string;
  text: string;
}

export function snippets(r: Repo): Snippet[] {
  const out: Snippet[] = [];
  const type = r.kind === "model" ? "" : ` --repo-type ${r.kind}`;
  out.push({ title: "huggingface-cli download", text: `huggingface-cli download ${r.id}${type}` });
  out.push({ title: "hf download", text: `hf download ${r.id}${type}` });
  if (r.kind === "model" && r.gguf) {
    out.push({ title: "ollama run", text: `ollama run hf.co/${r.id}` });
    out.push({ title: "llama-server", text: `llama-server -hf ${r.id}` });
  }
  if (r.kind === "model" && r.library === "transformers" && r.pipeline) {
    out.push({
      title: "Transformers pipeline",
      text: `from transformers import pipeline\n\npipe = pipeline("${r.pipeline}", model="${r.id}")`,
    });
  }
  if (r.kind === "model" && r.library === "diffusers") {
    out.push({
      title: "Diffusers pipeline",
      text: `from diffusers import DiffusionPipeline\n\npipe = DiffusionPipeline.from_pretrained("${r.id}")`,
    });
  }
  if (r.kind === "model" && r.library === "sentence-transformers") {
    out.push({
      title: "Sentence Transformers",
      text: `from sentence_transformers import SentenceTransformer\n\nmodel = SentenceTransformer("${r.id}")`,
    });
  }
  if (r.kind === "dataset") {
    out.push({ title: "load_dataset", text: `from datasets import load_dataset\n\nds = load_dataset("${r.id}")` });
  }
  out.push({ title: "git clone", text: `git clone ${pageUrl(r.kind, r.id)}` });
  return out;
}

/** The Space's running app, when it has one. */
export const spaceAppUrl = (r: Repo) => r.subdomain ? `https://${r.subdomain}.hf.space` : undefined;

// ---------------------------------------------------------------------------
// Formatting

export function compact(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1000) return String(n);
  const units = ["K", "M", "B", "T"];
  let v = n;
  let i = -1;
  while (v >= 1000 && i < units.length - 1) v /= 1000, i++;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}${units[i]}`;
}

/** 8030261248 → "8B params", 494032768 → "494M params". */
export const paramsLabel = (n: number | undefined) => n ? `${compact(n)} params` : "";

export function relativeDate(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const d = Math.floor(Math.max(0, now - t) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 45) return `${d} days ago`;
  const months = Math.floor(d / 30);
  if (d < 730) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(d / 365)} years ago`;
}

/** `text-generation` → "Text Generation". */
export const humanize = (s: string) => s.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export const gatedLabel = (g: string | false | undefined) =>
  g === "manual" ? "Gated, manual approval" : g ? "Gated, automatic approval" : "";
