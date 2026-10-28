import {
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { api, type App, apps, each, errorItems, SetupError, setupItem } from "../api.ts";
import {
  APPS,
  bytes,
  duration,
  fromQueue,
  type QueueEntry,
  type QueueRecord,
  queueState,
  sortQueue,
  webUrl,
} from "../lib.ts";
import { iconFor, loadPosters } from "../views.ts";

const POLL_MS = 5_000;

const INCLUDE: Record<App["kind"], Record<string, boolean>> = {
  sonarr: { includeSeries: true, includeEpisode: true, includeUnknownSeriesItems: false },
  radarr: { includeMovie: true },
  lidarr: { includeArtist: true, includeAlbum: true },
};

async function queue(app: App, signal: AbortSignal): Promise<QueueEntry[]> {
  const r = await api<{ records?: QueueRecord[] }>(app, "/queue", {
    signal,
    query: { page: 1, pageSize: 200, ...INCLUDE[app.kind] },
  });
  return (r?.records ?? []).map((x) => fromQueue(app.kind, x));
}

const changes = new EventTarget();
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

function removeAction(app: App, q: QueueEntry, blocklist: boolean, fromClient = true) {
  const title = blocklist ? "Blocklist and Search Again" : fromClient ? "Remove from Queue" : "Remove from Queue Only";
  return action(title, async () => {
    await api(app, `/queue/${q.queueId}`, {
      method: "DELETE",
      query: { removeFromClient: fromClient, blocklist, ...(blocklist ? { skipRedownload: false } : {}) },
    });
    await toast(
      blocklist ? `Blocklisted ${q.release || q.title}: searching for another release` : `Removed ${q.title}`,
      { style: "success" },
    );
    changes.dispatchEvent(new Event("change"));
    return refresh();
  }, {
    icon: blocklist ? Icons.canceled : Icons.trash,
    section: "Remove",
    destructive: true,
    shortcut: blocklist ? "<Ctrl><Shift>Delete" : fromClient ? "<Ctrl>Delete" : undefined,
    confirm: blocklist
      ? `Remove “${q.release || q.title}”, never grab it again, and search for another?`
      : fromClient
      ? `Remove “${q.title}” from the queue and the download client?`
      : `Remove “${q.title}” from the queue but leave it in the download client?`,
  });
}

function queueItem(app: App, q: QueueEntry, poster?: string): Item {
  const st = queueState(q);
  const metadata: Metadata[] = [
    meta.progress("Progress", q.progress, `${Math.floor(q.progress * 100)}% of ${bytes(q.size)}`),
    meta.text("Status", st.label, { icon: st.icon, color: st.tint }),
  ];
  if (q.eta) metadata.push(meta.text("Time left", duration(q.eta), { icon: Icons.clock }));
  if (q.quality) metadata.push(meta.tags("Quality", [q.quality]));
  if (q.client) metadata.push(meta.text("Client", q.client, { icon: Icons.download }));
  if (q.indexer) metadata.push(meta.text("Indexer", q.indexer, { icon: Icons.search }));
  if (q.protocol) {
    metadata.push(meta.text("Protocol", q.protocol === "usenet" ? "Usenet" : "Torrent", { icon: Icons.globe }));
  }
  metadata.push(meta.text("App", APPS[q.kind].title, { icon: Icons.server }));

  const accessories: Item["accessories"] = [];
  if (q.eta && q.progress < 1) accessories.push({ text: duration(q.eta), icon: Icons.clock, tooltip: "Time left" });
  if (q.quality) accessories.push({ text: q.quality });
  accessories.push({
    tag: st.label === "Downloading" ? `${Math.floor(q.progress * 100)}%` : st.label,
    color: st.tint,
    tooltip: q.messages[0] ?? st.label,
  });

  const queuePage = `${app.base}/activity/queue`;
  return {
    id: q.id,
    title: q.title,
    subtitle: q.what ?? q.release,
    icon: q.health === "ok" ? iconFor(q.kind, poster) : { source: st.icon, tint: st.tint },
    section: q.health === "ok" ? APPS[q.kind].title : "Needs Attention",
    keywords: [q.release, st.label, q.client ?? "", q.indexer ?? ""],
    accessories,
    detail: {
      image: poster,
      markdown: [
        `**${q.release}**`,
        ...(q.messages.length ? ["", ...q.messages.map((m) => `- ${m}`)] : []),
      ].join("\n"),
      metadata,
    },
    actions: [
      open(queuePage, `Open Queue in ${APPS[q.kind].title}`, { icon: Icons.external }),
      open(
        webUrl(app.base, q.kind, q.slug),
        `Open ${APPS[q.kind].noun[0].toUpperCase()}${APPS[q.kind].noun.slice(1)}`,
        {
          icon: Icons.globe,
          shortcut: "<Ctrl>o",
        },
      ),
      removeAction(app, q, false),
      removeAction(app, q, true),
      removeAction(app, q, false, false),
      copy(q.release, "Copy Release Name", { section: "Copy" }),
      ...(q.messages.length ? [copy(q.messages.join("\n"), "Copy Messages", { section: "Copy" })] : []),
    ],
  };
}

let footer = "";

export default list({
  placeholder: "Filter downloads by title, release, client…",
  empty: { title: "The queue is empty", description: "Nothing is downloading", icon: Icons.download },
  status: () => footer,
  async *items({ preferences, signal }) {
    let list: App[];
    try {
      list = apps(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const pics = new Map<string, string>();
    const tried = new Set<string>();
    while (!signal.aborted) {
      const r = await each(list, (app) => queue(app, signal));
      if (signal.aborted) return;
      const entries = r.ok.flatMap(([app, qs]) => qs.map((q) => [app, q] as [App, QueueEntry]));
      const appOf = new Map(entries.map(([a, q]) => [q, a]));
      const sorted = sortQueue(entries.map(([, q]) => q));
      const problems = sorted.filter((q) => q.health !== "ok").length;
      const downloading = sorted.filter((q) => q.status.toLowerCase() === "downloading").length;
      const line = [
        downloading ? `${downloading} downloading` : "",
        problems ? `${problems} need attention` : "",
        !downloading && !problems && sorted.length ? `${sorted.length} queued` : "",
      ].filter(Boolean).join(" · ");
      updateCommandMetadata({ subtitle: line || null }).catch(() => {});
      footer = line || "Queue empty";
      const rows = () => [
        ...errorItems(r.errors),
        ...sorted.map((q) => queueItem(appOf.get(q)!, q, pics.get(q.id))),
      ];
      yield rows();
      if (r.errors.some((e) => e instanceof SetupError) && !r.ok.length) return;
      const fresh = entries.filter(([, q]) => !tried.has(q.id));
      if (fresh.length) {
        fresh.forEach(([, q]) => tried.add(q.id));
        for (const [q, p] of await loadPosters(fresh, signal)) pics.set(q.id, p);
        yield rows();
      }
      await wait(POLL_MS, signal);
    }
  },
});
