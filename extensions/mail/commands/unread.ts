import { action, type Context, Icons, type Item, list, refresh, updateCommandMetadata } from "@backslash/api";
import { session } from "../imap.ts";
import { type Account, accountsFrom, unreadSubtitle } from "../lib.ts";
import { accountErrorItem, inboxZeroItem, messageItem, problemItem, sectionTitle, setupItems } from "../views.ts";

/** Messages loaded per account (the newest unread ones). */
const LIMIT = 40;

let unread = 0;
let failed = 0;

export default (ctx: Context) => {
  const { accounts, problems } = accountsFrom(ctx.preferences);
  const multi = accounts.length > 1;
  return list({
    placeholder: "Filter unread mail by sender, subject or text…",
    filter: multi
      ? {
        options: [
          { value: "all", title: "All Accounts" },
          ...accounts.map((a) => ({ value: String(a.index), title: a.email })),
        ],
      }
      : undefined,
    empty: { title: "No unread mail", description: "Inbox zero", icon: Icons.done },
    actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    status: (items) => {
      if (items[0]?.id === "setup") return "No account";
      const parts = [`${unread} unread`];
      if (multi) parts.push(`${accounts.length} accounts`);
      if (failed) parts.push(`${failed} failed`);
      return parts.join(" · ");
    },
    async *items({ filter }) {
      const head = problems.map(problemItem);
      if (!accounts.length) {
        yield [...head, ...(problems.length ? [] : setupItems())];
        return;
      }
      const shown = accounts.filter((a) => !multi || !filter || filter === "all" || String(a.index) === filter);
      const results = new Map<number, Item[]>();
      const totals = new Map<number, number>();
      let errors = 0;
      const all = () => [...head, ...shown.flatMap((a) => results.get(a.index) ?? [])];
      const load = async (a: Account) => {
        try {
          const { total, messages } = await session(a, (c) => c.unread(LIMIT));
          totals.set(a.index, total);
          const section = sectionTitle(a, total);
          const uids = messages.map((m) => m.uid);
          results.set(
            a.index,
            messages.length
              ? messages.map((m) => messageItem(m, a, { unreadUids: uids, section }))
              : [inboxZeroItem(a, section)],
          );
        } catch (e) {
          errors++;
          results.set(a.index, [accountErrorItem(a, e, a.email)]);
        }
      };
      // Each account shows as soon as it answers.
      const pending = new Map(shown.map((a) => [a.index, load(a).then(() => a.index)]));
      while (pending.size) {
        const done = await Promise.race(pending.values());
        pending.delete(done);
        unread = [...totals.values()].reduce((n, t) => n + t, 0);
        failed = errors;
        yield all();
      }
      // The root search shows the total across all accounts, whatever the filter.
      if (shown.length === accounts.length && errors < accounts.length) {
        updateCommandMetadata({ subtitle: unreadSubtitle(unread) }).catch(() => {});
      }
    },
  });
};
