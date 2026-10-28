// Running terraform or tofu, and the items the project views share.

import { action, close, copy, Icons, type Item, open, refresh } from "@backslash/api";
import { classifyError, cleanError, installCommands, osFamily } from "./lib.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export interface Prefs {
  folders?: string;
  depth?: number;
  program?: string;
  terminal?: string;
}

export type Program = "terraform" | "tofu";

export const PROGRAM_NAMES: Record<Program, string> = { terraform: "Terraform", tofu: "OpenTofu" };

export class Missing extends Error {}

/** Never prompts, never colors: what the launcher needs. */
const ENV = { TF_IN_AUTOMATION: "1", TF_INPUT: "0", NO_COLOR: "1", CHECKPOINT_DISABLE: "1" };

/** Runs a program; throws its stderr on failure. `allowFailure` returns stdout anyway. */
export async function run(
  program: string,
  args: string[],
  options: { signal?: AbortSignal; allowFailure?: boolean } = {},
): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: options.signal,
      env: ENV,
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Missing(`${program} is not installed`);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trimEnd();
  if (!out.success && !options.allowFailure) {
    throw new Error(cleanError(text(out.stderr) || text(out.stdout) || `${program} failed`));
  }
  return text(out.stdout);
}

let detected: Promise<Program> | undefined;

/** The preferred program, or the first installed one. */
export function program(prefs: Prefs): Promise<Program> {
  const wanted = String(prefs.program ?? "").trim().toLowerCase();
  if (wanted === "tofu" || wanted === "opentofu") return Promise.resolve("tofu");
  if (wanted === "terraform") return Promise.resolve("terraform");
  return detected ??= (async () => {
    for (const p of ["terraform", "tofu"] as Program[]) {
      try {
        await run(p, ["version", "-json"]);
        return p;
      } catch (e) {
        if (!(e instanceof Missing)) return p;
      }
    }
    throw new Missing("Neither terraform nor tofu is installed");
  })();
}

/** `terraform -chdir=<dir> …` */
export const tf = (p: Program, dir: string, args: string[], signal?: AbortSignal) =>
  run(p, [`-chdir=${dir}`, ...args], { signal });

/** The command line run in the terminal for a project. */
export const tfArgv = (p: Program, dir: string, args: string[]) => [p, `-chdir=${dir}`, ...args];

export function inTerminal(
  title: string,
  argv: string[],
  prefs: Prefs,
  o: { icon?: string; shortcut?: string; section?: string; confirm?: string; destructive?: boolean } = {},
) {
  return action(title, () => {
    const term = runInTerminal(holdOpen(argv), prefs.terminal || undefined);
    return close(`Opened in ${term}`);
  }, {
    icon: o.icon ?? Icons.terminal,
    shortcut: o.shortcut,
    section: o.section ?? "Terraform",
    confirm: o.confirm,
    destructive: o.destructive,
  });
}

let hint: Promise<string> | undefined;
const osRelease = () => hint ??= Deno.readTextFile("/etc/os-release").catch(() => "");

export async function missingItem(): Promise<Item> {
  const cmds = installCommands(osFamily(await osRelease()));
  return {
    id: "missing",
    title: "Neither Terraform nor OpenTofu is installed",
    subtitle: cmds.tofu,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs **terraform** or **tofu** (OpenTofu) in your projects.",
        "",
        "```sh",
        `${cmds.tofu}   # OpenTofu`,
        `${cmds.terraform}`,
        "```",
        "",
        "Pick one in the preferences if both are installed.",
      ].join("\n"),
    },
    actions: [
      copy(cmds.tofu.replace(/\s+#.*$/, ""), "Copy OpenTofu Install Command", { icon: Icons.terminal }),
      copy(cmds.terraform.replace(/\s+#.*$/, ""), "Copy Terraform Install Command", { icon: Icons.terminal }),
      open("https://opentofu.org/docs/intro/install/", "Open OpenTofu Install Guide"),
      open("https://developer.hashicorp.com/terraform/install", "Open Terraform Install Guide"),
    ],
  };
}

/** A failed terraform call as an item, with the way out. */
export function errorItem(err: unknown, p: Program, dir: string, prefs: Prefs): Item {
  const message = err instanceof Error ? err.message : String(err);
  const e = classifyError(message);
  const fixes = [];
  if (e.problem === "init") {
    fixes.push(inTerminal(`Run ${p} init`, tfArgv(p, dir, ["init"]), prefs, { icon: Icons.download, section: "Fix" }));
  }
  return {
    id: "error",
    title: e.title,
    subtitle: message.split("\n")[0],
    icon: { source: Icons.alert, tint: e.problem === "init" ? "orange" : "red" },
    detail: { markdown: `\`\`\`\n${message.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
    actions: [
      ...fixes,
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}
