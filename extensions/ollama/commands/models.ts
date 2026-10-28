import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  age,
  bytes,
  count,
  displayName,
  expiresIn,
  libraryUrl,
  type Model,
  type ModelInfo,
  parsePs,
  parseShow,
  parseTags,
  processor,
  type Running,
} from "../lib.ts";
import { api, guarded, nextChange, notifyChanged, pullForm, pullView } from "../ollama.ts";

const CAPABILITY_COLORS: Record<string, "blue" | "purple" | "green" | "orange" | "teal" | "gray"> = {
  completion: "gray",
  vision: "purple",
  tools: "blue",
  thinking: "orange",
  embedding: "teal",
  insert: "green",
};

function infoView(m: Model, info: ModelInfo | undefined, raw: { modelfile?: string } | undefined) {
  const lines = [
    `# ${displayName(m.name)}`,
    "",
    info?.system ? `**System prompt:** ${info.system}\n` : "",
    info?.parameters.length ? "## Parameters\n\n```\n" + info.parameters.join("\n") + "\n```\n" : "",
    raw?.modelfile ? "## Modelfile\n\n```\n" + raw.modelfile.replace(/```/g, "ʼʼʼ").slice(0, 6000) + "\n```" : "",
  ];
  return detail({
    title: displayName(m.name),
    markdown: lines.filter(Boolean).join("\n"),
    metadata: metadata(m, info),
    actions: [
      copy(`ollama run ${m.name}`, "Copy ollama run Command", { icon: Icons.terminal }),
      ...(raw?.modelfile ? [copy(raw.modelfile, "Copy Modelfile", { icon: Icons.file })] : []),
      open(libraryUrl(m.name), "Open in Ollama Library"),
    ],
  });
}

function metadata(m: Model, info?: ModelInfo, r?: Running): Metadata[] {
  return [
    ...(r
      ? [
        meta.text("Loaded", processor(r), { icon: Icons.cpu, color: "green" }),
        meta.text("Memory", bytes(r.size), { icon: Icons.layers }),
        meta.text("Unloads", expiresIn(r.expires), { icon: Icons.timer }),
        ...(r.context ? [meta.text("Context in use", r.context.toLocaleString("en-US"))] : []),
        meta.separator(),
      ]
      : []),
    ...(m.family ? [meta.text("Family", m.family, { icon: Icons.layers })] : []),
    ...(m.parameters ? [meta.text("Parameters", m.parameters, { icon: Icons.cpu })] : []),
    ...(m.quantization ? [meta.text("Quantization", m.quantization)] : []),
    ...(info?.contextLength ? [meta.text("Context window", info.contextLength.toLocaleString("en-US"))] : []),
    ...(info?.capabilities.length
      ? [meta.tags("Capabilities", info.capabilities.map((c) => ({ text: c, color: CAPABILITY_COLORS[c] ?? "gray" })))]
      : []),
    meta.separator(),
    meta.text("Size on disk", m.remote ? "Cloud model" : bytes(m.size), { icon: Icons.drive }),
    ...(m.format ? [meta.text("Format", m.format.toUpperCase())] : []),
    ...(info?.license ? [meta.text("License", info.license, { icon: Icons.book })] : []),
    meta.text("Digest", m.digest.slice(0, 12), { icon: Icons.hash }),
    ...(m.modified ? [meta.text("Updated", age(m.modified) + " ago", { icon: Icons.calendar })] : []),
  ];
}

function item(m: Model, info: ModelInfo | undefined, r: Running | undefined): Item {
  const actions: Action[] = [
    copy(`ollama run ${m.name}`, "Copy ollama run Command", { icon: Icons.terminal }),
    action("Show Details", async () => {
      const raw = await api<any>("/api/show", { body: { model: m.name } }).catch(() => undefined);
      return infoView(m, raw ? parseShow(raw) : info, raw);
    }, { icon: Icons.info, shortcut: "<Ctrl>i" }),
  ];
  if (r) {
    actions.push(action("Unload from Memory", async () => {
      await api("/api/generate", { body: { model: m.name, keep_alive: 0 } });
      notifyChanged();
      await toast(`Unloaded ${displayName(m.name)}`, { style: "success" });
    }, { icon: Icons.stop, shortcut: "<Ctrl>u", section: "Model" }));
  } else if (!info?.capabilities.includes("embedding")) {
    actions.push(action("Load into Memory", async () => {
      await toast(`Loading ${displayName(m.name)}…`);
      await api("/api/generate", { body: { model: m.name, keep_alive: "10m" } });
      notifyChanged();
      await toast(`${displayName(m.name)} is loaded for 10 minutes`, { style: "success" });
    }, { icon: Icons.play, shortcut: "<Ctrl>l", section: "Model" }));
  }
  actions.push(
    ...(m.remote ? [] : [action("Update (Pull Again)", () => pullView(m.name), {
      icon: Icons.download,
      section: "Model",
    })]),
    action("Pull Another Model…", () => pullForm(), { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Model" }),
    open(libraryUrl(m.name), "Open in Ollama Library", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Model" }),
    copy(m.name, "Copy Model Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(`ollama pull ${m.name}`, "Copy ollama pull Command", { icon: Icons.terminal, section: "Copy" }),
    action("Delete Model", async () => {
      await api("/api/delete", { method: "DELETE", body: { model: m.name } });
      notifyChanged();
      await toast(`Deleted ${displayName(m.name)}`, {
        style: "success",
        message: m.remote ? undefined : `${bytes(m.size)} freed`,
      });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${displayName(m.name)}${
        m.remote ? "" : ` (${bytes(m.size)})`
      }? Pulling it again downloads it again.`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  );
  const caps = (info?.capabilities ?? []).filter((c) => c !== "completion");
  return {
    id: m.name,
    title: displayName(m.name),
    subtitle: [m.family, m.parameters, m.quantization].filter(Boolean).join(" · "),
    icon: { source: m.remote ? Icons.cloud : Icons.sparkle, tint: r ? "green" : m.remote ? "blue" : "purple" },
    section: r ? "Running" : "Installed",
    keywords: [m.family ?? "", ...m.families, m.parameters ?? "", m.quantization ?? "", ...caps],
    accessories: [
      ...caps.slice(0, 2).map((c) => ({ tag: c, color: CAPABILITY_COLORS[c] ?? "gray" as const })),
      ...(r
        ? [{ icon: { source: Icons.timer, tint: "green" as const }, text: expiresIn(r.expires), tooltip: "Unloads" }]
        : []),
      { text: m.remote ? "cloud" : bytes(m.size), tooltip: m.remote ? "Runs on ollama.com" : "Size on disk" },
    ],
    detail: {
      stats: r
        ? [
          { label: "memory", value: bytes(r.size), color: "green" },
          { label: "on GPU", value: r.size ? `${Math.round((r.vram / r.size) * 100)}%` : "—" },
          { label: "unloads", value: expiresIn(r.expires).replace(/^in /, "") || "—" },
        ]
        : [
          { label: "parameters", value: m.parameters || count(info?.parameterCount) || "—" },
          { label: "size", value: m.remote ? "cloud" : bytes(m.size) },
          { label: "quant", value: m.quantization ?? "—" },
        ],
      metadata: metadata(m, info, r),
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter models by name, family, size…",
  empty: {
    title: "No models yet",
    description: "Press Ctrl+N to pull one, e.g. llama3.2 or qwen3",
    icon: Icons.sparkle,
  },
  status: () => summary,
  actions: [action("Pull a Model…", () => pullForm(), { icon: Icons.download, shortcut: "<Ctrl>n" })],
  async *items({ signal }) {
    const infos = new Map<string, ModelInfo>();
    while (!signal.aborted) {
      let models: Model[] = [];
      let running: Running[] = [];
      let version = "";
      const items = await guarded(async () => {
        const [tags, ps, v] = await Promise.all([
          api<any>("/api/tags", { signal }),
          api<any>("/api/ps", { signal }),
          api<{ version: string }>("/api/version", { signal }).catch(() => ({ version: "" })),
        ]);
        models = parseTags(tags);
        running = parsePs(ps);
        version = v.version;
        return build(models, running, infos);
      });
      const total = models.reduce((n, m) => n + (m.remote ? 0 : m.size), 0);
      summary = models.length
        ? `${models.length} model${models.length === 1 ? "" : "s"} · ${bytes(total)}${
          running.length ? ` · ${running.length} running` : ""
        }${version ? ` · Ollama ${version}` : ""}`
        : "";
      await updateCommandMetadata({
        subtitle: models.length
          ? `${models.length} models${running.length ? ` · ${running.length} running` : ""}`
          : null,
      }).catch(() => {});
      yield items;

      // Capabilities and context windows, once per model.
      const missing = models.filter((m) => !infos.has(m.name));
      if (missing.length) {
        await Promise.all(missing.map(async (m) => {
          const raw = await api<any>("/api/show", { body: { model: m.name }, signal }).catch(() => undefined);
          if (raw) infos.set(m.name, parseShow(raw));
        }));
        if (signal.aborted) return;
        yield build(models, running, infos);
      }
      // Running models unload by themselves: keep their countdown fresh.
      await nextChange(signal, running.length ? 15_000 : 60_000);
    }
  },
});

function build(models: Model[], running: Running[], infos: Map<string, ModelInfo>): Item[] {
  const byName = new Map(running.map((r) => [r.name, r]));
  return [
    ...models.filter((m) => byName.has(m.name)),
    ...models.filter((m) => !byName.has(m.name)),
  ].map((m) => item(m, infos.get(m.name), byName.get(m.name)));
}
