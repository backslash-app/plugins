import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { changes, type Server, server, SetupError, setupItem } from "../api.ts";
import {
  age,
  type Change,
  changeState,
  changeUrl,
  FILTERS,
  gitCommand,
  labelColor,
  mainLabels,
  messageBody,
  normalizeUrl,
  searchUrl,
  shortLabel,
  signed,
  sizeBucket,
  sizeText,
} from "../lib.ts";

function icon(c: Change) {
  const state = changeState(c);
  if (c.status === "MERGED") return { source: Icons.merged, tint: state.color };
  if (c.status === "ABANDONED") return { source: Icons.pullRequestClosed, tint: state.color };
  if (c.wip) return { source: Icons.pullRequestDraft, tint: state.color };
  return { source: Icons.pullRequest, tint: state.color };
}

function votesMarkdown(c: Change): string {
  const voted = c.labels.filter((l) => l.votes.length);
  if (!voted.length) return "_No votes yet._";
  return [
    "| Label | Vote | By |",
    "| --- | ---: | --- |",
    ...voted.flatMap((l) => l.votes.map((v) => `| ${l.name} | ${signed(v.value)} | ${v.account.name} |`)),
  ].join("\n");
}

function changeItem(s: Server, c: Change): Item {
  const url = changeUrl(s.base, c);
  const state = changeState(c);
  const checkout = gitCommand(s.base, c, "Checkout", s.scheme);
  const cherryPick = gitCommand(s.base, c, "Cherry Pick", s.scheme);
  const branch = gitCommand(s.base, c, "Branch", s.scheme);
  const labels = mainLabels(c);

  const accessories: Accessory[] = [
    ...(c.unresolved
      ? [{
        icon: { source: Icons.comment, tint: "orange" as const },
        text: String(c.unresolved),
        tooltip: "Unresolved comments",
      }]
      : []),
    { text: sizeText(c), tooltip: `${sizeBucket(c)}: lines added and removed` },
    ...labels.map((l) => ({
      tag: `${shortLabel(l.name)} ${l.value ? signed(l.value) : "·"}`,
      color: labelColor(l),
      tooltip: `${l.name}${
        l.votes.length ? `: ${l.votes.map((v) => `${v.account.name} ${signed(v.value)}`).join(", ")}` : ""
      }`,
    })),
    { avatar: c.owner.avatar ?? c.owner.name, tooltip: c.owner.name },
    ...(c.updated ? [{ text: age(c.updated), tooltip: `Updated ${new Date(c.updated).toLocaleString("en-GB")}` }] : []),
  ];

  const body = messageBody(c.message);
  const metadata: Metadata[] = [
    meta.text("State", state.title, { icon: Icons.dot, color: state.color }),
    ...c.labels.map((l) =>
      meta.text(l.name, l.value ? signed(l.value) : "No vote", {
        icon: l.state === "rejected" ? Icons.cross : l.value > 0 ? Icons.check : Icons.dot,
        color: labelColor(l),
      })
    ),
    meta.separator(),
    meta.person("Owner", c.owner.name, c.owner.avatar),
    meta.text("Project", c.project, { icon: Icons.repository }),
    meta.text("Branch", c.branch, { icon: Icons.branch }),
    ...(c.topic ? [meta.text("Topic", c.topic, { icon: Icons.tag })] : []),
    ...(c.hashtags.length ? [meta.tags("Hashtags", c.hashtags)] : []),
    ...(c.patchset ? [meta.text("Patch set", String(c.patchset), { icon: Icons.layers })] : []),
    meta.text("Size", `${sizeText(c)} (${sizeBucket(c)})`, { icon: Icons.code }),
    ...(c.comments
      ? [meta.text("Comments", `${c.comments}, ${c.unresolved} unresolved`, { icon: Icons.comment })]
      : []),
    ...(c.attention.length ? [meta.tags("Attention", c.attention.map((a) => a.name))] : []),
    ...(c.reviewers.length ? [meta.tags("Reviewers", c.reviewers.map((a) => a.name).slice(0, 8))] : []),
    ...(c.updated ? [meta.text("Updated", new Date(c.updated).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
    meta.text("Change-Id", c.changeId, { icon: Icons.hash }),
    meta.link("Change", `${s.host} #${c.number}`, url),
  ];

  const actions: Action[] = [
    open(url, "Open Change"),
    ...(checkout ? [copy(checkout, "Copy Checkout Command", { icon: Icons.terminal })] : []),
    copy(c.changeId, "Copy Change-Id", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(url, "Copy Change URL", { shortcut: "<Ctrl>l", section: "Copy" }),
    copy(String(c.number), "Copy Change Number", { section: "Copy" }),
    ...(cherryPick ? [copy(cherryPick, "Copy Cherry-Pick Command", { icon: Icons.terminal, section: "Git" })] : []),
    ...(branch ? [copy(branch, "Copy Checkout as Branch Command", { icon: Icons.branch, section: "Git" })] : []),
    ...(c.ref ? [copy(c.ref, "Copy Ref", { icon: Icons.branch, section: "Git" })] : []),
    open(searchUrl(s.base, `project:${c.project} status:open`), "Open Project's Open Changes", {
      icon: Icons.repository,
      section: "Gerrit",
    }),
    ...(c.topic
      ? [open(searchUrl(s.base, `topic:"${c.topic}"`), "Open Topic", { icon: Icons.tag, section: "Gerrit" })]
      : []),
    ...(c.owner.username || c.owner.email || c.owner.id
      ? [open(
        searchUrl(s.base, `owner:${c.owner.username ?? c.owner.email ?? c.owner.id} status:open`),
        "Open Owner's Changes",
        { icon: Icons.person, section: "Gerrit" },
      )]
      : []),
  ];

  return {
    id: String(c.number),
    title: c.subject,
    subtitle: `${c.project} · ${c.branch}`,
    icon: icon(c),
    keywords: [String(c.number), c.changeId, c.owner.name, c.owner.username ?? "", c.topic ?? "", ...c.hashtags],
    accessories,
    detail: {
      stats: [
        { label: "state", value: state.title, color: state.color },
        ...labels.map((l) => ({ label: l.name, value: l.value ? signed(l.value) : "–", color: labelColor(l) })),
        ...(c.unresolved ? [{ label: "unresolved", value: c.unresolved, color: "orange" as const }] : []),
      ],
      markdown: [
        `## ${c.subject}`,
        body ? `\n${body.length > 1500 ? `${body.slice(0, 1500)}…` : body}` : "",
        "",
        "### Votes",
        "",
        votesMarkdown(c),
        ...(checkout ? ["", "### Checkout", "", "```", checkout, "```"] : []),
      ].join("\n"),
      metadata,
    },
    actions,
  };
}

let status = "";

export default list({
  placeholder: "Filter changes by subject, project, owner, number…",
  filter: { options: FILTERS.map((f) => ({ value: f.value, title: f.title })), default: "review" },
  empty: {
    title: "Nothing here",
    description: "No change matches this view. Tab switches to another one.",
    icon: Icons.pullRequest,
  },
  status: () => status,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ preferences, filter, signal }) {
    status = "";
    const view = FILTERS.find((f) => f.value === filter) ?? FILTERS[0];
    let s: Server;
    try {
      s = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    try {
      const found = await changes(s, view.query, signal);
      status = `${found.changes.length}${found.more ? "+" : ""} change${
        found.changes.length === 1 ? "" : "s"
      } · ${s.host}`;
      if (view.value === "review") {
        const n = found.changes.length;
        updateCommandMetadata({ subtitle: n ? `${n}${found.more ? "+" : ""} to review` : null }).catch(() => {});
      }
      const items = found.changes.map((c) => changeItem(s, c));
      if (found.more) {
        items.push({
          id: "more",
          title: "More changes on Gerrit",
          subtitle: view.query,
          icon: { source: Icons.search, tint: "gray" },
          actions: [open(searchUrl(s.base, view.query), "Open in Gerrit")],
        });
      }
      return items;
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e, normalizeUrl(preferences.url) || undefined)];
      if (view.value === "attention" && /attention/i.test(String((e as Error).message))) {
        throw new Error(`${s.host} has no attention set (Gerrit 3.3 or later): pick another view with Tab`);
      }
      throw e;
    }
  },
});
