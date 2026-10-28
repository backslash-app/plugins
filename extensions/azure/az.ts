// Calling the az CLI, and the items every command shares (missing CLI, sign-in,
// errors, subscription switching).

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
import { classifyError, installCommand, osFamily, parseAccount, parseSubscriptions, type Subscription } from "./lib.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export interface Prefs {
  terminal?: string;
  sshUser?: string;
}

/** az with JSON output and no prompts or progress output. */
export function az(args: string[], signal?: AbortSignal): Promise<string> {
  return exec("az", [...args, "--output", "json", "--only-show-errors"], { signal });
}

export const isMissing = (err: unknown) => err instanceof Deno.errors.NotFound;

/** The signed-in account and its current subscription (`az account show`). */
export async function account(signal?: AbortSignal): Promise<Subscription> {
  return parseAccount(await az(["account", "show"], signal));
}

export async function useSubscription(s: Subscription) {
  await exec("az", ["account", "set", "--subscription", s.id, "--only-show-errors"]);
  await toast(`Switched to ${s.name}`, { style: "success", message: "az account set" });
}

export async function showSubscription(s: Subscription | undefined, extra?: string) {
  await updateCommandMetadata({ subtitle: s ? [s.name, extra].filter(Boolean).join(" · ") : null }).catch(() => {});
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

/** "Switch Subscription ›", loaded when opened. */
export function subscriptionActions(): Action[] {
  return [
    submenu("Switch Subscription", async () => {
      const subs = parseSubscriptions(await az(["account", "list"]));
      return subs.map((s) =>
        action(s.name, async () => {
          await useSubscription(s);
          return refresh();
        }, { icon: s.isDefault ? Icons.check : Icons.key })
      );
    }, { icon: Icons.key, shortcut: "<Ctrl><Shift>p", section: "Subscription" }),
  ];
}

let hint: Promise<string> | undefined;
const installHint = () =>
  hint ??= Deno.readTextFile("/etc/os-release").catch(() => "").then((t) => installCommand(osFamily(t)));

export async function azMissing(): Promise<Item> {
  const cmd = await installHint();
  return {
    id: "missing",
    title: "The Azure CLI is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs the **az** command with the account you signed in with.",
        "",
        "```sh",
        cmd,
        "az login",
        "```",
      ].join("\n"),
    },
    actions: [
      copy(cmd, "Copy Install Command", { icon: Icons.terminal }),
      open("https://learn.microsoft.com/cli/azure/install-azure-cli-linux", "Open Install Guide"),
    ],
  };
}

export function loginAction(prefs: Prefs, section = "Fix"): Action {
  return inTerminal("Sign In with az login", ["az", "login"], prefs, { icon: Icons.key, section, hold: true });
}

/** An error as an item, with the way out (az login, switch subscription). */
export function errorItem(err: unknown, s: Subscription | undefined, prefs: Prefs): Item {
  const e = classifyError(err);
  const fixes: Action[] = e.problem === "login" ? [loginAction(prefs)] : [];
  return {
    id: "error",
    title: e.title,
    subtitle: e.problem === "login"
      ? "Run az login in a terminal (Enter), then come back"
      : [s?.name, s?.user].filter(Boolean).join(" · "),
    icon: { source: e.problem === "login" ? Icons.key : Icons.alert, tint: e.problem === "other" ? "red" : "orange" },
    detail: { markdown: `\`\`\`\n${e.message.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
    actions: [
      ...fixes,
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(e.problem === "login" ? [] : subscriptionActions()),
      copy(e.message, "Copy Error", { section: "Copy" }),
    ],
  };
}

/**
 * Checks the CLI and the sign-in (`az account show`) while the command's own
 * call runs; problems become a single helpful item.
 */
export async function guarded(
  prefs: Prefs,
  signal: AbortSignal,
  load: (s: Subscription) => Promise<Item[]>,
): Promise<Item[]> {
  let s: Subscription | undefined;
  try {
    s = await account(signal);
    return await load(s);
  } catch (err) {
    if (isMissing(err)) return [await azMissing()];
    if (signal.aborted) throw err;
    await showSubscription(undefined);
    return [errorItem(err, s, prefs)];
  }
}

/** Runs a long az operation without waiting, then tells the user and reloads. */
export async function runOperation(args: string[], message: string) {
  await az(args);
  await toast(message, { style: "success" });
  return refresh();
}
