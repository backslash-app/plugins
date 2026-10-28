import { buildRequest, errorMessage, type Message, parseEvent, type Prefs, provider, sseEvents } from "./lib.ts";

/** Streams an answer, yielding the whole text so far. */
export async function* answer(
  prefs: Prefs,
  system: string,
  messages: Message[],
  signal: AbortSignal,
  effort?: "low" | "medium" | "high",
): AsyncGenerator<string> {
  const p = provider(prefs);
  if (p.needsKey && !prefs.api_key) {
    throw new Error(`Add your ${p.name} API key in Settings → Extensions → AI → Configure`);
  }
  const req = buildRequest(p, prefs.api_key, system, messages, effort);
  let res: Response;
  try {
    res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (err) {
    if (p.id === "ollama") throw new Error("Ollama is not running (ollama serve)");
    throw err;
  }
  if (!res.ok || !res.body) throw new Error(errorMessage(res.status, await res.text()));
  let text = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const { data, rest } = sseEvents(buffer);
    buffer = rest;
    for (const d of data) {
      const delta = parseEvent(p.kind, d);
      if (delta.error) throw new Error(delta.error);
      if (delta.refused) {
        yield (text += `${text ? "\n\n" : ""}_The model declined to answer._`);
        return;
      }
      if (delta.text) yield (text += delta.text);
      if (delta.done) return;
    }
  }
}

export const modelName = (prefs: Prefs) => {
  const p = provider(prefs);
  return `${p.name} · ${p.model}`;
};
