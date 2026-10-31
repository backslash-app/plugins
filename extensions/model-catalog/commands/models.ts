import {
  type Accessory,
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { cachedModels, compared, fetchModels, saveCompared, saveModels } from "../api.ts";
import {
  comparison,
  cost,
  curlSnippet,
  date,
  hasReasoning,
  hasTools,
  modalities,
  type Model,
  modelUrl,
  money,
  price,
  priceColor,
  priceText,
  select,
  stale,
  toggle,
  tokens,
  VIEWS,
} from "../lib.ts";

/** Set by "Reload": the next load skips the cache. */
let force = false;
let status = "";
/** The models last loaded, for the comparison view. */
let loaded: Model[] = [];

function typical(prefs: Record<string, unknown>): [number, number] {
  const n = (v: unknown, d: number) => (Number(v) > 0 ? Math.round(Number(v)) : d);
  return [n(prefs.inputTokens, 10_000), n(prefs.outputTokens, 1000)];
}

function comparisonView(prefs: Record<string, unknown>, ids: string[]): DetailSpec {
  const [inTok, outTok] = typical(prefs);
  const models = ids.map((id) => loaded.find((m) => m.id === id)).filter((m): m is Model => !!m);
  return detail({
    title: "Compare Models",
    markdown: [
      `## Comparing ${models.length} model${models.length === 1 ? "" : "s"}`,
      "",
      comparison(models, inTok, outTok),
    ]
      .join("\n"),
    status: "Prices per million tokens, in US dollars",
    actions: [
      ...models.map((m) => copy(m.id, `Copy ${m.name} ID`, { section: "Copy" })),
      action("Clear Comparison", async () => {
        await saveCompared([]);
        await toast("Comparison cleared");
        return pop();
      }, { icon: Icons.trash, destructive: true }),
    ],
  });
}

function compareActions(prefs: Record<string, unknown>, m: Model, ids: string[]): Action[] {
  const inSet = ids.includes(m.id);
  return [
    action(inSet ? "Remove from Comparison" : "Add to Comparison", async () => {
      const next = toggle(await compared(), m.id);
      await saveCompared(next);
      await toast(inSet ? `${m.name} removed` : `${m.name} added: ${next.length} to compare (Ctrl+Shift+M)`);
      return refresh();
    }, { icon: inSet ? Icons.minus : Icons.plus, shortcut: "<Ctrl>m", section: "Compare" }),
    ...(ids.length && !(ids.length === 1 && inSet)
      ? [
        action(
          `Compare ${inSet ? ids.length : ids.length + 1} Models`,
          () => comparisonView(prefs, inSet ? ids : [...ids, m.id]),
          { icon: Icons.layers, shortcut: "<Ctrl><Shift>m", section: "Compare" },
        ),
      ]
      : []),
  ];
}

function modelItem(prefs: Record<string, unknown>, m: Model, view: string, ids: string[]): Item {
  const [inTok, outTok] = typical(prefs);
  const vision = m.input.includes("image");
  const accessories: Accessory[] = [
    ...(ids.includes(m.id)
      ? [{ icon: { source: Icons.layers, tint: "blue" as const }, tooltip: "In the comparison" }]
      : []),
    ...(vision ? [{ icon: Icons.image, tooltip: `Input: ${modalities(m.input)}` }] : []),
    ...(m.output.includes("image") ? [{ tag: "image out", color: "pink" as const }] : []),
    ...(hasReasoning(m) ? [{ icon: Icons.lightbulb, tooltip: "Reasoning" }] : []),
    { text: tokens(m.context), icon: Icons.text, tooltip: "Context length (tokens)" },
    { tag: priceText(m), color: priceColor(m), tooltip: "Per million tokens, input / output" },
  ];
  const typicalCost = cost(m, inTok, outTok);
  const description = m.description.length > 1200 ? `${m.description.slice(0, 1200)}…` : m.description;
  const metadata: Metadata[] = [
    meta.text("Provider", m.providerName, { icon: Icons.server }),
    meta.text("Model ID", m.id, { icon: Icons.code }),
    meta.text("Input", m.variable ? "varies" : `${price(m.inPrice)} / M tokens`, { icon: Icons.arrowRight }),
    meta.text("Output", m.variable ? "varies" : `${price(m.outPrice)} / M tokens`, { icon: Icons.arrowRight }),
    ...(m.cacheRead !== undefined ? [meta.text("Cached input", `${price(m.cacheRead)} / M`)] : []),
    ...(m.cacheWrite !== undefined ? [meta.text("Cache write", `${price(m.cacheWrite)} / M`)] : []),
    ...(m.reasoningPrice !== undefined ? [meta.text("Reasoning", `${price(m.reasoningPrice)} / M`)] : []),
    ...(m.imagePrice !== undefined ? [meta.text("Per input image", money(m.imagePrice))] : []),
    ...(m.requestPrice !== undefined ? [meta.text("Per request", money(m.requestPrice))] : []),
    meta.separator(),
    meta.text("Context", m.context ? `${m.context.toLocaleString("en")} tokens` : "–", { icon: Icons.text }),
    ...(m.maxOutput ? [meta.text("Max output", `${m.maxOutput.toLocaleString("en")} tokens`)] : []),
    meta.tags(
      "Input",
      m.input.map((x) => ({ text: modalities([x]), color: x === "text" ? undefined : "blue" as const })),
    ),
    meta.tags(
      "Output",
      m.output.map((x) => ({ text: modalities([x]), color: x === "text" ? undefined : "pink" as const })),
    ),
    ...(m.parameters.length
      ? [meta.tags(
        "Supports",
        [
          ...(hasTools(m) ? [{ text: "tools", color: "green" as const }] : []),
          ...(hasReasoning(m) ? [{ text: "reasoning", color: "purple" as const }] : []),
          ...(m.parameters.includes("structured_outputs") || m.parameters.includes("response_format")
            ? [{ text: "JSON output" }]
            : []),
          ...(m.parameters.includes("web_search_options") ? [{ text: "web search" }] : []),
        ],
      )]
      : []),
    ...(m.tokenizer ? [meta.text("Tokenizer", m.tokenizer)] : []),
    ...(m.created ? [meta.text("Released", date(m.created), { icon: Icons.calendar })] : []),
    ...(m.moderated !== undefined ? [meta.text("Moderated", m.moderated ? "Yes" : "No", { icon: Icons.shield })] : []),
    meta.link("OpenRouter", m.id, modelUrl(m.id)),
    ...(m.huggingFace ? [meta.link("Hugging Face", m.huggingFace, `https://huggingface.co/${m.huggingFace}`)] : []),
  ];

  return {
    id: m.id,
    title: m.name,
    subtitle: m.id,
    icon: { source: m.output.includes("image") ? Icons.image : Icons.sparkle, tint: priceColor(m) },
    section: view === "providers" ? m.providerName : undefined,
    keywords: [m.provider, m.providerName, ...m.input, ...(m.free ? ["free", "gratuit"] : [])],
    accessories,
    detail: {
      stats: [
        { label: "input / M", value: m.variable ? "varies" : price(m.inPrice), color: priceColor(m) },
        { label: "output / M", value: m.variable ? "varies" : price(m.outPrice), color: priceColor(m) },
        { label: "context", value: tokens(m.context) },
        ...(typicalCost !== undefined
          ? [{ label: `${tokens(inTok)} in + ${tokens(outTok)} out`, value: money(typicalCost) }]
          : []),
      ],
      markdown: description || undefined,
      metadata,
    },
    actions: [
      copy(m.id, "Copy Model ID"),
      open(modelUrl(m.id), "Open on OpenRouter"),
      ...compareActions(prefs, m, ids),
      copy(
        `${m.name} (${m.id}): ${priceText(m)} per million tokens in / out, ${tokens(m.context)} context`,
        "Copy Summary",
        {
          section: "Copy",
          shortcut: "<Ctrl><Shift>c",
        },
      ),
      copy(curlSnippet(m.id), "Copy curl Example", { icon: Icons.terminal, section: "Copy" }),
      ...(m.huggingFace
        ? [open(`https://huggingface.co/${m.huggingFace}`, "Open on Hugging Face", { section: "Links" })]
        : []),
      open(`https://openrouter.ai/${m.provider}`, `More from ${m.providerName}`, {
        section: "Links",
        icon: Icons.server,
      }),
    ],
  };
}

function render(prefs: Record<string, unknown>, models: Model[], view: string, ids: string[], at?: number): Item[] {
  const shown = select(models, view);
  const providers = new Set(shown.map((m) => m.provider)).size;
  status = `${shown.length} model${shown.length === 1 ? "" : "s"} · ${providers} provider${providers === 1 ? "" : "s"}${
    ids.length ? ` · ${ids.length} to compare` : ""
  }${at ? ` · updated ${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}`;
  return shown.map((m) => modelItem(prefs, m, view, ids));
}

export default list({
  placeholder: "Filter models by name, provider, id…",
  filter: { options: VIEWS.map((v) => ({ value: v.value, title: v.title })), default: "newest" },
  empty: { title: "No model here", description: "Try another view with Tab", icon: Icons.sparkle },
  status: () => status,
  actions: [
    action("Reload Models", () => {
      force = true;
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    action("Show Comparison", async (ctx) => comparisonView(ctx.preferences, await compared()), {
      icon: Icons.layers,
      shortcut: "<Ctrl><Shift>m",
    }),
  ],
  async *items({ preferences, filter, signal }) {
    const view = filter ?? "newest";
    const [cache, ids] = await Promise.all([cachedModels(), compared()]);
    if (cache.models.length) {
      loaded = cache.models;
      yield render(preferences, cache.models, view, ids, cache.at);
    }
    if (!force && !stale(cache.at) && cache.models.length) return;
    force = false;
    try {
      const fresh = await fetchModels(signal);
      const at = Date.now();
      await saveModels(fresh, at);
      loaded = fresh;
      yield render(preferences, fresh, view, ids, at);
    } catch (e) {
      if (signal.aborted || !cache.models.length) throw e;
      await toast("Showing the saved list", { style: "failure", message: e instanceof Error ? e.message : String(e) })
        .catch(() => {});
    }
  },
});
