import { type Action, action, copy, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { download, readCache } from "../data.ts";
import {
  BROWSERS,
  caniuseUrl,
  type Dataset,
  type Feature,
  group,
  isFresh,
  markdown,
  mdnLink,
  percent,
  shortSupport,
  STATUS_SHORT,
  supportTags,
  usageColor,
} from "../lib.ts";

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];

function summary(f: Feature): string {
  return BROWSERS.map((b) => {
    const tags = supportTags(f.support[b.id]);
    return `${b.name}: ${tags.filter((t) => !t.text.startsWith("note")).map((t) => t.text).join(", ")}`;
  }).join("\n");
}

function featureItem(f: Feature, data: Dataset): Item {
  const url = caniuseUrl(f.id);
  const mdn = mdnLink(f);
  const total = f.usageY + f.usageA;
  const others = f.links.filter((l) => l !== mdn).slice(0, 6);
  const actions: Action[] = [
    open(url, "Open on caniuse.com"),
    copy(url, "Copy caniuse.com Link", { icon: Icons.link }),
    ...(mdn ? [open(mdn.url, "Open MDN Docs", { icon: Icons.book, shortcut: "<Ctrl>m" })] : []),
    ...(f.spec ? [open(f.spec, "Open Specification", { icon: Icons.file, shortcut: "<Ctrl>s" })] : []),
    ...others.map((l) => open(l.url, l.title.length > 60 ? `${l.title.slice(0, 59)}…` : l.title, { section: "Links" })),
    copy(f.title, "Copy Feature Name", { section: "Copy" }),
    copy(summary(f), "Copy Browser Support", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(f.id, "Copy Feature ID", { section: "Copy" }),
  ];
  return {
    id: f.id,
    title: f.title,
    subtitle: f.categories.join(", "),
    icon: { source: Icons.globe, tint: usageColor(total) },
    keywords: [f.id, ...f.keywords, ...f.categories],
    accessories: [
      ...(["chrome", "firefox", "safari"] as const).map((id) => {
        const s = shortSupport(f.support[id]);
        return { text: s.text, color: s.color, tooltip: BROWSERS.find((b) => b.id === id)!.name };
      }),
      { tag: percent(f.usageY), color: usageColor(f.usageY), tooltip: "Global support" },
    ],
    detail: {
      stats: [
        { label: "Global support", value: percent(f.usageY), color: usageColor(f.usageY) },
        ...(f.usageA ? [{ label: "Partial", value: percent(f.usageA), color: "yellow" as const }] : []),
        { label: "Status", value: STATUS_SHORT[f.status] ?? f.status },
      ],
      markdown: markdown(f),
      metadata: [
        ...BROWSERS.map((b) => meta.tags(b.name, supportTags(f.support[b.id]))),
        meta.separator(),
        meta.text("Status", data.statuses[f.status] ?? f.status, { icon: Icons.flag }),
        meta.tags("Categories", f.categories),
        ...(f.spec ? [meta.link("Specification", host(f.spec), f.spec)] : []),
        ...(mdn ? [meta.link("MDN", mdn.title.replace(/^MDN Web Docs - /, ""), mdn.url)] : []),
        meta.link("Can I Use", `caniuse.com/${f.id}`, url),
      ],
    },
    actions,
  };
}

let status = "";
let force = false;

const dateOf = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString("en", { dateStyle: "medium" });

export default list({
  placeholder: "Search web platform features: grid, :has, fetch, webp…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "css", title: "CSS" },
      { value: "html", title: "HTML" },
      { value: "js", title: "JavaScript" },
      { value: "other", title: "Other" },
    ],
  },
  empty: { title: "No feature found", description: "Try another name, or search caniuse.com.", icon: Icons.globe },
  status: (items) => status.replace("{n}", String(items.length)),
  actions: [
    action("Refresh Data", () => {
      force = true;
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    open("https://caniuse.com", "Open caniuse.com", { icon: Icons.globe }),
  ],
  async *items({ filter, signal }) {
    const shown = (data: Dataset) => {
      status = `{n} features · caniuse data of ${dateOf(data.updated)}`;
      return data.features.filter((f) => !filter || filter === "all" || group(f) === filter)
        .map((f) => featureItem(f, data));
    };
    const cached = await readCache();
    if (cached) yield shown(cached);
    if (isFresh(cached) && !force) return;
    force = false;
    // Without a cache, the launcher's spinner shows until the download is done.
    try {
      yield shown(await download(signal));
    } catch (e) {
      if (signal.aborted) throw e;
      const message = e instanceof Error ? e.message : String(e);
      if (cached) {
        status = `{n} features · couldn't refresh (${message}) · data of ${dateOf(cached.updated)}`;
        return;
      }
      status = "The caniuse data can't be downloaded";
      yield [{
        id: "error",
        title: "Can't download the caniuse data",
        subtitle: message,
        icon: { source: Icons.wifiOff, tint: "red" },
        actions: [
          action("Try Again", () => refresh(), { icon: Icons.refresh }),
          open("https://caniuse.com", "Open caniuse.com"),
        ],
      }];
    }
  },
});
