import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import { addRecent, answersOf, clearRecent, quota, recent, searchQuestions } from "../api.ts";
import { codeBlocks, htmlToMarkdown } from "../html.ts";
import {
  ago,
  type Answer,
  answerUrl,
  codeTitle,
  compact,
  date,
  excerpt,
  pickAnswer,
  type Question,
  scoreColor,
  type Site,
  siteFor,
  SITES,
} from "../lib.ts";

const base = (site: Site) => `https://${site.host}`;

function questionIcon(q: Question) {
  if (q.closed) return { source: Icons.canceled, tint: "gray" as const };
  if (q.acceptedAnswerId) return { source: Icons.done, tint: "green" as const };
  if (q.answers) return { source: Icons.comment, tint: "blue" as const };
  return { source: Icons.question, tint: "gray" as const };
}

async function bestAnswer(q: Question, site: Site, key?: string): Promise<{ answer?: Answer; all: Answer[] }> {
  const all = q.answers ? await answersOf(q, site, key) : [];
  return { answer: pickAnswer(all, q.acceptedAnswerId), all };
}

function codeActions(answer: Answer | undefined, section?: string): Action[] {
  const blocks = answer ? codeBlocks(answer.body) : [];
  if (!blocks.length) return [action("No code in the answer", () => {}, { icon: Icons.info, section })];
  return blocks.map((b, i) =>
    copy(b.code, codeTitle(b.code, i), {
      icon: Icons.code,
      section,
      ...(i === 0 ? { shortcut: "<Ctrl><Shift>c" } : {}),
    })
  );
}

async function answerView(q: Question, site: Site, key?: string) {
  await addRecent(site, q);
  const { answer, all } = await bestAnswer(q, site, key);
  const kind = answer?.accepted ? "Accepted Answer" : "Top Answer";
  const markdown = [
    `# ${q.title}`,
    "",
    q.body ? htmlToMarkdown(q.body, { base: base(site), shift: 2 }) : "",
    "",
    "---",
    "",
    answer
      ? `## ${kind} · ${answer.score} vote${Math.abs(answer.score) === 1 ? "" : "s"}`
      : q.answers
      ? "## No answer could be loaded"
      : "## No answer yet",
    "",
    answer ? htmlToMarkdown(answer.body, { base: base(site), shift: 2 }) : "",
  ].join("\n");
  const blocks = answer ? codeBlocks(answer.body) : [];
  return detail({
    title: q.title,
    markdown,
    stats: [
      { label: "Votes", value: compact(q.score), color: scoreColor(q.score) },
      { label: "Answers", value: q.answers, color: q.acceptedAnswerId ? "green" : undefined },
      { label: "Views", value: compact(q.views) },
    ],
    metadata: [
      meta.tags("Tags", q.tags.map((t) => ({ text: t, color: site.tint }))),
      ...(q.owner ? [meta.person("Asked by", q.owner.name)] : []),
      meta.text("Asked", date(q.created), { icon: Icons.calendar }),
      meta.text("Active", ago(q.activity), { icon: Icons.clock }),
      ...(answer
        ? [
          meta.separator(),
          meta.text(kind, `${answer.score} votes`, {
            icon: answer.accepted ? Icons.done : Icons.starFilled,
            color: answer.accepted ? "green" : "yellow",
          }),
          ...(answer.owner ? [meta.person("Answered by", answer.owner.name)] : []),
          meta.text("Answered", date(answer.created), { icon: Icons.calendar }),
          meta.text("Code blocks", String(blocks.length), { icon: Icons.code }),
        ]
        : []),
      meta.separator(),
      meta.link("Question", q.link.replace(/^https:\/\//, "").slice(0, 60), q.link),
    ],
    status: `${site.title} · ${all.length} answer${all.length === 1 ? "" : "s"} loaded`,
    actions: [
      open(q.link, "Open in Browser"),
      ...(answer ? [open(answerUrl(site, answer.id), "Open Answer", { shortcut: "<Ctrl>o" })] : []),
      ...codeActions(answer, "Copy Code"),
      ...(answer
        ? [copy(htmlToMarkdown(answer.body), "Copy Answer as Markdown", { icon: Icons.copy, section: "Copy" })]
        : []),
      copy(q.link, "Copy Question Link", { icon: Icons.link, section: "Copy", shortcut: "<Ctrl>l" }),
    ],
  });
}

function questionItem(q: Question, site: Site, key: string | undefined, section?: string): Item {
  return {
    id: `${site.id}:${q.id}`,
    title: q.title,
    subtitle: q.tags.slice(0, 3).join(" · "),
    icon: questionIcon(q),
    section,
    keywords: q.tags,
    accessories: [
      { icon: Icons.arrowUp, text: compact(q.score), color: scoreColor(q.score), tooltip: "Votes" },
      {
        icon: q.acceptedAnswerId ? Icons.check : Icons.comment,
        text: String(q.answers),
        color: q.acceptedAnswerId ? "green" : q.answers ? undefined : "gray",
        tooltip: q.acceptedAnswerId ? "Answers, one accepted" : "Answers",
      },
      { icon: Icons.eye, text: compact(q.views), tooltip: "Views" },
    ],
    detail: {
      stats: [
        { label: "Votes", value: compact(q.score), color: scoreColor(q.score) },
        { label: "Answers", value: q.answers, color: q.acceptedAnswerId ? "green" : undefined },
        { label: "Views", value: compact(q.views) },
      ],
      markdown: [
        `**${q.title.replace(/\*/g, "")}**`,
        "",
        q.body ? excerpt(q.body, base(site)) : "",
        "",
        q.answers ? `*Press Enter to read the ${q.acceptedAnswerId ? "accepted" : "top"} answer.*` : "*No answer yet.*",
      ].join("\n"),
      metadata: [
        meta.tags("Tags", q.tags.map((t) => ({ text: t, color: site.tint }))),
        meta.text(
          "Status",
          q.closed
            ? `Closed: ${q.closed}`
            : q.acceptedAnswerId
            ? "Accepted answer"
            : q.answered
            ? "Answered"
            : "Unanswered",
          {
            color: q.closed ? "gray" : q.acceptedAnswerId ? "green" : q.answered ? "blue" : "orange",
          },
        ),
        ...(q.owner
          ? [
            meta.person("Asked by", q.owner.name),
            ...(q.owner.reputation !== undefined
              ? [meta.text("Reputation", compact(q.owner.reputation), { icon: Icons.star })]
              : []),
          ]
          : []),
        meta.text("Asked", `${date(q.created)} · ${ago(q.created)}`, { icon: Icons.calendar }),
        meta.text("Active", ago(q.activity), { icon: Icons.clock }),
        meta.separator(),
        meta.link(site.title, `${site.host}/q/${q.id}`, q.link),
      ],
    },
    actions: [
      action(q.answers ? "Show Answer" : "Show Question", () => answerView(q, site, key), { icon: Icons.book }),
      open(q.link, "Open in Browser"),
      submenu("Copy Code from Answer…", async () => {
        const { answer } = await bestAnswer(q, site, key);
        return codeActions(answer);
      }, { icon: Icons.code, shortcut: "<Ctrl><Shift>c" }),
      copy(q.link, "Copy Link", { icon: Icons.link, section: "Copy", shortcut: "<Ctrl>l" }),
      copy(`[${q.title.replace(/[[\]]/g, "")}](${q.link})`, "Copy as Markdown Link", {
        icon: Icons.link,
        section: "Copy",
      }),
      copy(q.title, "Copy Title", { icon: Icons.text, section: "Copy" }),
      action("Copy Answer as Markdown", async () => {
        const { answer } = await bestAnswer(q, site, key);
        if (!answer) throw new Error("This question has no answer yet");
        await clipboard.write(htmlToMarkdown(answer.body, { base: base(site) }));
        return close("Answer copied");
      }, { icon: Icons.copy, section: "Copy" }),
    ],
  };
}

function quotaText(left?: { remaining: number; max: number }) {
  return left ? ` · ${left.remaining.toLocaleString("en")}/${left.max.toLocaleString("en")} requests left today` : "";
}

let last = "";

export default (ctx: Context) => {
  const preferred = siteFor(ctx.preferences.site);
  const key = String(ctx.preferences.apiKey ?? "").trim() || undefined;
  return list({
    placeholder: "Search questions… ([tag] to filter, is:accepted)",
    filter: { options: SITES.map((s) => ({ value: s.id, title: s.title })), default: preferred.id },
    empty: {
      title: "No question found",
      description: "Try other words, fewer tags, or another site with Tab.",
      icon: Icons.search,
    },
    status: () => last,
    async search(query, { filter, signal }) {
      const site = SITES.find((s) => s.id === filter) ?? preferred;
      if (query.trim().length < 2) {
        const seen = await recent(site);
        last = `${site.title}${quotaText(await quota())}`;
        const hint: Item = {
          id: "hint",
          title: `Search ${site.title}`,
          subtitle: "Type a few words, add [tags] to narrow down",
          icon: { source: Icons.search, tint: site.tint },
          section: "Tips",
          detail: {
            markdown: [
              `**Search ${site.title}**`,
              "",
              "- `[rust] borrow checker` — questions tagged *rust*",
              "- `is:accepted tar extract` — only questions with an accepted answer",
              "- Tab switches between Stack Overflow, Super User, Ask Ubuntu, Unix & Linux and Server Fault.",
              "",
              "Results are cached for an hour to spare the daily quota of the Stack Exchange API.",
            ].join("\n"),
          },
          actions: [open(`https://${site.host}/questions`, `Open ${site.title}`)],
        };
        return [
          hint,
          ...seen.map((q) => ({
            ...questionItem(q, site, key, "Recently Viewed"),
            actions: [
              ...questionItem(q, site, key).actions!,
              action("Clear Recently Viewed", async () => {
                await clearRecent(site);
                return refresh();
              }, { icon: Icons.trash, destructive: true, section: "Danger" }),
            ],
          })),
        ];
      }
      let page;
      try {
        page = await searchQuestions(query, site, key, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        last = `${site.title} · error`;
        return [{
          id: "error",
          title: e instanceof Error ? e.message : String(e),
          subtitle: `Search on ${site.host} instead`,
          icon: { source: Icons.alert, tint: "red" },
          detail: {
            markdown: key ? "" : "Without an API key, Stack Exchange allows 300 requests a day per IP address. " +
              "A free key from stackapps.com raises it to 10,000: add it in the extension's preferences.",
          },
          actions: [
            open(`https://${site.host}/search?q=${encodeURIComponent(query)}`, `Search on ${site.title}`),
            open("https://stackapps.com/apps/oauth/register", "Register a Stack Apps Key", { icon: Icons.key }),
          ],
        }];
      }
      const left = await quota();
      last = `${page.items.length} question${page.items.length === 1 ? "" : "s"} on ${site.title}${
        page.cached ? " · cached" : ""
      }${quotaText(left)}`;
      if (left) {
        updateCommandMetadata({ subtitle: left.remaining < 50 ? `${left.remaining} API requests left today` : null })
          .catch(() => {});
      }
      const items = page.items.map((q) => questionItem(q, site, key));
      items.push({
        id: "web",
        title: `Search “${query.trim()}” on ${site.title}`,
        icon: { source: Icons.globe, tint: "gray" },
        section: items.length ? "More" : undefined,
        actions: [open(`https://${site.host}/search?q=${encodeURIComponent(query.trim())}`, "Open in Browser")],
      });
      return items;
    },
  });
};
