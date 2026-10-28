import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  paste,
  pop,
  refresh,
  replace,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  git,
  GitMissing,
  HOME,
  lastRepo,
  type Prefs,
  rememberRepo,
  type RepoInfo,
  repoInfo,
  scanRepos,
} from "../git.ts";
import {
  buildMessage,
  commitCommand,
  type CommitType,
  commitType,
  type Draft,
  gitmoji,
  gitmojisFor,
  header,
  installCommand,
  lint,
  parseShortstat,
  pickRepo,
  type RepoState,
  suggestScopes,
  tilde,
  TYPES,
  usesGitmoji,
} from "../lib.ts";

const name = (path: string) => path.split("/").pop() || path;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function stagedSummary(info: RepoInfo): string {
  if (!info.staged.length) return "nothing staged";
  return `${
    plural(info.stat.files || info.staged.length, "file")
  } staged, +${info.stat.insertions} −${info.stat.deletions}`;
}

// ---------------------------------------------------------------------------
// Step 3: the message, the staged changes, commit

export async function review(draft: Draft, info: RepoInfo | undefined): Promise<DetailSpec> {
  const message = buildMessage(draft);
  const warnings = lint(draft, info?.history);
  const errors = warnings.filter((w) => w.level === "error");
  let stat = "";
  let staged = info?.stat;
  if (info) {
    const [s, short] = await Promise.all([
      git(info.path, ["diff", "--cached", "--stat=80"]).catch(() => ""),
      git(info.path, ["diff", "--cached", "--shortstat"]).catch(() => ""),
    ]);
    stat = s;
    staged = parseShortstat(short);
  }
  const subject = header(draft);
  const t = commitType(draft.type);
  const g = draft.gitmoji ? gitmoji(draft.gitmoji) : undefined;

  const markdown = [
    "```",
    message.trimEnd(),
    "```",
    ...(warnings.length ? ["", ...warnings.map((w) => `> ${w.level === "error" ? "Error" : "Note"}: ${w.text}`)] : []),
    "",
    ...(info
      ? stat ? ["**Staged changes**", "", "```", stat, "```"] : [
        "**Nothing is staged.** Stage what goes in this commit with `git add`, or use “Stage Tracked Changes” (git add -u).",
      ]
      : ["_No repository: copy the message and commit yourself._"]),
  ].join("\n");

  const actions: Action[] = [copy(message, "Copy Message")];
  if (info && staged?.files && !errors.length) {
    actions.push(
      action("Commit Staged Changes", async () => {
        await git(info.path, ["commit", "--file=-", "--cleanup=strip"], { stdin: message });
        const hash = await git(info.path, ["log", "-1", "--format=%h"]).catch(() => "");
        await rememberRepo(info.path);
        await toast(`Committed ${hash}`, { style: "success", message: subject });
        return close(`Committed ${hash} on ${info.branch}`);
      }, {
        icon: Icons.commit,
        confirm: `Commit ${plural(staged.files, "file")} to ${info.branch} in ${name(info.path)}?`,
      }),
    );
  }
  if (info && !staged?.files) {
    actions.push(
      action("Stage Tracked Changes", async () => {
        await git(info.path, ["add", "--update"]);
        return replace(await review(draft, await repoInfo(info.path)));
      }, { icon: Icons.plus, confirm: "Stage every modified and deleted tracked file (git add -u)?" }),
    );
  }
  actions.push(
    paste(message, "Paste Message", { section: "Copy" }),
    copy(subject, "Copy Subject Line", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(commitCommand(message), "Copy git commit Command", { icon: Icons.terminal, section: "Copy" }),
    action("Edit Message", () => pop(), { icon: Icons.note, shortcut: "<Ctrl>e", section: "Message" }),
    ...(info ? [open(info.path, "Open Repository Folder", { icon: Icons.folder, section: "Message" })] : []),
  );

  return detail({
    title: subject,
    markdown,
    stats: [
      { label: "Subject", value: `${[...subject].length}/72`, color: [...subject].length > 72 ? "red" : undefined },
      ...(staged
        ? [
          { label: "Files", value: staged.files },
          { label: "Insertions", value: `+${staged.insertions}`, color: "green" as const },
          { label: "Deletions", value: `−${staged.deletions}`, color: "red" as const },
        ]
        : []),
    ],
    status: info ? `${tilde(info.path, HOME)} · ${info.branch}` : "No repository",
    metadata: [
      meta.tags("Type", [{ text: draft.type, color: t?.tint }]),
      ...(draft.scope ? [meta.text("Scope", draft.scope)] : []),
      ...(draft.breaking ? [meta.tags("Breaking", [{ text: "Breaking change", color: "red" }])] : []),
      ...(g ? [meta.text("Gitmoji", `${g.emoji} :${g.code}:`)] : []),
      ...(info
        ? [
          meta.separator(),
          meta.text("Repository", tilde(info.path, HOME), { icon: Icons.repository }),
          meta.text("Branch", info.branch, { icon: Icons.branch }),
        ]
        : []),
    ],
    actions,
  });
}

// ---------------------------------------------------------------------------
// Step 2: the form

export function composeForm(t: CommitType, info: RepoInfo | undefined, prefs: Prefs): FormSpec {
  const scopes = info ? suggestScopes(info.staged, info.history, t.type) : [];
  const gitmojiOn = prefs.gitmoji === true || (info ? usesGitmoji(info.history) : false);
  const style = prefs.gitmojiStyle?.trim() === "code" ||
      (info && info.history.withGitmoji > 0 && info.history.gitmojiAsCode / info.history.withGitmoji > 0.5)
    ? "code"
    : "emoji";
  return form({
    title: `${t.type}: ${t.title}`,
    submitTitle: "Review",
    fields: [
      field.dropdown("scope", "Scope", [
        { value: "", title: "No scope" },
        ...scopes.map((s) => ({ value: s.scope, title: `${s.scope}  ·  ${s.reason}` })),
      ], { value: scopes.find((s) => s.staged)?.scope ?? "" }),
      field.text("customScope", "Other scope", { placeholder: "Overrides the scope above" }),
      field.text("description", "Description", { required: true, placeholder: t.placeholder }),
      field.textArea("body", "Body", { placeholder: "Why this change, and what it does (wrapped at 72 columns)" }),
      field.checkbox("breaking", "Breaking change"),
      field.text("breakingNote", "What breaks", { placeholder: "The BREAKING CHANGE footer, if any" }),
      field.textArea("footers", "Footers", { placeholder: "Closes #123\nCo-authored-by: Name <email@example.com>" }),
      field.dropdown("gitmoji", "Gitmoji", [
        { value: "", title: "None" },
        ...gitmojisFor(t.type).map((g) => ({ value: g.code, title: `${g.emoji}  ${g.description}` })),
      ], { value: gitmojiOn ? t.gitmoji : "" }),
    ],
    async submit(v) {
      const draft: Draft = {
        type: t.type,
        scope: String(v.customScope ?? "").trim() || String(v.scope ?? ""),
        description: String(v.description ?? ""),
        body: String(v.body ?? ""),
        breaking: v.breaking === true,
        breakingNote: String(v.breakingNote ?? ""),
        footers: String(v.footers ?? ""),
        gitmoji: String(v.gitmoji ?? "") || undefined,
        gitmojiStyle: style,
      };
      if (draft.breakingNote?.trim()) draft.breaking = true;
      return await review(draft, info);
    },
  });
}

// ---------------------------------------------------------------------------
// Step 1: the type, in a repository

function typeItem(t: CommitType, info: RepoInfo | undefined, prefs: Prefs): Item {
  const used = info?.history.types[t.type] ?? 0;
  const scopes = info?.history.scopes.filter((s) => s.types.includes(t.type)).slice(0, 6).map((s) => s.scope) ?? [];
  const g = gitmoji(t.gitmoji)!;
  return {
    id: t.type,
    title: t.type,
    subtitle: t.description,
    icon: { source: t.icon, tint: t.tint },
    section: "Type",
    keywords: [t.title, ...t.title.split(" ")],
    accessories: [
      ...(used ? [{ text: `${used}`, tooltip: `${used} of the last 200 commits` }] : []),
      { text: g.emoji, tooltip: `:${g.code}:` },
    ],
    detail: {
      markdown: [
        `**${t.title}**: ${t.description}.`,
        "",
        "```",
        `${t.type}${scopes[0] ? `(${scopes[0]})` : ""}: ${t.placeholder}`,
        "```",
      ].join("\n"),
      metadata: [
        meta.text("Gitmoji", `${g.emoji} :${g.code}:`),
        ...(info ? [meta.text("In history", `${used} of the last ${info.history.total} commits`)] : []),
        ...(scopes.length ? [meta.tags("Scopes used", scopes)] : []),
      ],
    },
    actions: [action("Compose", () => composeForm(t, info, prefs), { icon: Icons.note })],
  };
}

function repoItem(info: RepoInfo | undefined, repos: RepoState[], roots: string): Item {
  if (!info) {
    return {
      id: "repo",
      title: "No repository found",
      subtitle: `Set the folders to scan in Settings → Extensions → Commit Helper (${roots})`,
      icon: { source: Icons.repository, tint: "gray" },
      section: "Repository",
      actions: [],
    };
  }
  const h = info.history;
  return {
    id: "repo",
    title: name(info.path),
    subtitle: tilde(info.path, HOME),
    icon: { source: Icons.repository, tint: info.staged.length ? "green" : "gray" },
    section: "Repository",
    accessories: [
      { icon: Icons.branch, text: info.branch },
      {
        tag: info.staged.length ? `${info.staged.length} staged` : "Nothing staged",
        color: info.staged.length ? "green" : "gray",
      },
    ],
    detail: {
      stats: [
        { label: "Staged", value: info.staged.length, color: info.staged.length ? "green" : undefined },
        { label: "Conventional", value: h.total ? `${Math.round((h.conventional / h.total) * 100)} %` : "–" },
        { label: "Gitmoji", value: h.total ? `${Math.round((h.withGitmoji / h.total) * 100)} %` : "–" },
      ],
      markdown: info.staged.length
        ? [
          "**Staged files**",
          "",
          ...info.staged.slice(0, 25).map((f) => `- \`${f}\``),
          ...(info.staged.length > 25 ? [`- … ${info.staged.length - 25} more`] : []),
        ].join("\n")
        : "Nothing is staged yet: `git add` what goes in the commit.",
      metadata: [
        meta.text("Branch", info.branch, { icon: Icons.branch }),
        meta.text("Changes", stagedSummary(info)),
        ...(h.scopes.length ? [meta.tags("Scopes", h.scopes.slice(0, 8).map((s) => s.scope))] : []),
      ],
    },
    actions: [
      ...(repos.length > 1 ? [chooseRepo(repos, info.path)] : []),
      open(info.path, "Open Folder", { icon: Icons.folder }),
    ],
  };
}

function chooseRepo(repos: RepoState[], current?: string): Action {
  return submenu("Change Repository", () =>
    [...repos]
      .sort((a, b) => Number(b.staged > 0) - Number(a.staged > 0) || b.lastCommit - a.lastCommit)
      .map((r) =>
        action(
          `${name(r.path)}${r.staged ? `  ·  ${r.staged} staged` : ""}${r.path === current ? "  ✓" : ""}`,
          async () => {
            await rememberRepo(r.path);
            return refresh();
          },
          { icon: Icons.repository },
        )
      ), { icon: Icons.repository, shortcut: "<Ctrl>r" });
}

let status = "";

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  let repos: RepoState[] = [];
  return list({
    placeholder: "Pick the commit type…",
    status: () => status,
    actions: [
      action("Refresh", () => refresh(), { icon: Icons.refresh }),
    ],
    async items({ signal }) {
      let info: RepoInfo | undefined;
      try {
        repos = await scanRepos(prefs, signal);
      } catch (e) {
        if (!(e instanceof GitMissing)) throw e;
        const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
        const install = installCommand(os);
        status = "git is not installed";
        return [{
          id: "missing",
          title: "git is not installed",
          subtitle: install,
          icon: { source: Icons.alert, tint: "orange" },
          actions: [copy(install, "Copy Install Command")],
        }];
      }
      const picked = pickRepo(repos, await lastRepo());
      if (picked) info = await repoInfo(picked.path, signal);
      status = info
        ? `${name(info.path)} · ${info.branch} · ${stagedSummary(info)}`
        : "No repository: messages can still be copied";
      updateCommandMetadata({
        subtitle: info?.staged.length ? `${info.staged.length} staged in ${name(info.path)}` : null,
      })
        .catch(() => {});
      return [
        ...TYPES.map((t) => {
          const item = typeItem(t, info, prefs);
          return repos.length > 1 ? { ...item, actions: [...item.actions!, chooseRepo(repos, info?.path)] } : item;
        }),
        repoItem(info, repos, prefs.folders?.trim() || "~/Projects, ~/code…"),
      ];
    },
  });
};
