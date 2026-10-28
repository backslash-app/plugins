// Calling gcloud, and the items the commands share (missing CLI, sign-in,
// errors, project switching).

import {
  type Action,
  action,
  close,
  copy,
  exec,
  Icons,
  type Item,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { classifyError, type GcloudConfig, installCommand, osFamily, parseConfig, parseProjects } from "./lib.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export interface Prefs {
  terminal?: string;
}

/** gcloud with JSON output, never prompting. */
export function gcloud(args: string[], signal?: AbortSignal): Promise<string> {
  return exec("gcloud", [...args, "--format=json", "--quiet"], { signal });
}

export const isMissing = (err: unknown) => err instanceof Deno.errors.NotFound;

export async function config(signal?: AbortSignal): Promise<GcloudConfig> {
  return parseConfig(await gcloud(["config", "list"], signal));
}

export async function useProject(id: string) {
  await exec("gcloud", ["config", "set", "project", id, "--quiet"]);
  await toast(`Switched to ${id}`, { style: "success", message: "gcloud config set project" });
}

export async function showProject(c: GcloudConfig, extra?: string) {
  await updateCommandMetadata({ subtitle: c.project ? [c.project, extra].filter(Boolean).join(" · ") : null })
    .catch(() => {});
}

export function inTerminal(
  title: string,
  argv: string[],
  prefs: Prefs,
  o: { icon?: string; shortcut?: string; section?: string; hold?: boolean } = {},
): Action {
  return action(title, () => {
    const term = runInTerminal(o.hold ? holdOpen(argv) : argv, prefs.terminal || undefined);
    return close(`Opened in ${term}`);
  }, { icon: o.icon ?? Icons.terminal, shortcut: o.shortcut, section: o.section ?? "Terminal" });
}

/** "Switch Project ›", loaded when opened. */
export function projectActions(): Action[] {
  return [
    submenu("Switch Project", async () => {
      const [c, projects] = await Promise.all([config(), gcloud(["projects", "list"]).then(parseProjects)]);
      return projects.map((p) =>
        action(`${p.name} (${p.id})`, async () => {
          await useProject(p.id);
          return refresh();
        }, { icon: p.id === c.project ? Icons.check : Icons.project })
      );
    }, { icon: Icons.project, shortcut: "<Ctrl><Shift>p", section: "Project" }),
  ];
}

let hint: Promise<string> | undefined;
const installHint = () =>
  hint ??= Deno.readTextFile("/etc/os-release").catch(() => "").then((t) => installCommand(osFamily(t)));

export async function gcloudMissing(): Promise<Item> {
  const cmd = await installHint();
  return {
    id: "missing",
    title: "The Google Cloud CLI is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs **gcloud** with your active configuration.",
        "",
        "```sh",
        cmd,
        "gcloud init",
        "```",
      ].join("\n"),
    },
    actions: [
      copy(cmd.replace(/\s+#.*$/, ""), "Copy Install Command", { icon: Icons.terminal }),
      open("https://cloud.google.com/sdk/docs/install", "Open Install Guide"),
    ],
  };
}

export function noProject(prefs: Prefs): Item {
  return {
    id: "no-project",
    title: "No project selected",
    subtitle: "Pick one with Switch Project (Ctrl+Shift+P)",
    icon: { source: Icons.project, tint: "yellow" },
    detail: { markdown: "gcloud has no current project. Choose one, or run `gcloud init`." },
    actions: [
      ...projectActions(),
      inTerminal("Run gcloud init", ["gcloud", "init"], prefs, { section: "Setup" }),
    ],
  };
}

/** An error as an item, with the way out. */
export function errorItem(err: unknown, c: GcloudConfig | undefined, prefs: Prefs): Item {
  const e = classifyError(err);
  const fixes: Action[] = [];
  if (e.problem === "auth") {
    fixes.push(inTerminal("Sign In with gcloud auth login", ["gcloud", "auth", "login"], prefs, {
      icon: Icons.key,
      section: "Fix",
      hold: true,
    }));
  }
  if (e.problem === "api" && c?.project) {
    fixes.push(open(
      `https://console.cloud.google.com/apis/library/${e.api ?? ""}?project=${c.project}`,
      "Enable the API",
      { icon: Icons.plug, section: "Fix" },
    ));
  }
  return {
    id: "error",
    title: e.title,
    subtitle: [c?.project, c?.account].filter(Boolean).join(" · "),
    icon: { source: Icons.alert, tint: e.problem === "denied" || e.problem === "api" ? "orange" : "red" },
    detail: { markdown: `\`\`\`\n${e.message.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
    actions: [
      ...fixes,
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...projectActions(),
      copy(e.message, "Copy Error", { section: "Copy" }),
    ],
  };
}

/** Loads the config, then the project's items; problems become a single helpful item. */
export async function guarded(
  prefs: Prefs,
  signal: AbortSignal,
  load: (c: GcloudConfig & { project: string }) => Promise<Item[]>,
): Promise<Item[]> {
  let c: GcloudConfig | undefined;
  try {
    c = await config(signal);
    if (!c.project) return [noProject(prefs)];
    return await load(c as GcloudConfig & { project: string });
  } catch (err) {
    if (isMissing(err)) return [await gcloudMissing()];
    if (signal.aborted) throw err;
    return [errorItem(err, c, prefs)];
  }
}
