import { type Context, Icons, type Item, list, open, updateCommandMetadata } from "@backslash/api";
import { type Client, client, forgetDetected, type Prefs, SetupError } from "../api.ts";
import { matchesView, sortTorrents, summary } from "../lib.ts";
import { altSpeedAction, setupItems, torrentItem, wait } from "../ui.ts";

const POLL_MS = 3_000;
/** The speed-limit mode can change from the client's own UI or schedule: re-read it every few polls. */
const ALT_EVERY = 5;

export default async ({ preferences, signal }: Context) => {
  let c: Client | undefined;
  let setup: SetupError | undefined;
  try {
    c = await client(preferences as Prefs, signal);
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    setup = e;
  }
  let footer = "";
  return list({
    placeholder: "Filter torrents by name, tracker, label…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "downloading", title: "Downloading" },
        { value: "seeding", title: "Seeding" },
        { value: "paused", title: "Paused" },
      ],
      default: "all",
    },
    empty: {
      title: "No torrents here",
      description: "Add one with the Add Torrent command, or pick another view with Tab",
      icon: Icons.download,
    },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : footer,
    actions: c ? [...altSpeedAction(c), open(c.webUrl, `Open ${c.title} Web UI`, { icon: Icons.globe })] : [],
    async *items({ signal, filter }) {
      if (!c) {
        yield setupItems(setup!);
        return;
      }
      let alt: boolean | undefined;
      for (let round = 0; !signal.aborted; round++) {
        let items: Item[];
        try {
          const [torrents, altOn] = await Promise.all([
            c.list(signal),
            c.altSpeed && round % ALT_EVERY === 0 ? c.altSpeed.get(signal).catch(() => alt) : Promise.resolve(alt),
          ]);
          alt = altOn;
          const line = summary(torrents);
          updateCommandMetadata({ subtitle: line }).catch(() => {});
          footer = [c.title, line, alt ? "Alternative speed limits on" : ""].filter(Boolean).join(" · ");
          items = sortTorrents(torrents.filter((t) => matchesView(t, filter))).map((t) => torrentItem(c, t));
        } catch (e) {
          if (signal.aborted) return;
          if (!(e instanceof SetupError)) throw e;
          if (e.kind === "down") await forgetDetected();
          yield setupItems(e);
          return;
        }
        yield items;
        await wait(POLL_MS, signal);
      }
    },
  });
};
