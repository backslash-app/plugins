// Calling kubectl, and the bits the three commands share.

import {
  type Action,
  action,
  copy,
  exec,
  Icons,
  type Item,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Kubeconfig, parseKubeconfig, parseNamespaces, type Target } from "./lib.ts";

/** API calls give up after 10 s instead of hanging on an unreachable cluster. */
export function kubectl(args: string[], signal?: AbortSignal): Promise<string> {
  const api = !["config"].includes(args[0]);
  return exec("kubectl", api ? ["--request-timeout=10s", ...args] : args, { signal });
}

export const isMissing = (err: unknown) => err instanceof Deno.errors.NotFound;

export async function kubeconfig(signal?: AbortSignal): Promise<Kubeconfig> {
  return parseKubeconfig(await kubectl(["config", "view", "-o", "json"], signal));
}

/** The current context and its namespace (default when unset). */
export function target(config: Kubeconfig): Target | undefined {
  const ctx = config.contexts.find((c) => c.name === config.current);
  return ctx ? { context: ctx.name, namespace: ctx.namespace ?? "default" } : undefined;
}

export async function showTarget(t: Target | undefined) {
  await updateCommandMetadata({ subtitle: t ? `${t.context} · ${t.namespace}` : null }).catch(() => {});
}

export async function useContext(name: string) {
  await kubectl(["config", "use-context", name]);
  await toast(`Switched to ${name}`, { style: "success" });
}

export async function useNamespace(t: Target, namespace: string) {
  await kubectl(["config", "set-context", t.context, `--namespace=${namespace}`]);
  await toast(`Namespace ${namespace}`, { style: "success" });
}

/** "Switch Context ›" and "Switch Namespace ›", loaded when opened. */
export function clusterActions(): Action[] {
  return [
    submenu("Switch Context", async () => {
      const config = await kubeconfig();
      return config.contexts.map((c) =>
        action(c.name, async () => {
          await useContext(c.name);
          return refresh();
        }, { icon: c.name === config.current ? Icons.check : Icons.server })
      );
    }, { icon: Icons.server, shortcut: "<Ctrl><Shift>k", section: "Cluster" }),
    submenu("Switch Namespace", async () => {
      const t = target(await kubeconfig());
      if (!t) throw new Error("Pick a context first");
      const namespaces = parseNamespaces(await kubectl(["--context", t.context, "get", "namespaces", "-o", "json"]));
      return namespaces.map((ns) =>
        action(ns.name, async () => {
          await useNamespace(t, ns.name);
          return refresh();
        }, { icon: ns.name === t.namespace ? Icons.check : Icons.layers })
      );
    }, { icon: Icons.layers, shortcut: "<Ctrl><Shift>n", section: "Cluster" }),
  ];
}

export const kubectlMissing: Item = {
  id: "missing",
  title: "kubectl is not installed",
  subtitle: "Install it to see your clusters",
  icon: { source: Icons.alert, tint: "orange" },
  detail: {
    markdown: [
      "This extension uses **kubectl** and your kubeconfig (`~/.kube/config` or `$KUBECONFIG`).",
      "",
      "```sh",
      "sudo dnf install kubernetes-client   # Fedora",
      "sudo snap install kubectl --classic  # Ubuntu",
      "sudo pacman -S kubectl               # Arch",
      "```",
    ].join("\n"),
  },
  actions: [copy("sudo snap install kubectl --classic", "Copy snap Command", { icon: Icons.terminal })],
};

export const noContext: Item = {
  id: "no-context",
  title: "No current context",
  subtitle: "Pick one, or add a cluster to your kubeconfig",
  icon: { source: Icons.alert, tint: "yellow" },
  detail: {
    markdown:
      "kubectl has no current context. Choose one with **Switch Context** (Ctrl+Shift+K), or add a cluster to `~/.kube/config`.",
  },
  actions: clusterActions(),
};

/** An error as an item, with the way out. */
export function errorItem(err: unknown, t?: Target): Item {
  const message = err instanceof Error ? err.message.replace(/^kubectl exited with \d+: /, "") : String(err);
  return {
    id: "error",
    title: /Unable to connect|timeout|connection refused|no such host/i.test(message)
      ? "Cannot reach the cluster"
      : "kubectl failed",
    subtitle: t ? `${t.context} · ${t.namespace}` : undefined,
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: `\`\`\`\n${message}\n\`\`\`` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh }),
      ...clusterActions(),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}
