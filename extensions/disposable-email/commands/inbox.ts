import { Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { accounts, current, forget, GoneError, messages } from "../api.ts";
import { addressItem, createItem, loadFull, messageItem, pause } from "../views.ts";

const POLL = 5000;

let summary = "";

// The current address and its messages, checked every few seconds while open.
export default list({
  placeholder: "Filter messages by subject, sender or code…",
  empty: { title: "No messages yet", description: "Mail sent to the address shows up here", icon: Icons.inbox },
  status: () => summary,
  async *items({ signal }) {
    summary = "";
    let failures = 0;
    let lastUnread = -1;
    while (!signal.aborted) {
      const account = await current();
      if (!account) {
        summary = "Create an address to start";
        yield [createItem()];
        await pause(60_000, signal);
        continue;
      }
      let items: Item[];
      try {
        const [list, all] = await Promise.all([messages(account, signal), accounts()]);
        // The first page shows from the summaries; codes and links fill in once the messages are read.
        const render = () => [addressItem(account, all, list.length), ...list.map((m) => messageItem(account, all, m))];
        yield render();
        await loadFull(account, list, signal);
        items = render();
        failures = 0;
        const unread = list.filter((m) => !m.seen).length;
        summary = `${list.length} message${list.length === 1 ? "" : "s"}${unread ? ` · ${unread} unread` : ""} · live`;
        if (unread !== lastUnread) {
          lastUnread = unread;
          await updateCommandMetadata({ subtitle: unread ? `${unread} unread` : null }).catch(() => {});
        }
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof GoneError) {
          await forget(account.id);
          summary = "Address gone";
          yield [createItem(account)];
          await pause(60_000, signal);
          continue;
        }
        // A hiccup while polling keeps the last list; three in a row show the error.
        if (++failures < 3) {
          await pause(POLL, signal);
          continue;
        }
        throw e;
      }
      yield items;
      await pause(POLL, signal);
    }
  },
});
