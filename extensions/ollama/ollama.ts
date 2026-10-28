// Talking to the local Ollama server, and the views both commands share.

import {
  action,
  close,
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
} from "@backslash/api";
import {
  BASE,
  bytes,
  displayName,
  initialPull,
  INSTALL_SCRIPT,
  installCommand,
  libraryUrl,
  normalizeModelName,
  osFamily,
  pullTotals,
  reducePull,
  splitLines,
  statusLabel,
} from "./lib.ts";

export class NotRunning extends Error {}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      signal: options.signal,
      headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new NotRunning(`Ollama isn't running on ${BASE.replace(/^http:\/\//, "")}`);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(body?.error ?? `Ollama answered ${res.status}`);
  return body as T;
}

// --- Live reload ------------------------------------------------------------------------

const changes = new EventTarget();
export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Resolves on the next change, after `ms`, or when `signal` aborts. */
export function nextChange(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    }
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

// --- Not running --------------------------------------------------------------------------

async function installed(): Promise<boolean> {
  try {
    await new Deno.Command("ollama", { args: ["--version"], stdin: "null", stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
}

export async function notRunningItems(err: NotRunning): Promise<Item[]> {
  const [hasBinary, osRelease] = await Promise.all([
    installed(),
    Deno.readTextFile("/etc/os-release").catch(() => ""),
  ]);
  const install = installCommand(osFamily(osRelease));
  if (hasBinary) {
    return [{
      id: "not-running",
      title: err.message,
      subtitle: "Start the server, then reload",
      icon: { source: Icons.power, tint: "orange" },
      detail: {
        markdown: [
          "Ollama is installed but its server doesn't answer.",
          "",
          "```sh",
          "sudo systemctl start ollama   # the service installed by the official script",
          "ollama serve                  # or in a terminal",
          "```",
          "",
          "**Start ollama serve** runs it in the background for your session (`systemd-run --user`).",
        ].join("\n"),
      },
      actions: [
        action("Start ollama serve", async () => {
          const out = await new Deno.Command("systemd-run", {
            args: ["--user", "--collect", "--unit=backslash-ollama-serve", "ollama", "serve"],
            stdin: "null",
            stdout: "null",
            stderr: "piped",
          }).output().catch((err) => {
            if (err instanceof Deno.errors.NotFound) {
              throw new Error("systemd-run is missing: run ollama serve in a terminal");
            }
            throw err;
          });
          if (!out.success) throw new Error(new TextDecoder().decode(out.stderr).trim() || "systemd-run failed");
          await new Promise((r) => setTimeout(r, 1500));
          return refresh();
        }, { icon: Icons.play }),
        action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
        copy("sudo systemctl start ollama", "Copy systemctl Command", { icon: Icons.terminal, section: "Copy" }),
      ],
    }];
  }
  return [{
    id: "not-installed",
    title: "Ollama is not installed",
    subtitle: install,
    icon: { source: Icons.download, tint: "orange" },
    detail: {
      markdown: [
        "Ollama runs language models on this computer. Install it, then pull a model:",
        "",
        "```sh",
        install,
        "ollama pull llama3.2",
        "```",
      ].join("\n"),
    },
    actions: [
      copy(install.replace(/\s+#.*$/, ""), "Copy Install Command", { icon: Icons.terminal }),
      ...(install === INSTALL_SCRIPT
        ? []
        : [copy(INSTALL_SCRIPT, "Copy Install Script Command", { icon: Icons.terminal })]),
      open("https://ollama.com/download/linux", "Open Download Page"),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof NotRunning) return notRunningItems(err);
    throw err;
  }
}

// --- Pull --------------------------------------------------------------------------------

export function pullForm(): FormSpec {
  return form({
    title: "Pull a Model",
    submitTitle: "Pull",
    fields: [
      field.text("model", "Model", { required: true, placeholder: "llama3.2, qwen3:8b, gemma3:4b, deepseek-r1:7b…" }),
    ],
    submit: (values) => pullView(normalizeModelName(String(values.model ?? ""))),
  });
}

/** Streams `/api/pull` into items: the overall progress, then one row per layer. */
export function pullView(name: string): ListSpec {
  let line = "";
  return list({
    title: `Pull ${name}`,
    placeholder: `Pulling ${name}…`,
    status: () => line,
    async *items({ signal }) {
      let state = initialPull();
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(`${BASE}/api/pull`, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: name, stream: true }),
        });
      } catch (err) {
        if (signal.aborted) return;
        console.error(err);
        yield await notRunningItems(new NotRunning(`Ollama isn't running on ${BASE.replace(/^http:\/\//, "")}`));
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => undefined);
        line = "Failed";
        yield [failedItem(name, body?.error ?? `Ollama answered ${res.status}`)];
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      let lastYield = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const split = splitLines(rest + value);
        rest = split.rest;
        for (const l of split.lines) {
          try {
            state = reducePull(state, JSON.parse(l));
          } catch {
            // A partial or odd line: keep going.
          }
        }
        // A few updates a second are enough for a progress bar.
        if (Date.now() - lastYield > 250 || state.done) {
          lastYield = Date.now();
          const t = pullTotals(state);
          const secs = (Date.now() - started) / 1000;
          const speed = secs > 1 && t.completed ? `${bytes(t.completed / secs)}/s` : "";
          line = state.error
            ? "Failed"
            : `${statusLabel(state.status)}${t.total ? ` · ${bytes(t.completed)} of ${bytes(t.total)}` : ""}${
              speed && !state.done ? ` · ${speed}` : ""
            }`;
          yield progressItems(name, state, speed);
        }
        if (state.done) break;
      }
      if (state.error) {
        line = "Failed";
        yield [failedItem(name, state.error)];
      } else if (!state.done && !signal.aborted) {
        yield [failedItem(name, "The download stopped before it finished")];
      } else if (state.done) {
        notifyChanged();
        const t = pullTotals(state);
        line = `Done in ${Math.round((Date.now() - started) / 1000)} s${t.total ? ` · ${bytes(t.total)}` : ""}`;
        yield [readyItem(name)];
      }
    },
  });
}

function progressItems(name: string, state: ReturnType<typeof initialPull>, speed: string): Item[] {
  const t = pullTotals(state);
  const pct = `${Math.floor(t.ratio * 100)}%`;
  const overall: Item = {
    id: "overall",
    title: state.done ? `${displayName(name)} is ready` : `Pulling ${displayName(name)}`,
    subtitle: statusLabel(state.status),
    icon: { source: state.done ? Icons.done : Icons.download, tint: state.done ? "green" : "blue" },
    section: "Progress",
    accessories: [...(speed && !state.done ? [{ text: speed }] : []), { tag: pct, color: "blue" }],
    detail: {
      stats: [
        { label: "done", value: pct, color: "blue" },
        { label: "downloaded", value: bytes(t.completed) },
        { label: "size", value: t.total ? bytes(t.total) : "…" },
      ],
      metadata: [
        meta.progress("Progress", t.ratio, t.total ? `${bytes(t.completed)} of ${bytes(t.total)}` : pct),
        meta.text("Step", statusLabel(state.status), { icon: Icons.inProgress }),
        ...(speed ? [meta.text("Speed", speed, { icon: Icons.bolt })] : []),
        meta.separator(),
        meta.link("Library", libraryUrl(name).replace(/^https:\/\//, ""), libraryUrl(name)),
      ],
      markdown: "Leaving this view cancels the download; pulling again resumes it.",
    },
    actions: [
      copy(`ollama pull ${name}`, "Copy Pull Command", { icon: Icons.terminal }),
      open(libraryUrl(name), "Open in Ollama Library"),
    ],
  };
  const layers: Item[] = state.layers.map((l) => {
    const ratio = l.total ? Math.min(1, l.completed / l.total) : 0;
    const done = ratio >= 1;
    return {
      id: l.digest,
      title: `Layer ${l.digest.replace(/^sha256:/, "").slice(0, 12)}`,
      subtitle: `${bytes(Math.min(l.completed, l.total))} of ${bytes(l.total)}`,
      icon: { source: done ? Icons.done : Icons.inProgress, tint: done ? "green" : "blue" },
      section: "Layers",
      accessories: [{ text: `${Math.floor(ratio * 100)}%`, color: done ? "green" as const : undefined }],
      detail: { metadata: [meta.progress("Layer", ratio), meta.text("Digest", l.digest, { icon: Icons.hash })] },
      actions: [copy(l.digest, "Copy Digest")],
    };
  });
  return [overall, ...layers];
}

function readyItem(name: string): Item {
  return {
    id: "overall",
    title: `${displayName(name)} is ready`,
    subtitle: `ollama run ${name}`,
    icon: { source: Icons.done, tint: "green" },
    section: "Progress",
    accessories: [{ tag: "100%", color: "green" }],
    detail: {
      stats: [{ label: "done", value: "100%", color: "green" }],
      metadata: [meta.progress("Progress", 1, "Downloaded and verified")],
    },
    actions: [
      copy(`ollama run ${name}`, "Copy ollama run Command", { icon: Icons.terminal }),
      action("Done", () => close(`${displayName(name)} is ready`), { icon: Icons.check }),
      open(libraryUrl(name), "Open in Ollama Library"),
    ],
  };
}

function failedItem(name: string, error: string): Item {
  const missing = /file does not exist|not found|manifest unknown/i.test(error);
  return {
    id: "failed",
    title: missing ? `No model named ${name}` : `Pulling ${name} failed`,
    subtitle: error,
    icon: { source: Icons.alert, tint: "red" },
    detail: {
      markdown: missing
        ? `Ollama's library has no **${name}**. Check the name and tag on ollama.com/library.`
        : `\`\`\`\n${error}\n\`\`\``,
    },
    actions: [
      action("Try Again", () => refresh(), { icon: Icons.refresh }),
      open(
        missing ? `https://ollama.com/search?q=${encodeURIComponent(name.split(":")[0])}` : libraryUrl(name),
        "Search the Library",
      ),
      copy(error, "Copy Error", { section: "Copy" }),
    ],
  };
}
