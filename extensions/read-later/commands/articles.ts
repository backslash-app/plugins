import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  type Outcome,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Backend, backendOf, SetupError } from "../api.ts";
import {
  age,
  type Article,
  type Filter,
  formatReadingTime,
  htmlToMarkdown,
  isAllowedHost,
  sortArticles,
} from "../lib.ts";

let status = "";

function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Read Later",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect a read-it-later service",
        "",
        "Set **Service** to `wallabag`, `readeck` or `instapaper` (or leave it empty), then:",
        "",
        "- **Wallabag** (app.wallabag.it or your own): the address, and in Wallabag **API clients",
        "  management → Create a new client**: its **client ID** and **client secret**, with your **user",
        "  name** and **password**.",
        "- **Readeck**: the address and an **API token** from **Profile → API Tokens → Create a new token**.",
        "- **Instapaper**: your email and password. Instapaper's open API can only **add** articles (its",
        "  full API needs a key Instapaper grants to each app on request), so **Save to Read Later** works",
        "  but this list stays empty: read them on instapaper.com.",
        "",
        "Self-hosted servers can be on this computer, your local network (`*.lan`, `*.local`, `192.168.x.x`…)",
        "or Tailscale (`*.ts.net`): an extension declares in advance the hosts it may reach.",
      ].join("\n"),
    },
    actions: [
      open("https://app.wallabag.it/developer", "Open Wallabag API Clients", { icon: Icons.key }),
      open("https://www.instapaper.com/u", "Open Instapaper", { icon: Icons.external }),
    ],
  }];
}

function articleMetadata(b: Backend, a: Article): Metadata[] {
  return [
    meta.link("Source", a.domain, a.url),
    ...(a.authors.length ? [meta.text("By", a.authors.join(", "), { icon: Icons.person })] : []),
    meta.text("Reading time", formatReadingTime(a.readingTime), { icon: Icons.clock }),
    ...(a.words ? [meta.text("Words", a.words.toLocaleString("en-US"))] : []),
    ...(a.progress ? [meta.progress("Read", a.progress / 100)] : []),
    ...(a.tags.length ? [meta.tags("Tags", a.tags)] : []),
    meta.text("Saved", `${new Date(a.created).toLocaleDateString("en-GB")} (${age(a.created)})`, {
      icon: Icons.calendar,
    }),
    meta.text("State", a.archived ? "Archived" : "Unread", {
      icon: a.archived ? Icons.archive : Icons.inbox,
      color: a.archived ? undefined : "blue",
    }),
    ...(a.starred ? [meta.text("Favorite", "Yes", { icon: Icons.starFilled, color: "yellow" })] : []),
    meta.separator(),
    meta.link(b.name, "Open in reader", b.readerUrl(a)),
  ];
}

function changeActions(b: Backend, a: Article, after: () => Outcome): Action[] {
  return [
    action(a.archived ? "Mark as Unread" : "Archive", async () => {
      await b.archive(a, !a.archived);
      await toast(a.archived ? "Back in the reading list" : "Archived", { style: "success", message: a.title });
      return after();
    }, { icon: a.archived ? Icons.inbox : Icons.archive, shortcut: "<Ctrl>e", section: "Article" }),
    action(a.starred ? "Remove from Favorites" : "Add to Favorites", async () => {
      await b.star(a, !a.starred);
      await toast(a.starred ? "Removed from favorites" : "Added to favorites", { style: "success", message: a.title });
      return after();
    }, { icon: a.starred ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>s", section: "Article" }),
    action("Delete", async () => {
      await b.remove(a);
      await toast("Deleted", { message: a.title });
      return after();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${a.title}” from ${b.name}?`,
      shortcut: "<Ctrl><Shift>x",
      section: "Article",
    }),
    copy(a.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${a.title.replace(/[[\]]/g, "")}](${a.url})`, "Copy as Markdown Link", {
      shortcut: "<Ctrl><Shift>m",
      section: "Copy",
    }),
    open(b.readerUrl(a), `Open in ${b.name}`, { icon: Icons.book, shortcut: "<Ctrl>o", section: "Open" }),
  ];
}

async function readView(b: Backend, a: Article) {
  const html = await b.content(a);
  const body = htmlToMarkdown(html, a.url);
  const words = body.split(/\s+/).filter(Boolean).length;
  return detail({
    title: a.title,
    markdown: [
      `# ${a.title}`,
      "",
      `_${
        [a.domain, ...a.authors.slice(0, 2), formatReadingTime(a.readingTime ?? Math.ceil(words / 230))].join(" · ")
      }_`,
      "",
      body || "_This article has no extracted text: open the original._",
    ].join("\n"),
    metadata: articleMetadata(b, a),
    status: `${words.toLocaleString("en-US")} words`,
    actions: [
      open(a.url, "Open Original"),
      ...changeActions(b, a, () => pop()),
    ],
  });
}

function articleItem(b: Backend, a: Article): Item {
  let image: string | undefined;
  try {
    // Pictures are shown only from hosts the extension may reach (a server that keeps them).
    if (a.image && isAllowedHost(new URL(a.image).hostname)) image = a.image;
  } catch {
    image = undefined;
  }
  return {
    id: a.id,
    title: a.title,
    subtitle: a.domain,
    icon: a.starred
      ? { source: Icons.starFilled, tint: "yellow" }
      : { source: a.archived ? Icons.archive : Icons.book, tint: a.archived ? "gray" : "blue" },
    keywords: [...a.tags, ...a.authors, a.url],
    accessories: [
      ...a.tags.slice(0, 2).map((t) => ({ tag: t })),
      ...(a.progress && a.progress < 100 ? [{ text: `${a.progress}%`, tooltip: "Read so far" }] : []),
      { text: formatReadingTime(a.readingTime), icon: Icons.clock, tooltip: "Reading time" },
      { text: age(a.created), tooltip: `Saved ${new Date(a.created).toLocaleString("en-GB")}` },
    ],
    detail: {
      ...(image ? { image } : {}),
      markdown: a.excerpt ? `### ${a.title}\n\n${a.excerpt}` : `### ${a.title}`,
      metadata: articleMetadata(b, a),
    },
    actions: [
      action("Read in Launcher", () => readView(b, a), { icon: Icons.book }),
      open(a.url, "Open Original"),
      ...changeActions(b, a, () => refresh()),
    ],
  };
}

export default list({
  placeholder: "Filter articles by title, site, tag…",
  filter: {
    options: [
      { value: "unread", title: "Unread" },
      { value: "starred", title: "Favorites" },
      { value: "archived", title: "Archive" },
    ],
    default: "unread",
  },
  empty: { title: "Nothing to read", description: "Save a link with Save to Read Later", icon: Icons.book },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
  async items({ preferences, filter, signal }) {
    status = "";
    let b: Backend;
    try {
      b = backendOf(preferences);
      if (!b.canList) {
        return setupItems(new SetupError("Instapaper only lets apps add articles: read them on instapaper.com"));
      }
      const articles = sortArticles(await b.list((filter ?? "unread") as Filter, signal));
      const minutes = articles.reduce((n, a) => n + (a.readingTime ?? 0), 0);
      status = [
        b.name,
        `${articles.length} article${articles.length === 1 ? "" : "s"}`,
        `${formatReadingTime(minutes)} of reading`,
      ]
        .join(" · ");
      if ((filter ?? "unread") === "unread") {
        updateCommandMetadata({ subtitle: articles.length ? `${articles.length} unread` : null }).catch(() => {});
      }
      return articles.map((a) => articleItem(b, a));
    } catch (e) {
      if (e instanceof SetupError) return setupItems(e);
      throw e;
    }
  },
});
