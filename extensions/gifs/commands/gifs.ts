import {
  action,
  clipboard,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  refresh,
  toast,
} from "@backslash/api";
import {
  formatBytes,
  type Gif,
  parseLanguage,
  parseProvider,
  parseRating,
  type Provider,
  type Settings,
} from "../lib.ts";
import {
  copyAsFile,
  copyAsImage,
  forget,
  recent,
  registerShare,
  remember,
  save,
  searchGifs,
  SetupError,
} from "../system.ts";

const NAMES: Record<Provider, string> = { tenor: "Tenor", giphy: "Giphy" };
const SETUP_URLS: Record<Provider, string> = {
  tenor: "https://developers.google.com/tenor/guides/quickstart",
  giphy: "https://developers.giphy.com/dashboard/",
};

let status = "";

function setupItem(provider: Provider, message?: string): Item {
  const name = NAMES[provider];
  const other = NAMES[provider === "tenor" ? "giphy" : "tenor"];
  const steps = provider === "tenor"
    ? [
      "1. In the **Google Cloud console**, create a project and enable the **Tenor API** (Enter opens the guide).",
      "2. **APIs & Services → Credentials → Create credentials → API key**.",
      "3. Paste it in **Settings → Extensions → GIFs → Tenor API key**.",
    ]
    : [
      "1. Sign in at **developers.giphy.com** and **Create an App** (API, not SDK). Enter opens the dashboard.",
      "2. Copy the app's **API key**.",
      "3. Paste it in **Settings → Extensions → GIFs → Giphy API key**.",
    ];
  return {
    id: `setup-${provider}`,
    title: message ?? `Add your ${name} API key`,
    subtitle: "Free, takes a minute",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [`## Connect ${name}`, "", ...steps, "", `Either key is enough; with both, Tab switches to ${other}.`]
        .join("\n"),
    },
    actions: [open(SETUP_URLS[provider], `Get a ${name} Key`)],
  };
}

function errorItem(message: string): Item {
  return {
    id: "error",
    title: message,
    icon: { source: Icons.wifiOff, tint: "red" },
    detail: { markdown: `**${message}**` },
    actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
  };
}

function gifItem(gif: Gif, query: string, settings: Settings, section?: string): Item {
  const lines: Metadata[] = [meta.text("Source", NAMES[gif.provider])];
  if (gif.width && gif.height) lines.push(meta.text("Size", `${gif.width} × ${gif.height}`));
  if (gif.size) lines.push(meta.text("File", formatBytes(gif.size)));
  if (gif.duration) lines.push(meta.text("Length", `${gif.duration.toFixed(1)} s`, { icon: Icons.clock }));
  if (gif.author) lines.push(meta.person("By", gif.author));
  if (gif.tags.length) lines.push(meta.tags("Tags", gif.tags.slice(0, 8)));
  lines.push(meta.link("Page", NAMES[gif.provider], gif.page));

  const copied = async () => {
    await remember(gif);
    await registerShare(gif, query, settings.key);
  };
  const actions = [
    action("Copy GIF Link", async () => {
      await clipboard.write(gif.url);
      await copied();
      return close("GIF link copied");
    }, { icon: Icons.link }),
    action("Copy GIF as File", async () => {
      if (!(await copyAsFile(gif))) {
        await clipboard.write(gif.url);
        await toast("Copied the link: install wl-clipboard or xclip to copy the GIF itself");
        return;
      }
      await copied();
      return close("GIF copied: paste it in a chat or a folder");
    }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c" }),
    action("Copy GIF as Image", async () => {
      if (!(await copyAsImage(gif))) {
        await clipboard.write(gif.url);
        await toast("Copied the link: install wl-clipboard or xclip to copy the GIF itself");
        return;
      }
      await copied();
      return close("GIF copied as an image");
    }, { icon: Icons.image, shortcut: "<Ctrl>i" }),
    action("Paste GIF Link", async () => {
      await copied();
      await clipboard.paste(gif.url);
    }, { icon: Icons.paste, shortcut: "<Ctrl>p" }),
    action("Save to Downloads", async () => {
      const path = await save(gif);
      await toast(`Saved ${path.split("/").pop()}`, { style: "success" });
      await openExternal(path);
    }, { icon: Icons.download, shortcut: "<Ctrl>s" }),
    open(gif.page, `Open on ${NAMES[gif.provider]}`, { shortcut: "<Ctrl>o" }),
    copy(`![${gif.title.replace(/[[\]]/g, "")}](${gif.url})`, "Copy as Markdown", { section: "Copy" }),
    copy(gif.page, "Copy Page Link", { section: "Copy" }),
    ...(gif.mp4 ? [copy(gif.mp4, "Copy MP4 Link", { section: "Copy", icon: Icons.film })] : []),
    ...(section === "Recent"
      ? [action("Remove from Recent", async () => {
        await forget(gif);
        return refresh();
      }, { icon: Icons.trash, section: "Recent" })]
      : []),
  ];
  return {
    id: `${section ?? "r"}-${gif.provider}-${gif.id}`,
    title: gif.title,
    icon: gif.thumbnail,
    section,
    keywords: gif.tags,
    detail: { image: gif.url, metadata: lines },
    actions,
  };
}

export default (ctx: Context) => {
  const prefs = ctx.preferences;
  const keys: Record<Provider, string> = {
    tenor: String(prefs.tenorKey ?? "").trim(),
    giphy: String(prefs.giphyKey ?? "").trim(),
  };
  const preferred = parseProvider(prefs.provider);
  const configured = (["tenor", "giphy"] as Provider[]).filter((p) => keys[p]);
  const first = keys[preferred] ? preferred : configured[0] ?? preferred;
  const order = [first, ...configured.filter((p) => p !== first)];
  const base = { rating: parseRating(prefs.rating), language: parseLanguage(prefs.language) };

  return list({
    layout: "grid",
    columns: 4,
    placeholder: "Search GIFs: happy dance, thank you, facepalm…",
    filter: configured.length > 1
      ? { options: order.map((p) => ({ value: p, title: NAMES[p] })), default: first }
      : undefined,
    empty: { title: "No GIFs found", description: "Try other words", icon: Icons.search },
    status: () => status,
    async search(query, { filter, signal }) {
      const provider: Provider = filter === "tenor" || filter === "giphy" ? filter : first;
      status = "";
      if (!configured.length) return [setupItem("tenor"), setupItem("giphy")];
      const settings: Settings = { ...base, key: keys[provider] };
      const recents = query.trim() ? [] : await recent();
      let gifs: Gif[];
      try {
        gifs = await searchGifs(provider, query, settings, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof SetupError) return [setupItem(provider)];
        const message = (e as Error).message;
        if (/refused the API key/.test(message)) return [setupItem(provider, message)];
        return [errorItem(message)];
      }
      status = query.trim() ? `${gifs.length} GIFs from ${NAMES[provider]}` : `Trending on ${NAMES[provider]}`;
      return [
        ...recents.map((g) => gifItem(g, query, { ...base, key: keys[g.provider] }, "Recent")),
        ...gifs.map((g) =>
          gifItem(g, query, settings, query.trim() ? undefined : recents.length ? "Trending" : undefined)
        ),
      ];
    },
  });
};
