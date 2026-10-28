import { type Context, list } from "@backslash/api";
import { guarded, trello } from "../api.ts";
import type { Board, Organization } from "../lib.ts";
import { boardItem } from "../views.ts";

let counts = { boards: 0, starred: 0 };

export default (ctx: Context) =>
  list({
    placeholder: "Filter boards…",
    empty: { title: "No open board", description: "Create a board in Trello first.", icon: "bs-kanban" },
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : `${counts.boards} board${counts.boards === 1 ? "" : "s"}${
          counts.starred ? ` · ${counts.starred} starred` : ""
        }`,
    items: ({ preferences, signal }) =>
      guarded(preferences, async (a) => {
        const [boards, orgs] = await Promise.all([
          trello<Board[]>(a, "/members/me/boards", {
            params: {
              filter: "open",
              fields: "name,desc,url,shortUrl,starred,idOrganization,dateLastActivity,prefs",
              lists: "open",
              list_fields: "name",
            },
            signal,
          }),
          trello<Organization[]>(a, "/members/me/organizations", { params: { fields: "displayName" }, signal })
            .catch(() => [] as Organization[]),
        ]);
        const names = new Map(orgs.map((o) => [o.id, o.displayName]));
        counts = { boards: boards.length, starred: boards.filter((b) => b.starred).length };
        const workspace = (b: Board) =>
          b.idOrganization ? names.get(b.idOrganization) ?? "Other Workspace" : "Personal";
        return [...boards]
          .sort((x, y) =>
            Number(!!y.starred) - Number(!!x.starred) ||
            (x.starred ? 0 : workspace(x).localeCompare(workspace(y))) ||
            (y.dateLastActivity ?? "").localeCompare(x.dateLastActivity ?? "")
          )
          .map((b) => boardItem(a, b, ctx.preferences, workspace(b)));
      }),
  });
