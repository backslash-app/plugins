import { assertEquals, assertThrows } from "@std/assert";
import { buildRequest, errorMessage, parseEvent, provider, sseEvents, supportsEffort } from "./lib.ts";

Deno.test("providers and defaults", () => {
  assertEquals(provider({}).model, "claude-opus-5-5");
  assertEquals(provider({ provider: "Ollama", model: "qwen3" }).model, "qwen3");
  assertThrows(() => provider({ provider: "nope" }));
});

Deno.test("anthropic request", () => {
  const r = buildRequest(provider({}), "sk", "sys", [{ role: "user", content: "hi" }], "low");
  assertEquals(r.url, "https://api.anthropic.com/v1/messages");
  assertEquals(r.headers["anthropic-version"], "2026-10-21");
  assertEquals(r.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assertEquals(r.body.fallbacks, "default");
  assertEquals(r.body.output_config, { effort: "low" });
  assertEquals(r.body.system, "sys");
  const old = buildRequest(provider({ model: "claude-haiku-4-5" }), "sk", "s", [], "low");
  assertEquals([old.body.output_config, old.body.fallbacks], [undefined, undefined]);
  assertEquals([supportsEffort("claude-sonnet-5-5"), supportsEffort("claude-3-5-haiku")], [true, false]);
});

Deno.test("openai-compatible request", () => {
  const r = buildRequest(provider({ provider: "ollama" }), undefined, "sys", [{ role: "user", content: "hi" }]);
  assertEquals(r.url, "http://localhost:11434/v1/chat/completions");
  assertEquals(r.headers.authorization, undefined);
  assertEquals((r.body.messages as unknown[]).length, 2);
});

Deno.test("server-sent events", () => {
  const { data, rest } = sseEvents('event: a\ndata: {"x":1}\n\ndata: [DONE]\n\ndata: {"partial');
  assertEquals([data, rest], [['{"x":1}', "[DONE]"], 'data: {"partial']);
});

Deno.test("deltas", () => {
  assertEquals(
    parseEvent("anthropic", '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}'),
    { text: "Hi" },
  );
  assertEquals(parseEvent("anthropic", '{"type":"message_delta","delta":{"stop_reason":"refusal"}}'), {
    refused: true,
  });
  assertEquals(parseEvent("anthropic", '{"type":"error","error":{"message":"Overloaded"}}'), { error: "Overloaded" });
  assertEquals(parseEvent("openai", '{"choices":[{"delta":{"content":"Yo"}}]}'), { text: "Yo" });
  assertEquals(parseEvent("openai", "[DONE]"), { done: true });
  assertEquals(errorMessage(401, '{"error":{"message":"invalid x-api-key"}}'), "401: invalid x-api-key");
});
