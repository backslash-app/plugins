import { type Context, list } from "@backslash/api";
import { configured, guarded, isProblem, netlify, setupAll, vercel } from "../api.ts";
import { netlifyItem, type NetlifySite, vercelItem, type VercelProject } from "../lib.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Filter Vercel projects and Netlify sites…",
    empty: { title: "No projects", icon: "bs-rocket" },
    status: (items) => {
      const n = items.filter((i) => !isProblem(i)).length;
      return n || !items.length ? `${n} project${n === 1 ? "" : "s"}` : "Not connected";
    },
    async items(c) {
      const providers = configured(c.preferences);
      if (!providers.length) return setupAll();
      const rows = await Promise.all(providers.map((p) =>
        guarded(p, async () => {
          if (p === "vercel") {
            const data = await vercel<{ projects: VercelProject[] }>(c.preferences, "/v9/projects?limit=50", {
              signal: c.signal,
            });
            return data.projects.map((project) => vercelItem(project, ctx));
          }
          const sites = await netlify<NetlifySite[]>(
            c.preferences,
            "/sites?filter=all&sort_by=updated_at&per_page=50",
            {
              signal: c.signal,
            },
          );
          return sites.map((site) => netlifyItem(site, ctx));
        })
      ));
      return rows.flat();
    },
  });
