// The prompt form and the gallery of generations, shared by both commands.

import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  exists,
  generateAndSave,
  HOME,
  loadHistory,
  missing,
  saveHistory,
  type Settings,
  settings,
  SetupError,
} from "./api.ts";
import {
  type Aspect,
  ASPECTS,
  fileSize,
  type Generation,
  parseProvider,
  PROVIDERS,
  providerTitle,
  type Quality,
  removeGeneration,
  resolveFolder,
  seconds,
  shortPrompt,
  tilde,
} from "./lib.ts";

const dirname = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

export interface Draft {
  prompt?: string;
  provider?: string;
  aspect?: Aspect;
  quality?: Quality;
}

/** The prompt form; on submit, generates and shows the new image in the gallery. */
export function promptForm(prefs: Record<string, unknown>, draft: Draft = {}): FormSpec {
  const s = settings(prefs);
  const provider = parseProvider(draft.provider) ?? s.provider;
  return form({
    title: "Generate Image",
    submitTitle: "Generate",
    fields: [
      field.textArea("prompt", "Prompt", {
        required: true,
        placeholder: "A lighthouse on a cliff at dusk, watercolor",
        value: draft.prompt ?? "",
      }),
      field.dropdown(
        "provider",
        "Service",
        PROVIDERS.map((p) => ({ value: p.id, title: missing(s, p.id) ? `${p.title} (not set up)` : p.title })),
        { value: provider },
      ),
      field.dropdown("aspect", "Shape", ASPECTS.map((a) => ({ value: a.id, title: a.title })), {
        value: draft.aspect ?? "square",
      }),
      field.dropdown(
        "quality",
        "Quality (OpenAI)",
        [
          { value: "low", title: "Low: fastest, cheapest" },
          { value: "medium", title: "Medium" },
          { value: "high", title: "High: slowest" },
          { value: "auto", title: "Auto" },
        ],
        { value: draft.quality ?? "medium" },
      ),
    ],
    async submit(values, ctx) {
      const prompt = String(values.prompt ?? "").trim();
      if (!prompt) throw new Error("Type a prompt first");
      const chosen = parseProvider(values.provider) ?? s.provider;
      const g = await generateAndSave(s, {
        prompt,
        provider: chosen,
        aspect: (values.aspect as Aspect) || "square",
        quality: (values.quality as Quality) || "medium",
      }, ctx.signal).catch((e) => {
        if (e instanceof SetupError) throw new Error(`${e.message} (Settings → Extensions → Image Generation)`);
        throw e;
      });
      await toast(`Saved ${tilde(g.path, HOME)}`, { style: "success" });
      return gallery(prefs, g.id);
    },
  });
}

async function again(s: Settings, g: Generation): Promise<Generation> {
  return await generateAndSave(s, {
    prompt: g.prompt,
    provider: g.provider,
    aspect: g.aspect,
    quality: g.quality ?? "medium",
  });
}

function generationItem(prefs: Record<string, unknown>, g: Generation, fresh: boolean): Item {
  const s = settings(prefs);
  const dims = g.width && g.height ? `${g.width} × ${g.height}` : undefined;
  const actions: Action[] = [
    open(g.path, "Open Image", { icon: Icons.image }),
    copy(g.path, "Copy Path"),
    open(dirname(g.path), "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" }),
    copy(g.prompt, "Copy Prompt", { icon: Icons.text, shortcut: "<Ctrl><Shift>c" }),
    action("Generate Again", async () => {
      const n = await again(s, g);
      await toast(`Saved ${tilde(n.path, HOME)}`, { style: "success" });
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>g", section: "Generate" }),
    action("Edit Prompt…", () => promptForm(prefs, g), {
      icon: Icons.sparkle,
      shortcut: "<Ctrl>e",
      section: "Generate",
    }),
    copy(`file://${encodeURI(g.path)}`, "Copy File URL", { section: "Copy" }),
    action("Remove from History", async () => {
      await saveHistory(removeGeneration(await loadHistory(), g.id));
      return refresh();
    }, { icon: Icons.minus, section: "Delete" }),
    action("Delete Image", async () => {
      await Deno.remove(g.path).catch((e) => {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      });
      await saveHistory(removeGeneration(await loadHistory(), g.id));
      await toast("Image deleted");
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${g.path.slice(g.path.lastIndexOf("/") + 1)} from your disk?`,
      shortcut: "<Ctrl>x",
      section: "Delete",
    }),
  ];
  return {
    id: g.id,
    title: shortPrompt(g.prompt),
    subtitle: providerTitle(g.provider),
    icon: g.path,
    section: fresh ? "Just Generated" : undefined,
    keywords: [g.prompt, g.provider, providerTitle(g.provider), g.model],
    detail: {
      image: g.path,
      markdown: g.prompt,
      metadata: [
        meta.text("Service", providerTitle(g.provider), { icon: Icons.sparkle }),
        meta.text("Model", g.model, { icon: Icons.cpu }),
        ...(dims ? [meta.text("Size", dims, { icon: Icons.image })] : []),
        ...(g.quality ? [meta.text("Quality", g.quality)] : []),
        ...(g.seed !== undefined ? [meta.text("Seed", String(g.seed), { icon: Icons.dice })] : []),
        meta.text("Took", seconds(g.ms), { icon: Icons.timer }),
        meta.text("Created", new Date(g.at).toLocaleString("en-GB"), { icon: Icons.calendar }),
        ...(g.bytes ? [meta.text("File", fileSize(g.bytes), { icon: Icons.drive })] : []),
        meta.text("Path", tilde(g.path, HOME), { icon: Icons.folder }),
      ],
    },
    actions,
  };
}

let shown = 0;

/** Every generation still on disk, newest first; `fresh` is put first under its own header. */
export function gallery(prefs: Record<string, unknown>, fresh?: string): ListSpec {
  let folder = "";
  try {
    folder = resolveFolder(settings(prefs).folder, HOME);
  } catch {
    // Shown when generating.
  }
  return list({
    layout: "grid",
    columns: 4,
    placeholder: "Search your prompts…",
    filter: {
      options: [{ value: "all", title: "All" }, ...PROVIDERS.map((p) => ({ value: p.id, title: p.title }))],
      default: "all",
    },
    empty: {
      title: "No image yet",
      description: "Press Ctrl+N to write a prompt",
      icon: Icons.image,
    },
    status: () => `${shown} image${shown === 1 ? "" : "s"}${folder ? ` · ${tilde(folder, HOME)}` : ""}`,
    actions: [
      action("New Image…", () => promptForm(prefs), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      ...(folder ? [open(folder, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" })] : []),
    ],
    async items({ filter }) {
      const all = await loadHistory();
      const present = await Promise.all(all.map((g) => exists(g.path)));
      const kept = all.filter((_, i) => present[i]);
      // Images deleted outside the launcher leave the history too.
      if (kept.length !== all.length) await saveHistory(kept).catch(() => {});
      const view = filter && filter !== "all" ? kept.filter((g) => g.provider === filter) : kept;
      shown = view.length;
      return view
        .sort((a, b) => Number(b.id === fresh) - Number(a.id === fresh))
        .map((g) => generationItem(prefs, g, g.id === fresh));
    },
  });
}
