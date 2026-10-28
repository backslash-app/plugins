import { action, copy, Icons, type Item, list, meta, refresh } from "@backslash/api";
import { age, parseNamespaces } from "../lib.ts";
import {
  clusterActions,
  errorItem,
  isMissing,
  kubeconfig,
  kubectl,
  kubectlMissing,
  noContext,
  showTarget,
  target,
  useNamespace,
} from "../kube.ts";

let summary = "";

export default list({
  placeholder: "Switch namespace…",
  empty: { title: "No namespaces", icon: Icons.layers },
  status: () => summary,
  actions: clusterActions(),
  async items({ signal }) {
    summary = "";
    let t;
    try {
      t = target(await kubeconfig(signal));
    } catch (err) {
      return [isMissing(err) ? kubectlMissing : errorItem(err)];
    }
    await showTarget(t);
    if (!t) return [noContext];
    const current = t;
    try {
      const namespaces = parseNamespaces(
        await kubectl(["--context", t.context, "get", "namespaces", "-o", "json"], signal),
      );
      summary = `${current.context} · ${namespaces.length} namespaces`;
      return namespaces
        .sort((a, b) => Number(b.name === current.namespace) - Number(a.name === current.namespace))
        .map((ns): Item => {
          const isCurrent = ns.name === current.namespace;
          const active = ns.phase === "Active";
          return {
            id: ns.name,
            title: ns.name,
            icon: {
              source: isCurrent ? Icons.check : Icons.layers,
              tint: isCurrent ? "green" : active ? "blue" : "orange",
            },
            section: isCurrent ? "Current Namespace" : "Namespaces",
            accessories: [
              ...(active ? [] : [{ tag: ns.phase, color: "orange" as const }]),
              ...(isCurrent ? [{ tag: "Current", color: "green" as const }] : []),
              { text: age(ns.created), tooltip: "Age" },
            ],
            detail: {
              metadata: [
                meta.text("Status", ns.phase, { icon: Icons.dot, color: active ? "green" : "orange" }),
                meta.text("Context", current.context, { icon: Icons.server }),
                ...(ns.created
                  ? [meta.text("Created", ns.created.toLocaleString("en-GB"), { icon: Icons.calendar })]
                  : []),
              ],
            },
            actions: [
              ...(isCurrent ? [] : [action("Switch to Namespace", async () => {
                await useNamespace(current, ns.name);
                return refresh();
              }, { icon: Icons.arrowRight })]),
              copy(ns.name, "Copy Namespace", { shortcut: "<Ctrl>period", section: "Copy" }),
              copy(`kubectl config set-context --current --namespace=${ns.name}`, "Copy set-context Command", {
                icon: Icons.terminal,
                section: "Copy",
              }),
            ],
          };
        });
    } catch (err) {
      return [errorItem(err, current)];
    }
  },
});
