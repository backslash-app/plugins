// Providers and streaming formats. Pure, tested in lib_test.ts.

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Prefs {
  provider?: string;
  api_key?: string;
  model?: string;
  language?: string;
  translate_to?: string;
}

export interface Provider {
  id: string;
  name: string;
  kind: "anthropic" | "openai";
  base: string;
  model: string;
  needsKey: boolean;
}

const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Claude",
    kind: "anthropic",
    base: "https://api.anthropic.com",
    model: "claude-opus-5-5",
    needsKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    base: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    needsKey: true,
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai",
    base: "https://api.mistral.ai/v1",
    model: "mistral-medium-latest",
    needsKey: true,
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai",
    base: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    base: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    needsKey: true,
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "openai",
    base: "http://localhost:11434/v1",
    model: "llama3.2",
    needsKey: false,
  },
];

export function provider(prefs: Prefs): Provider & { model: string } {
  const id = (prefs.provider ?? "anthropic").trim().toLowerCase() || "anthropic";
  const p = PROVIDERS.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown provider “${id}”: use ${PROVIDERS.map((p) => p.id).join(", ")}`);
  return { ...p, model: prefs.model?.trim() || p.model };
}

/** Claude models that take `output_config.effort`. */
export const supportsEffort = (model: string) =>
  /^claude-(fable|mythos)-/.test(model) || /^claude-(opus|sonnet|haiku)-(5(-\d+)?|4-[6-9])$/.test(model) ||
  model === "claude-opus-4-5";

/** Claude models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
export const supportsFallbacks = (model: string) =>
  ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"].includes(model);

export interface Request {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** The HTTP request streaming an answer. */
export function buildRequest(
  p: Provider,
  key: string | undefined,
  system: string,
  messages: Message[],
  effort?: "low" | "medium" | "high",
): Request {
  if (p.kind === "anthropic") {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": key ?? "",
      "anthropic-version": "2026-10-21",
    };
    const body: Record<string, unknown> = { model: p.model, max_tokens: 32000, stream: true, system, messages };
    if (effort && supportsEffort(p.model)) body.output_config = { effort };
    if (supportsFallbacks(p.model)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    return { url: `${p.base}/v1/messages`, headers, body };
  }
  return {
    url: `${p.base}/chat/completions`,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: { model: p.model, stream: true, messages: [{ role: "system", content: system }, ...messages] },
  };
}

/** Splits a server-sent events buffer into complete events' data, and the rest. */
export function sseEvents(buffer: string): { data: string[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  const data = parts.map((event) =>
    event.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n")
  ).filter(Boolean);
  return { data, rest };
}

export type Delta = { text?: string; refused?: boolean; error?: string; done?: boolean };

/** The text (or end) carried by one event's data. */
export function parseEvent(kind: Provider["kind"], data: string): Delta {
  if (kind === "openai") {
    if (data === "[DONE]") return { done: true };
    const json = JSON.parse(data);
    if (json.error) return { error: json.error.message ?? String(json.error) };
    return { text: json.choices?.[0]?.delta?.content ?? undefined };
  }
  const json = JSON.parse(data);
  switch (json.type) {
    case "content_block_delta":
      return json.delta?.type === "text_delta" ? { text: json.delta.text } : {};
    case "message_delta":
      return json.delta?.stop_reason === "refusal" ? { refused: true } : {};
    case "message_stop":
      return { done: true };
    case "error":
      return { error: json.error?.message ?? "the provider returned an error" };
    default:
      return {};
  }
}

/** A readable message from an error response body. */
export function errorMessage(status: number, body: string): string {
  try {
    const json = JSON.parse(body);
    const message = json.error?.message ?? json.message ?? json.error;
    if (typeof message === "string") return `${status}: ${message}`;
  } catch { /* not JSON */ }
  return `${status}: ${body.slice(0, 200) || "request failed"}`;
}

export const languageRule = (prefs: Prefs) =>
  prefs.language?.trim() ? `Answer in ${prefs.language.trim()}.` : "Answer in the language of the user's message.";
