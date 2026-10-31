import { assert, assertEquals } from "@std/assert";
import {
  blended,
  comparison,
  cost,
  curlSnippet,
  hasReasoning,
  hasTools,
  modalities,
  modelUrl,
  money,
  parseModels,
  perMillion,
  price,
  priceColor,
  priceText,
  select,
  stale,
  toggle,
  tokens,
} from "./lib.ts";

// openrouter.ai/api/v1/models (abridged).
const MODELS = {
  data: [
    {
      id: "anthropic/claude-sonnet-4.5",
      canonical_slug: "anthropic/claude-4.5-sonnet-20250929",
      hugging_face_id: "",
      name: "Anthropic: Claude Sonnet 4.5",
      created: 1759161676,
      description: "Claude Sonnet 4.5 is Anthropic's most advanced Sonnet model to date.",
      context_length: 1000000,
      architecture: {
        modality: "text+image->text",
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text"],
        tokenizer: "Claude",
        instruct_type: null,
      },
      pricing: {
        prompt: "0.000003",
        completion: "0.000015",
        request: "0",
        image: "0.0048",
        web_search: "0.01",
        internal_reasoning: "0",
        input_cache_read: "0.0000003",
        input_cache_write: "0.00000375",
      },
      top_provider: { context_length: 1000000, max_completion_tokens: 64000, is_moderated: true },
      per_request_limits: null,
      supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "temperature", "tool_choice", "tools"],
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Meta: Llama 3.3 70B Instruct (free)",
      created: 1733506137,
      description: "",
      context_length: 131072,
      architecture: { modality: "text->text", tokenizer: "Llama3" },
      pricing: { prompt: "0", completion: "0", request: "0", image: "0" },
      top_provider: { context_length: 131072, max_completion_tokens: null, is_moderated: false },
      supported_parameters: ["max_tokens", "temperature"],
      hugging_face_id: "meta-llama/Llama-3.3-70B-Instruct",
    },
    {
      id: "google/gemini-2.5-flash-image",
      name: "Google: Gemini 2.5 Flash Image (Nano Banana)",
      created: 1759870431,
      context_length: 32768,
      architecture: {
        modality: "text+image->text+image",
        input_modalities: ["image", "text"],
        output_modalities: ["image", "text"],
      },
      pricing: { prompt: "0.0000003", completion: "0.0000025", image: "0.001238" },
      top_provider: { context_length: 32768, max_completion_tokens: 8192 },
      supported_parameters: ["max_tokens", "response_format", "structured_outputs"],
    },
    {
      id: "openrouter/auto",
      name: "Auto Router",
      created: 1699401600,
      context_length: 2000000,
      architecture: { modality: "text->text" },
      pricing: { prompt: "-1", completion: "-1" },
      top_provider: {},
    },
    {
      id: "deepseek/deepseek-chat-v3.1",
      name: "DeepSeek: DeepSeek V3.1",
      created: 1755779628,
      context_length: 163840,
      architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000002", completion: "0.0000008" },
      top_provider: { context_length: 163840 },
      supported_parameters: ["reasoning", "tools"],
    },
    { id: "deepseek/deepseek-chat-v3.1", name: "duplicate" },
    { name: "no id" },
  ],
};

const models = () => parseModels(MODELS);
const byId = (id: string) => models().find((m) => m.id === id)!;

Deno.test("models", () => {
  const all = models();
  assertEquals(all.length, 5);
  const c = byId("anthropic/claude-sonnet-4.5");
  assertEquals(c.name, "Claude Sonnet 4.5");
  assertEquals(c.provider, "anthropic");
  assertEquals(c.providerName, "Anthropic");
  assertEquals(c.created, 1759161676000);
  assertEquals(c.context, 1000000);
  assertEquals(c.maxOutput, 64000);
  assertEquals(c.input, ["text", "image", "file"]);
  assertEquals([c.inPrice, c.outPrice, c.cacheRead, c.cacheWrite], [3, 15, 0.3, 3.75]);
  assertEquals(c.imagePrice, 0.0048);
  assertEquals(c.requestPrice, undefined);
  assertEquals(c.reasoningPrice, undefined);
  assertEquals(c.huggingFace, undefined);
  assertEquals(c.moderated, true);
  assert(hasReasoning(c) && hasTools(c));

  const free = byId("meta-llama/llama-3.3-70b-instruct:free");
  assertEquals(free.free, true);
  assertEquals(free.providerName, "Meta");
  assertEquals(free.name, "Llama 3.3 70B Instruct (free)");
  assertEquals(free.input, ["text"]);
  assertEquals(free.maxOutput, undefined);
  assertEquals(free.huggingFace, "meta-llama/Llama-3.3-70B-Instruct");

  const img = byId("google/gemini-2.5-flash-image");
  assertEquals(img.output, ["image", "text"]);

  const auto = byId("openrouter/auto");
  assertEquals(auto.variable, true);
  assertEquals(auto.free, false);
  assertEquals(auto.inPrice, undefined);
  assertEquals(auto.providerName, "OpenRouter");
  assertEquals(auto.name, "Auto Router");

  assertEquals(parseModels({}), []);
  assertEquals(parseModels(null), []);
});

Deno.test("prices per million tokens", () => {
  assertEquals(perMillion("0.000003"), 3);
  assertEquals(perMillion("0.00000015"), 0.15);
  assertEquals(perMillion("0.0000000375"), 0.0375);
  assertEquals(perMillion("0"), 0);
  assertEquals(perMillion("-1"), undefined);
  assertEquals(perMillion(""), undefined);
  assertEquals(perMillion("abc"), undefined);
  assertEquals(price(3), "$3");
  assertEquals(price(15), "$15");
  assertEquals(price(1.25), "$1.25");
  assertEquals(price(0.15), "$0.15");
  assertEquals(price(0.0375), "$0.0375");
  assertEquals(price(150), "$150");
  assertEquals(price(0), "free");
  assertEquals(price(undefined), "–");
  assertEquals(priceText(byId("anthropic/claude-sonnet-4.5")), "$3 / $15");
  assertEquals(priceText(byId("openrouter/auto")), "varies");
  assertEquals(priceText(byId("meta-llama/llama-3.3-70b-instruct:free")), "free");
});

Deno.test("costs", () => {
  const c = byId("anthropic/claude-sonnet-4.5");
  assertEquals(cost(c, 10_000, 1000), 0.045);
  assertEquals(money(0.045), "$0.045");
  assertEquals(money(12.3), "$12.30");
  assertEquals(money(0.0000412), "$0.000041");
  assertEquals(money(0), "free");
  assertEquals(cost(byId("openrouter/auto"), 1000, 1000), undefined);
  assertEquals(blended(c), 6);
  assertEquals(priceColor(c), "orange");
  assertEquals(priceColor(byId("deepseek/deepseek-chat-v3.1")), "green");
  assertEquals(priceColor(byId("meta-llama/llama-3.3-70b-instruct:free")), "green");
  assertEquals(priceColor(byId("openrouter/auto")), "gray");
});

Deno.test("tokens", () => {
  assertEquals(tokens(1_000_000), "1M");
  assertEquals(tokens(1_048_576), "1M");
  assertEquals(tokens(2_000_000), "2M");
  assertEquals(tokens(1_500_000), "1.5M");
  assertEquals(tokens(200_000), "200K");
  assertEquals(tokens(131_072), "131K");
  assertEquals(tokens(512), "512");
  assertEquals(tokens(undefined), "–");
});

Deno.test("views", () => {
  const all = models();
  const ids = (view: string) => select(all, view).map((m) => m.id);
  assertEquals(ids("newest"), [
    "google/gemini-2.5-flash-image",
    "anthropic/claude-sonnet-4.5",
    "deepseek/deepseek-chat-v3.1",
    "meta-llama/llama-3.3-70b-instruct:free",
    "openrouter/auto",
  ]);
  // Free and variable prices are left out of the cheapest view.
  assertEquals(ids("cheapest"), [
    "deepseek/deepseek-chat-v3.1",
    "google/gemini-2.5-flash-image",
    "anthropic/claude-sonnet-4.5",
  ]);
  assertEquals(ids("context")[0], "openrouter/auto");
  assertEquals(ids("free"), ["meta-llama/llama-3.3-70b-instruct:free"]);
  assertEquals(ids("vision"), ["google/gemini-2.5-flash-image", "anthropic/claude-sonnet-4.5"]);
  assertEquals(ids("image"), ["google/gemini-2.5-flash-image"]);
  assertEquals(ids("reasoning"), ["anthropic/claude-sonnet-4.5", "deepseek/deepseek-chat-v3.1"]);
  assertEquals(ids("tools"), ["anthropic/claude-sonnet-4.5", "deepseek/deepseek-chat-v3.1"]);
  assertEquals(ids("audio"), []);
  assertEquals(select(all, "providers").map((m) => m.providerName), [
    "Anthropic",
    "DeepSeek",
    "Google",
    "Meta",
    "OpenRouter",
  ]);
  assertEquals(ids("unknown"), ids("newest"));
});

Deno.test("comparison", () => {
  const table = comparison([byId("anthropic/claude-sonnet-4.5"), byId("deepseek/deepseek-chat-v3.1")], 10_000, 1000);
  const lines = table.split("\n");
  assertEquals(lines[0], "| | Claude Sonnet 4.5 | DeepSeek V3.1 |");
  assertEquals(lines[3], "| Input / M | $3 | **$0.2** |");
  assertEquals(lines[5], "| 10K in + 1K out | $0.045 | **$0.0028** |");
  assertEquals(lines[6], "| Context | **1M** | 164K |");
  assert(table.includes("| Reasoning | yes | yes |"));
  assert(comparison([], 1, 1).startsWith("_Nothing"));
  assertEquals(toggle(["a", "b"], "a"), ["b"]);
  assertEquals(toggle(["a", "b"], "c"), ["a", "b", "c"]);
  assertEquals(toggle(["a", "b", "c", "d"], "e"), ["b", "c", "d", "e"]);
});

Deno.test("links, snippets, cache age", () => {
  assertEquals(
    modelUrl("meta-llama/llama-3.3-70b-instruct:free"),
    "https://openrouter.ai/meta-llama/llama-3.3-70b-instruct",
  );
  assert(curlSnippet("openai/gpt-5").includes('"model": "openai/gpt-5"'));
  assertEquals(modalities(["text", "image", "file"]), "Text, Image, Files");
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(stale(undefined, now), true);
  assertEquals(stale(now - 3600_000, now), false);
  assertEquals(stale(now - 7 * 3600_000, now), true);
});
