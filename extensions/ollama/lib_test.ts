import { assertEquals, assertThrows } from "@std/assert";
import {
  bytes,
  count,
  displayName,
  expiresIn,
  initialPull,
  installCommand,
  libraryUrl,
  normalizeModelName,
  osFamily,
  parsePs,
  parseShow,
  parseTags,
  processor,
  pullTotals,
  reducePull,
  splitLines,
  statusLabel,
} from "./lib.ts";

const TAGS = {
  models: [
    {
      name: "qwen3:8b",
      model: "qwen3:8b",
      modified_at: "2026-09-01T10:00:00Z",
      size: 5225388164,
      digest: "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41",
      details: {
        format: "gguf",
        family: "qwen3",
        families: ["qwen3"],
        parameter_size: "8.2B",
        quantization_level: "Q4_K_M",
      },
    },
    {
      name: "llama3.2:latest",
      model: "llama3.2:latest",
      modified_at: "2026-10-20T10:00:00.123+02:00",
      size: 2019393189,
      digest: "a80c4f17acd5",
      details: { format: "gguf", family: "llama", parameter_size: "3.2B", quantization_level: "Q4_K_M" },
    },
    { name: "gpt-oss:120b-cloud", size: 384, digest: "x", remote_host: "https://ollama.com:443", details: {} },
  ],
};

Deno.test("installed models", () => {
  const models = parseTags(TAGS);
  assertEquals(models.map((m) => m.name), ["gpt-oss:120b-cloud", "llama3.2:latest", "qwen3:8b"]);
  assertEquals(models[1].families, ["llama"]);
  assertEquals(models[2].parameters, "8.2B");
  assertEquals(models[0].remote, true);
  assertEquals(models[1].remote, false);
  assertEquals(parseTags(undefined), []);
  assertEquals(displayName("llama3.2:latest"), "llama3.2");
  assertEquals(displayName("qwen3:8b"), "qwen3:8b");
});

Deno.test("running models", () => {
  const [r] = parsePs({
    models: [{
      name: "llama3.2:latest",
      size: 3500000000,
      size_vram: 1680000000,
      expires_at: "2026-10-28T12:04:00Z",
      context_length: 4096,
    }],
  });
  assertEquals(processor(r), "52%/48% CPU/GPU");
  assertEquals(processor({ ...r, vram: r.size }), "100% GPU");
  assertEquals(processor({ ...r, vram: 0 }), "100% CPU");
  const now = new Date("2026-10-28T12:00:00Z");
  assertEquals(expiresIn(r.expires, now), "in 4 min");
  assertEquals(expiresIn(new Date("2318-01-01T00:00:00Z"), now), "forever");
  assertEquals(expiresIn(new Date("2026-10-28T11:00:00Z"), now), "now");
});

Deno.test("model details from /api/show", () => {
  const info = parseShow({
    license: "\nMIT License\n\nCopyright",
    modelfile: 'FROM x\nSYSTEM """You are a pirate."""\nPARAMETER temperature 0.7',
    parameters: 'temperature                    0.7\nstop                           "<|im_end|>"',
    capabilities: ["completion", "vision"],
    model_info: {
      "general.architecture": "gemma3",
      "general.parameter_count": 4300079472,
      "gemma3.context_length": 131072,
    },
  });
  assertEquals(info.contextLength, 131072);
  assertEquals(info.license, "MIT License");
  assertEquals(info.system, "You are a pirate.");
  assertEquals(info.parameters, ["temperature 0.7", 'stop "<|im_end|>"']);
  assertEquals(count(info.parameterCount), "4.3B");
  assertEquals(count(137000000), "137M");
  assertEquals(parseShow(undefined).capabilities, []);
});

Deno.test("model names", () => {
  assertEquals(normalizeModelName(" ollama run qwen3:8b "), "qwen3:8b");
  assertEquals(normalizeModelName("https://ollama.com/library/gemma3"), "gemma3");
  assertEquals(normalizeModelName("hf.co/user"), "hf.co/user");
  assertThrows(() => normalizeModelName("rm -rf /"), Error, "not a model name");
  assertEquals(libraryUrl("qwen3:8b"), "https://ollama.com/library/qwen3");
  assertEquals(libraryUrl("mannix/llama3:8b"), "https://ollama.com/mannix/llama3");
});

Deno.test("pull progress", () => {
  const lines = [
    { status: "pulling manifest" },
    { status: "pulling dde5aa3fc5ff", digest: "sha256:dde5", total: 2000, completed: 500 },
    { status: "pulling 966de95ca8a6", digest: "sha256:966d", total: 1000 },
    { status: "pulling dde5aa3fc5ff", digest: "sha256:dde5", total: 2000, completed: 400 }, // out of order: kept at 500
    { status: "pulling 966de95ca8a6", digest: "sha256:966d", total: 1000, completed: 1000 },
  ];
  let s = initialPull();
  for (const l of lines) s = reducePull(s, l);
  assertEquals(s.layers.map((l) => l.completed), [500, 1000]);
  assertEquals(pullTotals(s), { completed: 1500, total: 3000, ratio: 0.5 });
  assertEquals(statusLabel(s.status), "Downloading layer 966de95c");
  s = reducePull(reducePull(s, { status: "verifying sha256 digest" }), { status: "success" });
  assertEquals(s.done, true);
  assertEquals(statusLabel(s.status), "Done");
  const failed = reducePull(initialPull(), { error: "pull model manifest: file does not exist" });
  assertEquals([failed.done, failed.error], [true, "pull model manifest: file does not exist"]);
  assertEquals(pullTotals(initialPull()).ratio, 0);
});

Deno.test("NDJSON splitting", () => {
  assertEquals(splitLines('{"a":1}\n{"b":2}\n{"c"'), { lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  assertEquals(splitLines(""), { lines: [], rest: "" });
});

Deno.test("formatting and install hints", () => {
  assertEquals(bytes(2019393189), "2.0 GB");
  assertEquals(bytes(274302450), "274 MB");
  assertEquals(bytes(512), "512 B");
  assertEquals(installCommand(osFamily("ID=arch")), "sudo pacman -S ollama   # or ollama-cuda, ollama-rocm");
  assertEquals(installCommand(osFamily('ID="fedora"')), "sudo dnf install ollama");
  assertEquals(installCommand(osFamily("ID=ubuntu\nID_LIKE=debian")), "curl -fsSL https://ollama.com/install.sh | sh");
});
