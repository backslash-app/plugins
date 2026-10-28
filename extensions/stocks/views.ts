// Stocks as launcher items, the company page and the news list.

import {
  type Accessory,
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { guarded, metrics, news, profile, setWatchlist, watchlist } from "./api.ts";
import {
  ago,
  changeColor,
  dayPosition,
  domain,
  hasQuote,
  marketCap,
  money,
  move,
  type News,
  percent,
  type Profile,
  type Quote,
  quoteTime,
  signed,
  yahooUrl,
} from "./lib.ts";

export interface Stock {
  symbol: string;
  name: string;
  type?: string;
  quote?: Quote;
  profile?: Profile;
}

const logoOf = (p: Profile | undefined) =>
  p?.logo && p.logo.startsWith("https://static2.finnhub.io/") ? p.logo : undefined;

export function quoteMetadata(s: Stock): Metadata[] {
  const q = s.quote;
  const p = s.profile;
  const cur = p?.currency;
  const lines: Metadata[] = [];
  if (hasQuote(q)) {
    const pos = dayPosition(q);
    lines.push(
      pos === undefined
        ? meta.text("Day range", `${money(q.l, cur)} – ${money(q.h, cur)}`)
        : meta.progress("Day range", pos, `${money(q.l, cur)} – ${money(q.h, cur)}`),
      meta.text("Open", money(q.o, cur)),
      meta.text("Previous close", money(q.pc, cur)),
    );
  }
  if (p?.marketCapitalization) lines.push(meta.text("Market cap", marketCap(p.marketCapitalization, cur)));
  if (p?.exchange) lines.push(meta.text("Exchange", p.exchange, { icon: Icons.globe }));
  if (p?.finnhubIndustry) lines.push(meta.tags("Industry", [{ text: p.finnhubIndustry, color: "blue" }]));
  if (s.type && !p?.finnhubIndustry) lines.push(meta.tags("Type", [s.type]));
  if (p?.country) lines.push(meta.text("Country", p.country, { icon: Icons.flag }));
  if (p?.ipo) lines.push(meta.text("IPO", p.ipo, { icon: Icons.calendar }));
  const site = domain(p?.weburl);
  if (site) lines.push(meta.link("Website", site, p!.weburl!));
  if (hasQuote(q) && q.t) lines.push(meta.text("Updated", quoteTime(q.t), { icon: Icons.clock }));
  return lines;
}

export function stockItem(s: Stock, o: { key: string; watched: boolean; section?: string }): Item {
  const q = hasQuote(s.quote) ? s.quote : undefined;
  const cur = s.profile?.currency;
  const up = (q?.d ?? 0) >= 0;
  const logo = logoOf(s.profile);
  const accessories: Accessory[] = [];
  if (o.watched && o.section !== "Watchlist") {
    accessories.push({ icon: { source: Icons.starFilled, tint: "yellow" }, tooltip: "In your watchlist" });
  }
  if (q) {
    accessories.push(
      {
        text: percent(q.dp),
        color: changeColor(q.dp),
        icon: { source: up ? Icons.chartUp : Icons.chartDown, tint: changeColor(q.d) },
        tooltip: `${signed(q.d)} today`,
      },
      { text: money(q.c, cur), tooltip: `Previous close ${money(q.pc, cur)}` },
    );
  } else if (s.type) {
    accessories.push({ tag: s.type });
  }

  const actions: Action[] = [
    action("Show News", (ctx) => newsList(s, o.key, ctx.signal), { icon: Icons.rss, shortcut: "<Ctrl>n" }),
    action("Show Company Details", (ctx) => companyView(s, o.key, ctx.signal), {
      icon: Icons.info,
      shortcut: "<Ctrl>i",
    }),
    action(o.watched ? "Remove from Watchlist" : "Add to Watchlist", async () => {
      const list = await watchlist();
      await setWatchlist(o.watched ? list.filter((x) => x !== s.symbol) : [...list, s.symbol]);
      await toast(`${s.symbol} ${o.watched ? "removed from" : "added to"} the watchlist`, { style: "success" });
      return refresh();
    }, {
      icon: o.watched ? Icons.starFilled : Icons.star,
      shortcut: "<Ctrl>s",
      ...(o.watched ? { section: "Watchlist" } : {}),
    }),
  ];
  if (o.watched && o.section === "Watchlist") {
    actions.push(
      action("Move Up", async () => {
        await setWatchlist(move(await watchlist(), s.symbol, -1));
        return refresh();
      }, { icon: Icons.arrowUp, shortcut: "<Ctrl><Shift>Up", section: "Watchlist" }),
      action("Move Down", async () => {
        await setWatchlist(move(await watchlist(), s.symbol, 1));
        return refresh();
      }, { icon: Icons.arrowDown, shortcut: "<Ctrl><Shift>Down", section: "Watchlist" }),
    );
  }
  actions.push(
    open(yahooUrl(s.symbol), "Open on Yahoo Finance", { section: "Open" }),
    ...(s.profile?.weburl ? [open(s.profile.weburl, "Open Company Website", { section: "Open" })] : []),
    copy(s.symbol, "Copy Symbol", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ...(q ? [copy(money(q.c, cur), "Copy Price", { section: "Copy" })] : []),
  );

  return {
    id: `${o.section ?? ""}:${s.symbol}`,
    title: s.symbol,
    subtitle: s.name,
    section: o.section,
    icon: logo ?? { source: up ? Icons.chartUp : Icons.chartDown, tint: q ? changeColor(q.d) ?? "gray" : "gray" },
    keywords: [s.name, ...(s.profile?.finnhubIndustry ? [s.profile.finnhubIndustry] : [])],
    accessories,
    detail: {
      image: logo,
      stats: q
        ? [
          { label: "Price", value: money(q.c, cur) },
          { label: "Change", value: signed(q.d), color: changeColor(q.d) },
          { label: "Today", value: percent(q.dp), color: changeColor(q.dp) },
        ]
        : undefined,
      markdown: q
        ? `**${s.name}**`
        : `**${s.name}**\n\nNo quote for ${s.symbol}: Finnhub's free plan has quotes for US stocks only.`,
      metadata: quoteMetadata(s),
    },
    actions,
  };
}

/** The company's profile, key figures and latest headlines. */
export async function companyView(s: Stock, key: string, signal: AbortSignal): Promise<DetailSpec> {
  const [p, m, headlines] = await Promise.all([
    s.profile ? Promise.resolve(s.profile) : profile(key, s.symbol, signal).catch(() => undefined),
    metrics(key, s.symbol, signal).catch(() => undefined),
    news(key, s.symbol, signal).catch(() => [] as News[]),
  ]);
  const cur = p?.currency;
  const x = m?.metric ?? {};
  const q = hasQuote(s.quote) ? s.quote : undefined;
  const md = [
    `# ${p?.name || s.name} (${s.symbol})`,
    "",
    ...(q ? [`**${money(q.c, cur)}** · ${signed(q.d)} (${percent(q.dp)}) today`, ""] : []),
    ...(headlines.length
      ? [
        "## Latest news",
        "",
        ...headlines.slice(0, 8).map((n) =>
          `- [${n.headline.replace(/[[\]]/g, "")}](${n.url}) · ${n.source ?? ""} · ${ago(n.datetime)}`
        ),
      ]
      : ["No headlines in the last two weeks."]),
  ];
  const metadata: Metadata[] = [...quoteMetadata({ ...s, profile: p })];
  if (x["52WeekLow"] && x["52WeekHigh"]) {
    metadata.push(meta.text("52 weeks", `${money(x["52WeekLow"], cur)} – ${money(x["52WeekHigh"], cur)}`));
  }
  const pe = x.peTTM ?? x.peBasicExclExtraTTM;
  if (pe) metadata.push(meta.text("P/E (TTM)", pe.toFixed(1)));
  if (x.epsTTM) metadata.push(meta.text("EPS (TTM)", money(x.epsTTM, cur)));
  if (x.beta) metadata.push(meta.text("Beta", x.beta.toFixed(2)));
  if (x.dividendYieldIndicatedAnnual) {
    metadata.push(meta.text("Dividend yield", `${x.dividendYieldIndicatedAnnual.toFixed(2)} %`));
  }
  if (p?.shareOutstanding) {
    metadata.push(
      meta.text(
        "Shares",
        new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
          p.shareOutstanding * 1e6,
        ),
      ),
    );
  }
  return detail({
    title: `${s.symbol} · ${p?.name || s.name}`,
    markdown: md.join("\n"),
    stats: q
      ? [
        { label: "Price", value: money(q.c, cur) },
        { label: "Today", value: percent(q.dp), color: changeColor(q.dp) },
        ...(p?.marketCapitalization ? [{ label: "Market cap", value: marketCap(p.marketCapitalization, cur) }] : []),
      ]
      : undefined,
    metadata,
    status: `${headlines.length} headline${headlines.length === 1 ? "" : "s"} in 14 days · Finnhub`,
    actions: [
      action("Show News", (ctx) => newsList(s, key, ctx.signal), { icon: Icons.rss }),
      open(yahooUrl(s.symbol), "Open on Yahoo Finance"),
      ...(p?.weburl ? [open(p.weburl, "Open Company Website")] : []),
      copy(s.symbol, "Copy Symbol", { section: "Copy" }),
    ],
  });
}

export function newsItem(n: News, symbol: string): Item {
  return {
    id: String(n.id || n.url),
    title: n.headline,
    subtitle: n.source,
    icon: { source: Icons.rss, tint: "orange" },
    keywords: [n.source ?? "", n.category ?? ""],
    accessories: [{ text: ago(n.datetime), tooltip: new Date(n.datetime * 1000).toLocaleString("en-GB") }],
    detail: {
      markdown: [`**${n.headline}**`, ...(n.summary ? ["", n.summary.slice(0, 1200)] : [])].join("\n"),
      metadata: [
        ...(n.source ? [meta.text("Source", n.source, { icon: Icons.globe })] : []),
        meta.text("Published", new Date(n.datetime * 1000).toLocaleString("en-GB"), { icon: Icons.clock }),
        ...(n.related ? [meta.tags("Related", n.related.split(",").filter(Boolean).slice(0, 6))] : []),
        ...(domain(n.url) ? [meta.link("Link", domain(n.url)!, n.url)] : []),
      ],
    },
    actions: [
      open(n.url, "Open Article"),
      copy(n.url, "Copy Link", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(`[${n.headline}](${n.url})`, "Copy as Markdown Link", { section: "Copy" }),
      open(yahooUrl(symbol), `Open ${symbol} on Yahoo Finance`, { section: "Open" }),
    ],
  };
}

export function newsList(s: Stock, key: string, _signal?: AbortSignal): ListSpec {
  return list({
    title: `${s.symbol} News`,
    placeholder: `Filter ${s.symbol} headlines…`,
    empty: { title: "No headlines", description: "Nothing in the last two weeks", icon: Icons.rss },
    status: (items) => `${items.length} headline${items.length === 1 ? "" : "s"} · last 14 days · Finnhub`,
    items: ({ signal }) => guarded(async () => (await news(key, s.symbol, signal)).map((n) => newsItem(n, s.symbol))),
  });
}
