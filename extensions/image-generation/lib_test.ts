import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS, isAllowedHost, missing, normalizeComfyUrl, settings } from "./api.ts";
import {
  addGeneration,
  comfyCheckpoints,
  comfyError,
  comfyWorkflow,
  decodeBase64,
  falError,
  falInput,
  falModel,
  fileName,
  fileSize,
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
  removeGeneration,
  replicateError,
  replicateInput,
  replicateModel,
  resolveFolder,
  seconds,
  shortPrompt,
  slug,
  tilde,
} from "./lib.ts";

// The first bytes of a 1536×1024 PNG (signature, IHDR).
const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x06,
  0x00,
  0x00,
  0x00,
  0x04,
  0x00,
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
]);
// A JPEG with an APP0 segment then SOF0 (height 832, width 1216).
const JPEG = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0x00,
  0x04,
  0x00,
  0x00,
  0xff,
  0xc0,
  0x00,
  0x11,
  0x08,
  0x03,
  0x40,
  0x04,
  0xc0,
  0x03,
  0x01,
]);
const WEBP = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");

Deno.test("hosts: the manifest and HOSTS agree, and are matched like Deno does", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("pbxt.replicate.delivery"));
  assert(isAllowedHost("replicate.delivery"));
  assert(isAllowedHost("v3.fal.media"));
  assert(isAllowedHost("gpu.lan"));
  assert(isAllowedHost("192.168.1.30"));
  assert(isAllowedHost("100.101.102.103"));
  assert(!isAllowedHost("172.32.0.1"));
  assert(!isAllowedHost("evil.example.com"));
});

Deno.test("preferences", () => {
  const s = settings({ provider: "fal.ai", replicateModel: "https://replicate.com/stability-ai/sdxl/", falModel: "" });
  assertEquals(s.provider, "fal");
  assertEquals(s.replicateModel, "stability-ai/sdxl");
  assertEquals(s.falModel, "fal-ai/flux/schnell");
  assertEquals(s.comfyUrl, "http://127.0.0.1:8188");
  assertEquals(s.comfySteps, 25);
  assertEquals(missing(s, "fal"), "Add a fal.ai API key in Settings");
  assertEquals(missing({ ...s, falKey: "k" }, "fal"), undefined);
  assertEquals(missing(s, "openai"), "Add an OpenAI API key in Settings");
  assertEquals(missing(s, "comfyui"), undefined);
  assertEquals(
    missing({ ...s, comfyUrl: "http://gpu.example.com:8188" }, "comfyui"),
    "gpu.example.com is outside the networks this extension may reach",
  );
  assertEquals(
    missing({ ...s, replicateToken: "r8_x", replicateModel: undefined }, "replicate")?.startsWith(
      "The Replicate model",
    ),
    true,
  );
  assertEquals(normalizeComfyUrl("gpu.lan:8188/"), "http://gpu.lan:8188");
  assertEquals(normalizeComfyUrl(""), "http://127.0.0.1:8188");
  assertEquals(parseProvider("ComfyUI"), "comfyui");
  assertEquals(parseProvider("OpenAI"), "openai");
  assertEquals(parseProvider("midjourney"), undefined);
});

Deno.test("OpenAI gpt-image-1", () => {
  assertEquals(openaiRequest("a fox", "landscape", "high"), {
    model: "gpt-image-1",
    prompt: "a fox",
    n: 1,
    size: "1536x1024",
    quality: "high",
    output_format: "png",
  });
  const bytes = openaiImage({
    created: 1730000000,
    data: [{ b64_json: btoa("\x89PNG") }],
    usage: { total_tokens: 100 },
  });
  assertEquals(Array.from(bytes), [0x89, 0x50, 0x4e, 0x47]);
  assertThrows(() => openaiImage({ data: [] }), Error, "OpenAI sent no image");
  assertEquals(openaiError(401, {}), "OpenAI refused the API key: check it in Settings");
  assertEquals(
    openaiError(400, {
      error: { code: "moderation_blocked", message: "Your request was rejected by the safety system." },
    }),
    "OpenAI's safety system refused this prompt: rephrase it",
  );
  assert(
    openaiError(403, { error: { message: "Your organization must be verified to use the model `gpt-image-1`." } })
      .includes("verified organization"),
  );
  assertEquals(
    openaiError(429, { error: { message: "You exceeded your current quota" } }),
    "Your OpenAI quota is used up: check billing",
  );
  assertEquals(openaiError(500, {}), "OpenAI answered 500");
});

Deno.test("Replicate predictions", () => {
  assertEquals(replicateModel("black-forest-labs/flux-schnell"), "black-forest-labs/flux-schnell");
  assertEquals(replicateModel("not a model"), undefined);
  assertEquals(replicateInput("a fox", "portrait").input.aspect_ratio, "2:3");
  const done = parsePrediction({
    id: "gm3qorzdhgbfurvjtvhg6dckhu",
    model: "black-forest-labs/flux-schnell",
    status: "succeeded",
    output: ["https://replicate.delivery/xezq/abc/out-0.png"],
    logs: "Using seed: 1234567\n100%|██████████| 4/4",
    urls: { get: "https://api.replicate.com/v1/predictions/gm3qorzdhgbfurvjtvhg6dckhu" },
  });
  assertEquals(done.status, "succeeded");
  assertEquals(done.output, "https://replicate.delivery/xezq/abc/out-0.png");
  assertEquals(done.seed, 1234567);
  assertEquals(done.poll, "https://api.replicate.com/v1/predictions/gm3qorzdhgbfurvjtvhg6dckhu");
  assertEquals(
    parsePrediction({ status: "succeeded", output: "https://replicate.delivery/x.webp" }).output,
    "https://replicate.delivery/x.webp",
  );
  assertEquals(parsePrediction({ status: "processing", output: null }).output, undefined);
  assertEquals(parsePrediction({ status: "failed", error: "NSFW content detected" }).error, "NSFW content detected");
  assertEquals(
    replicateError(401, { detail: "Invalid token." }),
    "Replicate refused the API token: check it in Settings",
  );
  assertEquals(
    replicateError(422, { detail: "- input.aspect_ratio: must be one of..." }),
    "Replicate refused the input: - input.aspect_ratio: must be one of...",
  );
  assertEquals(replicateError(500, {}), "Replicate answered 500");
});

Deno.test("fal.ai", () => {
  assertEquals(falModel("https://fal.run/fal-ai/flux/dev"), "fal-ai/flux/dev");
  assertEquals(falModel("https://fal.ai/models/fal-ai/recraft-v3"), "fal-ai/recraft-v3");
  assertEquals(falModel("flux"), undefined);
  assertEquals(falInput("a fox", "landscape").image_size, "landscape_4_3");
  assertEquals(
    parseFal({
      images: [{
        url: "https://v3.fal.media/files/lion/abc.jpeg",
        width: 1024,
        height: 768,
        content_type: "image/jpeg",
      }],
      timings: { inference: 0.4 },
      seed: 42,
      has_nsfw_concepts: [false],
      prompt: "a fox",
    }),
    { url: "https://v3.fal.media/files/lion/abc.jpeg", width: 1024, height: 768, seed: 42 },
  );
  assertThrows(() => parseFal({ images: [{ url: "x" }], has_nsfw_concepts: [true] }), Error, "safety checker");
  assertThrows(() => parseFal({}), Error, "fal.ai sent no image");
  assertEquals(falError(401, { detail: "Unauthorized" }), "fal.ai refused the API key: check it in Settings");
  assertEquals(
    falError(403, { detail: "User is locked. Reason: Exhausted balance." }),
    "fal.ai refused the API key: check it in Settings",
  );
  assertEquals(falError(400, { detail: "Exhausted balance" }), "Your fal.ai balance is empty: fal.ai → Billing");
  assertEquals(
    falError(422, { detail: [{ loc: ["body", "prompt"], msg: "field required" }] }),
    "fal.ai: field required",
  );
});

Deno.test("ComfyUI", () => {
  const w = comfyWorkflow({
    prompt: "a fox",
    checkpoint: "sd_xl_base_1.0.safetensors",
    aspect: "portrait",
    steps: 500,
    seed: 7,
  }) as any;
  assertEquals(w["4"].inputs.ckpt_name, "sd_xl_base_1.0.safetensors");
  assertEquals([w["5"].inputs.width, w["5"].inputs.height], [832, 1216]);
  assertEquals(w["6"].inputs.text, "a fox");
  assertEquals(w["3"].inputs.steps, 150);
  assertEquals(w["3"].inputs.seed, 7);
  assertEquals(w["9"].class_type, "SaveImage");

  assertEquals(
    comfyCheckpoints({
      CheckpointLoaderSimple: {
        input: { required: { ckpt_name: [["sd_xl_base_1.0.safetensors", "v1-5-pruned-emaonly.safetensors"], {}] } },
      },
    }),
    ["sd_xl_base_1.0.safetensors", "v1-5-pruned-emaonly.safetensors"],
  );
  assertEquals(
    comfyCheckpoints({
      CheckpointLoaderSimple: {
        input: { required: { ckpt_name: ["COMBO", { options: ["flux1-schnell-fp8.safetensors"] }] } },
      },
    }),
    ["flux1-schnell-fp8.safetensors"],
  );
  assertEquals(comfyCheckpoints({}), []);

  const id = "1c5b6e7a-0f3c-4a8e-9a55-2a5d4d0d6f1e";
  assertEquals(parseComfyHistory({}, id), { done: false });
  assertEquals(
    parseComfyHistory({
      [id]: {
        prompt: [],
        outputs: { "9": { images: [{ filename: "backslash_00012_.png", subfolder: "", type: "output" }] } },
        status: { status_str: "success", completed: true, messages: [["execution_start", {}]] },
      },
    }, id),
    { done: true, image: { filename: "backslash_00012_.png", subfolder: "", type: "output" } },
  );
  assertEquals(
    parseComfyHistory({
      [id]: {
        outputs: {},
        status: {
          status_str: "error",
          completed: false,
          messages: [["execution_error", { node_type: "KSampler", exception_message: "CUDA out of memory\n" }]],
        },
      },
    }, id),
    { done: true, error: "ComfyUI failed in KSampler: CUDA out of memory" },
  );
  assertEquals(
    comfyError({
      error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
      node_errors: {
        "4": {
          errors: [{
            type: "value_not_in_list",
            message: "Value not in list",
            details: "ckpt_name: 'nope.safetensors' not in ['sd_xl_base_1.0.safetensors']",
          }],
        },
      },
    }, 400),
    "ComfyUI has no such checkpoint: check the checkpoint in Settings",
  );
  assertEquals(
    comfyError({ error: { message: "Prompt has no outputs" }, node_errors: {} }, 400),
    "ComfyUI: Prompt has no outputs",
  );
});

Deno.test("image bytes", () => {
  assertEquals(imageExtension(PNG), "png");
  assertEquals(imageExtension(JPEG), "jpg");
  assertEquals(imageExtension(WEBP), "webp");
  assertEquals(imageSize(PNG), { width: 1536, height: 1024 });
  assertEquals(imageSize(JPEG), { width: 1216, height: 832 });
  assertEquals(imageSize(WEBP), undefined);
  assertEquals(Array.from(decodeBase64("data:image/png;base64,iVBORw==")), [0x89, 0x50, 0x4e, 0x47]);
});

Deno.test("file names and folders", () => {
  assertEquals(slug("A red fox, in the snow!"), "a-red-fox-in-the-snow");
  assertEquals(slug("Crème brûlée à Paris"), "creme-brulee-a-paris");
  assertEquals(slug("!!!"), "image");
  assertEquals(slug("a very long prompt about many different things that goes on and on", 20), "a-very-long-prompt");
  assertEquals(fileName("A red fox", new Date(2026, 9, 31, 14, 5, 9), "png"), "2026-10-31-140509-a-red-fox.png");
  assertEquals(resolveFolder("~/Pictures/Generated/", "/home/ada"), "/home/ada/Pictures/Generated");
  assertEquals(resolveFolder("", "/home/ada"), "/home/ada/Pictures/Generated");
  assertEquals(resolveFolder("/home/ada/Pictures", "/home/ada"), "/home/ada/Pictures");
  assertThrows(() => resolveFolder("~/Pictures/../Documents", "/home/ada"), Error, "inside ~/Pictures");
  assertThrows(() => resolveFolder("~/PicturesX", "/home/ada"), Error, "inside ~/Pictures");
  assertEquals(tilde("/home/ada/Pictures/x.png", "/home/ada"), "~/Pictures/x.png");
  assertEquals(tilde("/tmp/x.png", "/home/ada"), "/tmp/x.png");
});

Deno.test("history and formatting", () => {
  const g = (id: string): Generation => ({
    id,
    path: `/home/ada/Pictures/Generated/${id}.png`,
    prompt: "a fox",
    provider: "openai",
    model: "gpt-image-1",
    aspect: "square",
    at: 1,
    ms: 12_400,
  });
  let h = addGeneration([], g("a"));
  h = addGeneration(h, g("b"));
  h = addGeneration(h, g("a"));
  assertEquals(h.map((x) => x.id), ["a", "b"]);
  assertEquals(addGeneration(h, g("c"), 2).map((x) => x.id), ["c", "a"]);
  assertEquals(removeGeneration(h, "a").map((x) => x.id), ["b"]);
  assertEquals(seconds(12_400), "12.4 s");
  assertEquals(seconds(65_000), "1 min 5 s");
  assertEquals(fileSize(2_400_000), "2.3 MB");
  assertEquals(fileSize(900), "900 B");
  assertEquals(
    shortPrompt("A lighthouse on a cliff at dusk, watercolor, soft light", 30),
    "A lighthouse on a cliff at…",
  );
  assertEquals(shortPrompt("  a   fox "), "a fox");
});
