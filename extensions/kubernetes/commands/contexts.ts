import { action, copy, Icons, type Item, list, meta, refresh } from "@backslash/api";
import { type KubeContext, shortServer } from "../lib.ts";
import { errorItem, isMissing, kubeconfig, kubectlMissing, showTarget, target, useContext } from "../kube.ts";

function item(c: KubeContext, current: boolean): Item {
  return {
    id: c.name,
    title: c.name,
    subtitle: shortServer(c.server),
    icon: { source: current ? Icons.check : Icons.server, tint: current ? "green" : "blue" },
    section: current ? "Current Context" : "Contexts",
    keywords: [c.cluster, c.user, c.namespace ?? "", c.server ?? ""],
    accessories: [
      ...(c.namespace ? [{ icon: Icons.layers, text: c.namespace, tooltip: "Namespace" }] : []),
      ...(current ? [{ tag: "Current", color: "green" as const }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Cluster", c.cluster, { icon: Icons.server }),
        ...(c.server ? [meta.text("Server", c.server, { icon: Icons.globe })] : []),
        meta.person("User", c.user),
        meta.text("Namespace", c.namespace ?? "default", { icon: Icons.layers }),
        meta.separator(),
        meta.text("Status", current ? "Current context" : "Available", {
          icon: Icons.dot,
          color: current ? "green" : "gray",
        }),
      ],
    },
    actions: [
      ...(current ? [] : [action("Switch to Context", async () => {
        await useContext(c.name);
        return refresh();
      }, { icon: Icons.arrowRight })]),
      copy(c.name, "Copy Context Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`kubectl config use-context ${c.name}`, "Copy use-context Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
      ...(c.server ? [copy(c.server, "Copy Server URL", { icon: Icons.globe, section: "Copy" })] : []),
    ],
  };
}

export default list({
  placeholder: "Switch Kubernetes context…",
  empty: { title: "No contexts", description: "Add a cluster to ~/.kube/config", icon: Icons.server },
  status: (items) => `${items.filter((i) => i.id !== "missing" && i.id !== "error").length} contexts`,
  async items({ signal }) {
    try {
      const config = await kubeconfig(signal);
      await showTarget(target(config));
      return config.contexts
        .map((c) => item(c, c.name === config.current))
        .sort((a, b) => Number(b.section === "Current Context") - Number(a.section === "Current Context"));
    } catch (err) {
      return [isMissing(err) ? kubectlMissing : errorItem(err)];
    }
  },
});
