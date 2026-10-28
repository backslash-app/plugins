import { assert, assertEquals } from "@std/assert";
import {
  compact,
  facts,
  gatedLabel,
  humanize,
  mapRepo,
  modelCard,
  pageUrl,
  paramsLabel,
  parseQuery,
  plainSearchUrl,
  plainTags,
  readmeUrl,
  relativeDate,
  repoApiUrl,
  searchUrl,
  snippets,
  spaceAppUrl,
} from "./lib.ts";

// huggingface.co is not reachable from the test machine: these follow the Hub API's documented shapes
// (GET /api/models|datasets|spaces with expand[]), with real ids and values.
const MODEL = {
  _id: "6696ab0f0bdf7d6f2e1e8b39",
  id: "meta-llama/Llama-3.1-8B-Instruct",
  author: "meta-llama",
  downloads: 5214788,
  likes: 4632,
  lastModified: "2024-09-25T17:00:57.000Z",
  createdAt: "2024-07-18T08:56:00.000Z",
  pipeline_tag: "text-generation",
  library_name: "transformers",
  gated: "manual",
  private: false,
  tags: [
    "transformers",
    "safetensors",
    "llama",
    "text-generation",
    "facebook",
    "meta",
    "pytorch",
    "llama-3",
    "conversational",
    "en",
    "de",
    "base_model:meta-llama/Llama-3.1-8B",
    "base_model:finetune:meta-llama/Llama-3.1-8B",
    "license:llama3.1",
    "text-generation-inference",
    "endpoints_compatible",
    "region:us",
  ],
  safetensors: { parameters: { BF16: 8030261248 }, total: 8030261248 },
};
const GGUF = {
  id: "bartowski/Qwen2.5-7B-Instruct-GGUF",
  author: "bartowski",
  downloads: 95631,
  likes: 112,
  lastModified: "2024-09-19T03:27:44.000Z",
  pipeline_tag: "text-generation",
  library_name: "gguf",
  tags: ["gguf", "chat", "text-generation", "en", "base_model:Qwen/Qwen2.5-7B-Instruct", "license:apache-2.0"],
  gguf: { total: 7615616512, architecture: "qwen2", context_length: 32768 },
  gated: false,
};
const DATASET = {
  id: "HuggingFaceFW/fineweb",
  author: "HuggingFaceFW",
  downloads: 241550,
  likes: 2196,
  lastModified: "2025-01-31T14:10:44.000Z",
  gated: false,
  private: false,
  description:
    '\n\t\n\t\t\n\t\t🍷 FineWeb\n\t\n\n<center>\n    <img src="https://x/banner.png" alt="FineWeb">\n</center>\n\n15 trillion tokens of the finest data the 🌐 web has to offer',
  tags: [
    "task_categories:text-generation",
    "language:en",
    "license:odc-by",
    "size_categories:10B<n<100B",
    "format:parquet",
    "region:us",
  ],
};
const SPACE = {
  id: "black-forest-labs/FLUX.1-dev",
  author: "black-forest-labs",
  likes: 9876,
  lastModified: "2025-06-02T09:12:00.000Z",
  sdk: "gradio",
  subdomain: "black-forest-labs-flux-1-dev",
  tags: ["gradio", "region:us"],
  cardData: {
    title: "FLUX.1 [dev]",
    emoji: "🖥️",
    colorFrom: "yellow",
    colorTo: "pink",
    sdk: "gradio",
    license: "mit",
    short_description: "12B param rectified flow transformer guidance-distilled",
  },
  runtime: { stage: "RUNNING", hardware: { current: "zero-a10g", requested: "zero-a10g" } },
};

Deno.test("parseQuery reads ids, page URLs and the gguf word", () => {
  assertEquals(parseQuery("llama", "model"), { text: "llama", gguf: false });
  assertEquals(parseQuery("  qwen gguf ", "model"), { text: "qwen", gguf: true });
  assertEquals(parseQuery("gguf", "model"), { text: "", gguf: true });
  assertEquals(parseQuery("qwen gguf", "dataset"), { text: "qwen gguf", gguf: false });
  assertEquals(parseQuery("meta-llama/Llama-3.1-8B", "model"), {
    text: "meta-llama/Llama-3.1-8B",
    gguf: false,
    exact: { kind: "model", id: "meta-llama/Llama-3.1-8B" },
  });
  assertEquals(parseQuery("https://huggingface.co/datasets/HuggingFaceFW/fineweb/tree/main", "model"), {
    text: "HuggingFaceFW/fineweb",
    gguf: false,
    exact: { kind: "dataset", id: "HuggingFaceFW/fineweb" },
  });
  assertEquals(parseQuery("hf.co/spaces/a/b", "model").exact, { kind: "space", id: "a/b" });
});

Deno.test("search URLs", () => {
  const url = new URL(searchUrl("model", { text: "llama", gguf: true }));
  assertEquals(url.pathname, "/api/models");
  assertEquals(url.searchParams.get("search"), "llama");
  assertEquals(url.searchParams.get("sort"), "downloads");
  assertEquals(url.searchParams.get("filter"), "gguf");
  assert(url.searchParams.getAll("expand[]").includes("gguf"));
  assertEquals(new URL(searchUrl("space", { text: "", gguf: false })).searchParams.get("sort"), "trendingScore");
  assertEquals(new URL(searchUrl("space", { text: "flux", gguf: false })).searchParams.get("sort"), "likes");
  assertEquals(
    plainSearchUrl("dataset", { text: "x", gguf: false }),
    "https://huggingface.co/api/datasets?search=x&sort=downloads&direction=-1&limit=30",
  );
  assertEquals(repoApiUrl("space", "a/b"), "https://huggingface.co/api/spaces/a/b");
  assertEquals(pageUrl("model", "a/b"), "https://huggingface.co/a/b");
  assertEquals(pageUrl("dataset", "a/b"), "https://huggingface.co/datasets/a/b");
  assertEquals(readmeUrl("dataset", "a/b"), "https://huggingface.co/datasets/a/b/raw/main/README.md");
});

Deno.test("mapRepo: models", () => {
  const m = mapRepo("model", MODEL);
  assertEquals(m.id, "meta-llama/Llama-3.1-8B-Instruct");
  assertEquals(m.downloads, 5214788);
  assertEquals(m.pipeline, "text-generation");
  assertEquals(m.library, "transformers");
  assertEquals(m.license, "llama3.1");
  assertEquals(m.gated, "manual");
  assertEquals(m.parameters, 8030261248);
  assertEquals(m.gguf, undefined);
  assertEquals(facts(m), {
    languages: [],
    datasets: [],
    baseModels: ["meta-llama/Llama-3.1-8B"],
    tasks: [],
  });
  assertEquals(plainTags(m).slice(0, 4), ["safetensors", "llama", "facebook", "meta"]);
  const g = mapRepo("model", GGUF);
  assertEquals(g.gguf, { architecture: "qwen2", contextLength: 32768, total: 7615616512 });
  assertEquals(g.gated, false);
  // A GGUF repository found without the gguf field.
  assertEquals(mapRepo("model", { id: "a/b-GGUF", tags: ["gguf"] }).gguf, {});
});

Deno.test("mapRepo: datasets and spaces", () => {
  const d = mapRepo("dataset", DATASET);
  assertEquals(d.description, "🍷 FineWeb 15 trillion tokens of the finest data the 🌐 web has to offer");
  assertEquals(d.license, "odc-by");
  assertEquals(facts(d).languages, ["en"]);
  assertEquals(facts(d).tasks, ["text-generation"]);
  const s = mapRepo("space", SPACE);
  assertEquals(s.title, "FLUX.1 [dev]");
  assertEquals(s.emoji, "🖥️");
  assertEquals(s.sdk, "gradio");
  assertEquals(s.stage, "RUNNING");
  assertEquals(s.hardware, "zero-a10g");
  assertEquals(s.license, "mit");
  assertEquals(s.description, "12B param rectified flow transformer guidance-distilled");
  assertEquals(spaceAppUrl(s), "https://black-forest-labs-flux-1-dev.hf.space");
  assertEquals(plainTags(s), []);
});

Deno.test("modelCard strips front matter, HTML and badges", () => {
  const md = [
    "---",
    "license: apache-2.0",
    "tags:",
    "- text-generation",
    "---",
    "",
    '<div align="center">',
    '  <img src="https://x/logo.png" width="200"/>',
    "</div>",
    "",
    "[![Discord](https://img.shields.io/badge/d.svg)](https://discord.gg/x) ![HF](https://img.shields.io/b.svg)",
    "",
    "# Qwen2.5-7B-Instruct",
    "",
    "",
    "",
    'See <a href="https://qwenlm.github.io">the blog</a>.<br>Thanks.',
    "",
    "```python",
    "from transformers import AutoModel",
    "model = AutoModel.from_pretrained('x')",
    "```",
  ].join("\n");
  assertEquals(
    modelCard(md),
    [
      "# Qwen2.5-7B-Instruct",
      "",
      "See [the blog](https://qwenlm.github.io).",
      "Thanks.",
      "",
      "```python",
      "from transformers import AutoModel",
      "model = AutoModel.from_pretrained('x')",
      "```",
    ].join("\n"),
  );
  // Cut in a code block: closed, and marked.
  assertEquals(modelCard("# T\n\n```\na\nb\nc\n", 3), "# T\n\n```\n```\n\n…");
  assertEquals(modelCard("No front matter"), "No front matter");
});

Deno.test("snippets per kind and library", () => {
  const titles = (r: Parameters<typeof snippets>[0]) => snippets(r).map((s) => s.title);
  const m = mapRepo("model", MODEL);
  assertEquals(titles(m), ["huggingface-cli download", "hf download", "Transformers pipeline", "git clone"]);
  assertEquals(
    snippets(m)[2].text,
    'from transformers import pipeline\n\npipe = pipeline("text-generation", model="meta-llama/Llama-3.1-8B-Instruct")',
  );
  const g = mapRepo("model", GGUF);
  assertEquals(snippets(g).map((s) => s.text).slice(0, 4), [
    "huggingface-cli download bartowski/Qwen2.5-7B-Instruct-GGUF",
    "hf download bartowski/Qwen2.5-7B-Instruct-GGUF",
    "ollama run hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF",
    "llama-server -hf bartowski/Qwen2.5-7B-Instruct-GGUF",
  ]);
  const d = mapRepo("dataset", DATASET);
  assertEquals(snippets(d)[0].text, "huggingface-cli download HuggingFaceFW/fineweb --repo-type dataset");
  assertEquals(titles(d), ["huggingface-cli download", "hf download", "load_dataset", "git clone"]);
  assertEquals(
    snippets(mapRepo("space", SPACE)).at(-1)?.text,
    "git clone https://huggingface.co/spaces/black-forest-labs/FLUX.1-dev",
  );
});

Deno.test("formatting", () => {
  assertEquals(compact(5214788), "5.2M");
  assertEquals(compact(4632), "4.6K");
  assertEquals(compact(12), "12");
  assertEquals(paramsLabel(8030261248), "8B params");
  assertEquals(paramsLabel(494032768), "494M params");
  assertEquals(paramsLabel(undefined), "");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(relativeDate("2026-10-28T01:00:00Z", now), "today");
  assertEquals(relativeDate("2026-10-27T01:00:00Z", now), "yesterday");
  assertEquals(relativeDate("2026-08-01T00:00:00Z", now), "2 months ago");
  assertEquals(relativeDate("2024-09-25T17:00:57.000Z", now), "2 years ago");
  assertEquals(humanize("text-generation"), "Text Generation");
  assertEquals(gatedLabel("manual"), "Gated, manual approval");
  assertEquals(gatedLabel("auto"), "Gated, automatic approval");
  assertEquals(gatedLabel(false), "");
});
