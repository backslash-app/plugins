import { type Context, type Item, list, updateCommandMetadata } from "@backslash/api";
import { configured, guarded, isProblem, NAMES, type Provider, setupAll, setupItem } from "../api.ts";
import {
  daySection,
  type Deployment,
  deploymentItem,
  inProgress,
  loadNetlify,
  loadVercel,
  sortDeployments,
} from "../lib.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Filter deployments by project, branch, commit, author, status…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "vercel", title: "Vercel" },
        { value: "netlify", title: "Netlify" },
      ],
    },
    empty: { title: "No deployments yet", icon: "bs-rocket" },
    status: (items) => {
      const deployments = items.filter((i) => !isProblem(i));
      if (!deployments.length && items.length) return "Not connected";
      const building = deployments.filter((i) => i.section === "In progress").length;
      return `${deployments.length} deployments${building ? ` · ${building} in progress` : ""}`;
    },
    async *items(c) {
      const only = c.filter === "vercel" || c.filter === "netlify" ? c.filter as Provider : undefined;
      const providers = configured(c.preferences).filter((p) => !only || p === only);
      if (!providers.length) {
        yield only ? [setupItem(only, `Add a ${NAMES[only]} access token`)] : setupAll();
        return;
      }
      // Each provider shows up as soon as it answers.
      const deployments: Deployment[] = [];
      const problems: Item[] = [];
      const render = () => [
        ...sortDeployments(deployments).map((d) => deploymentItem(d, ctx, { section: daySection(d) })),
        ...problems,
      ];
      const pending = new Map(providers.map((p, i) => [
        i,
        guarded(p, async () => {
          deployments.push(...await (p === "vercel" ? loadVercel(c) : loadNetlify(c)));
          return [];
        }).then((rows) => {
          problems.push(...rows);
          return i;
        }),
      ]));
      while (pending.size) {
        pending.delete(await Promise.race(pending.values()));
        if (pending.size) yield render();
      }
      if (!only) {
        const building = deployments.filter(inProgress).length;
        updateCommandMetadata({ subtitle: building ? `${building} deploying…` : null }).catch(() => {});
      }
      yield render();
    },
  });
