import { Icons, type Item, list } from "@backslash/api";
import { each, eventLinks } from "../api.ts";
import { type Account, accountsOf, SetupError, setupItem } from "../lib.ts";
import { linkItem, pageItem, report } from "../views.ts";

export default list({
  placeholder: "Filter event types…",
  status: (items) => {
    const n = items.filter((i) => !i.id?.endsWith(":page") && i.id !== "setup").length;
    return n ? `${n} event type${n === 1 ? "" : "s"} · Enter copies the link` : "";
  },
  empty: {
    title: "No event type",
    description: "Create one in Cal.com or Calendly, then it shows here.",
    icon: Icons.link,
  },
  async items({ preferences, signal }) {
    let accounts: Account[];
    try {
      accounts = accountsOf(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const r = await each(accounts, (a) => eventLinks(a, signal));
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    return r.ok.flatMap(({ account, value }): Item[] => [
      // Visible ones first, hidden (secret) ones after: both can be shared.
      ...[...value.links].sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.title.localeCompare(b.title))
        .map((l) => linkItem(account, l, many)),
      ...(value.page ? [pageItem(account.provider, value.page, many)] : []),
    ]);
  },
});
