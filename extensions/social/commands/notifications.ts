import { action, Icons, type Item, list, refresh, toast, updateCommandMetadata } from "@backslash/api";
import {
  type Accounts,
  accounts,
  bskyMarkRead,
  bskyNotifications,
  cached,
  keep,
  mastodonMarkRead,
  mastodonMe,
  mastodonNotifications,
  SetupError,
} from "../api.ts";
import { asCompleted, byDate, type Network, NETWORK_NAMES, type Notice } from "../lib.ts";
import { noticeItem, setupItems } from "../views.ts";

let status = "";

const FILTERS = [
  { value: "all", title: "All" },
  { value: "mentions", title: "Mentions" },
  { value: "mastodon", title: "Mastodon" },
  { value: "bluesky", title: "Bluesky" },
];

export default list({
  placeholder: "Filter notifications…",
  filter: { options: FILTERS, default: "all" },
  status: () => status,
  empty: { title: "No notifications", description: "Nothing new on your accounts", icon: Icons.bell },
  async *items({ preferences, filter, signal }) {
    let a: Accounts;
    try {
      a = accounts(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        status = "Not connected";
        yield setupItems(e);
        return;
      }
      throw e;
    }
    const f = filter ?? "all";
    const nets = (["mastodon", "bluesky"] as const).filter((n) =>
      a[n] && (f === n || !["mastodon", "bluesky"].includes(f))
    );
    const me = a.mastodon ? await mastodonMe(a.mastodon, signal).then((m) => m.acct).catch(() => "") : "";
    const notices = new Map<Network, Notice[]>();
    const markAll = action("Mark All as Read", async () => {
      const latest = notices.get("mastodon")?.[0];
      await Promise.all([
        a.mastodon && latest ? mastodonMarkRead(a.mastodon, latest.id) : undefined,
        a.bluesky ? bskyMarkRead(a.bluesky) : undefined,
      ]);
      await updateCommandMetadata({ subtitle: null }).catch(() => {});
      await toast("Marked as read", { style: "success" });
      return refresh();
    }, { icon: Icons.check, shortcut: "<Ctrl><Shift>m", section: "Social" });
    const render = (): Item[] => {
      const all = [...notices.values()].flat().sort(byDate)
        .filter((n) => f !== "mentions" || ["mention", "reply", "quote"].includes(n.kind));
      const unread = all.filter((n) => n.unread).length;
      status = `${all.length} notifications${unread ? ` · ${unread} new` : ""}`;
      return all.map((n) => {
        const item = noticeItem(a, n, me);
        return { ...item, actions: [...(item.actions ?? []), markAll] };
      });
    };

    for (const n of nets) {
      const saved = await cached<Notice[]>(`notifications:${n}`);
      if (saved) notices.set(n, saved);
    }
    if (notices.size) yield render();
    const errors: string[] = [];
    let setup: SetupError | undefined;
    const loads = nets.map(async (n) => {
      try {
        const list = n === "mastodon"
          ? await mastodonNotifications(a.mastodon!, signal)
          : await bskyNotifications(a.bluesky!, signal);
        notices.set(n, list);
        await keep(`notifications:${n}`, list);
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof SetupError) setup = e;
        errors.push(`${NETWORK_NAMES[n]}: ${(e as Error).message}`);
      }
    });
    for await (const _ of asCompleted(loads)) yield render();
    const unread = [...notices.values()].flat().filter((n) => n.unread).length;
    updateCommandMetadata({ subtitle: unread ? `${unread} new` : null }).catch(() => {});
    if (!errors.length) return;
    if (!notices.size) {
      if (setup) {
        yield setupItems(setup);
        return;
      }
      throw new Error(errors.join(" · "));
    }
    await toast("Some notifications couldn't load", { style: "failure", message: errors.join(" · ") });
  },
});
