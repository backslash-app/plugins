import { action, Icons, type Item, list, refresh, toast } from "@backslash/api";
import {
  type Accounts,
  accounts,
  bskyTimeline,
  cached,
  keep,
  mastodonMe,
  mastodonTimeline,
  SetupError,
} from "../api.ts";
import { asCompleted, byDate, type Network, NETWORK_NAMES, type Post } from "../lib.ts";
import { composeForm, postItem, setupItems } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter posts by text or author…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "mastodon", title: "Mastodon" }, {
      value: "bluesky",
      title: "Bluesky",
    }],
    default: "all",
  },
  status: () => status,
  empty: { title: "No posts", description: "Your timelines are empty: follow someone first", icon: Icons.comment },
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
    const nets = (["mastodon", "bluesky"] as const).filter((n) =>
      a[n] && ((filter ?? "all") === "all" || filter === n)
    );
    const compose = action("New Post", () => composeForm(a), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Social",
    });
    const reload = action("Reload", () => refresh(), {
      icon: Icons.refresh,
      shortcut: "<Ctrl><Shift>r",
      section: "Social",
    });
    const me = a.mastodon ? await mastodonMe(a.mastodon, signal).then((m) => m.acct).catch(() => "") : "";
    const posts = new Map<Network, Post[]>();
    const render = (): Item[] =>
      [...posts.values()].flat().sort(byDate).map((p) => {
        const item = postItem(a, p, me);
        return { ...item, actions: [...(item.actions ?? []), compose, reload] };
      });

    // Last time's posts at once, then each network as soon as it answers.
    for (const n of nets) {
      const saved = await cached<Post[]>(`timeline:${n}`);
      if (saved) posts.set(n, saved);
    }
    if (posts.size) yield render();
    const errors: { network: Network; error: Error }[] = [];
    let pending = nets.length;
    const loads = nets.map(async (n) => {
      try {
        const list = n === "mastodon"
          ? await mastodonTimeline(a.mastodon!, signal)
          : await bskyTimeline(a.bluesky!, signal);
        posts.set(n, list);
        await keep(`timeline:${n}`, list);
      } catch (e) {
        if (signal.aborted) throw e;
        errors.push({ network: n, error: e as Error });
      }
    });
    for await (const _ of asCompleted(loads)) {
      pending--;
      const count = [...posts.values()].flat().length;
      status = `${count} post${count === 1 ? "" : "s"}${pending ? " · loading…" : ""}`;
      yield render();
    }
    if (!errors.length) return;
    const text = errors.map((e) => `${NETWORK_NAMES[e.network]}: ${e.error.message}`).join(" · ");
    if (errors.length === nets.length && !posts.size) {
      const setup = errors.find((e) => e.error instanceof SetupError);
      if (setup) {
        yield setupItems(setup.error as SetupError);
        return;
      }
      throw new Error(text);
    }
    await toast("Some posts couldn't load", { style: "failure", message: text });
  },
});
