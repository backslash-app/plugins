// Calling helm and kubectl, and the items the views share.

import { type Action, action, copy, exec, Icons, type Item, open, refresh, submenu, toast } from "@backslash/api";
import { classifyError, installCommand, type Kubeconfig, osFamily, parseKubeconfig } from "./lib.ts";

export interface Prefs {
  terminal?: string;
}

export class Timeout extends Error {}

/** helm with a deadline, so an unreachable cluster doesn't hang the launcher. */
export async function helm(argv: string[], signal?: AbortSignal, seconds = 20): Promise<string> {
  const deadline = AbortSignal.timeout(seconds * 1000);
  try {
    return await exec(argv[0], argv.slice(1), { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  } catch (err) {
    if (deadline.aborted && !signal?.aborted) throw new Timeout(`helm did not answer within ${seconds} seconds`);
    throw err;
  }
}

export const isMissing = (err: unknown) => err instanceof Deno.errors.NotFound;

/** The kubeconfig, or undefined when kubectl is not installed (helm still works on its own). */
export async function kubeconfig(signal?: AbortSignal): Promise<Kubeconfig | undefined> {
  try {
    return parseKubeconfig(await exec("kubectl", ["config", "view", "-o", "json"], { signal }));
  } catch (err) {
    if (isMissing(err)) return undefined;
    throw err;
  }
}

export async function useContext(name: string) {
  await exec("kubectl", ["config", "use-context", name]);
  await toast(`Switched to ${name}`, { style: "success" });
}

/** "Switch Context ›", loaded when opened. */
export function contextActions(): Action[] {
  return [
    submenu("Switch Context", async () => {
      const config = await kubeconfig();
      if (!config) throw new Error("kubectl is needed to switch contexts");
      if (!config.contexts.length) throw new Error("No context in your kubeconfig");
      return config.contexts.map((c) =>
        action(c.name, async () => {
          await useContext(c.name);
          return refresh();
        }, { icon: c.name === config.current ? Icons.check : Icons.server })
      );
    }, { icon: Icons.server, shortcut: "<Ctrl><Shift>k", section: "Cluster" }),
  ];
}

let hint: Promise<string> | undefined;
const installHint = () =>
  hint ??= Deno.readTextFile("/etc/os-release").catch(() => "").then((t) => installCommand(osFamily(t)));

export async function helmMissing(): Promise<Item> {
  const cmd = await installHint();
  return {
    id: "missing",
    title: "Helm is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs **helm** with your kubeconfig (`~/.kube/config` or `$KUBECONFIG`).",
        "",
        "```sh",
        cmd,
        "```",
        "",
        "**kubectl** is optional: with it, the list shows the current context and switches it.",
      ].join("\n"),
    },
    actions: [
      copy(cmd, "Copy Install Command", { icon: Icons.terminal }),
      open("https://helm.sh/docs/intro/install/", "Open Install Guide"),
    ],
  };
}

/** An error as an item, with the way out. */
export function errorItem(err: unknown, context?: string): Item {
  const message = err instanceof Error ? err.message : String(err);
  const clean = message.replace(/^(helm|kubectl) exited with \d+: /, "");
  const e = classifyError(clean);
  return {
    id: "error",
    title: err instanceof Timeout ? "Cannot reach the cluster" : e.title,
    subtitle: context,
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: `\`\`\`\n${clean.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...contextActions(),
      copy(clean, "Copy Error", { section: "Copy" }),
    ],
  };
}
