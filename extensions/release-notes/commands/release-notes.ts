import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  paste,
  refresh,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  commitsIn,
  git,
  HOME,
  Missing,
  type Prefs,
  recentRepos,
  refDate,
  rememberRepo,
  repoInfo,
  type RepoSummary,
  run,
  scanRepos,
  summarize,
  tagExists,
} from "../git.ts";
import {
  age,
  type Bump,
  bump,
  compareUrl,
  formatVersion,
  groupCommits,
  hasVersion,
  installCommand,
  type Notes,
  parseVersion,
  plural,
  prependChangelog,
  renderMarkdown,
  renderPlain,
  suggest,
  tilde,
} from "../lib.ts";

const name = (path: string) => path.split("/").pop() || path;

interface Range {
  path: string;
  /** Start (excluded); undefined for the whole history. */
  from?: string;
  /** `HEAD` or a tag. */
  to: string;
  /** Chosen instead of the suggestion. */
  bump?: Bump;
}

const CHANGELOG_NAMES = ["CHANGELOG.md", "Changelog.md", "changelog.md", "CHANGES.md"];

async function readChangelog(dir: string): Promise<{ path: string; text?: string }> {
  for (const n of CHANGELOG_NAMES) {
    try {
      return { path: `${dir}/${n}`, text: await Deno.readTextFile(`${dir}/${n}`) };
    } catch (e) {
      if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) throw outsideFolders(dir);
    }
  }
  return { path: `${dir}/CHANGELOG.md` };
}

const outsideFolders = (dir: string) =>
  new Error(
    `${
      tilde(dir, HOME)
    } is outside the folders this extension may write to: ~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/Developer, ~/git, ~/repos, ~/workspace, ~/work`,
  );

async function missingTool(program: string): Promise<Error> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const login = program === "gh"
    ? " and sign in with gh auth login"
    : program === "glab"
    ? " and sign in with glab auth login"
    : "";
  return new Error(`${program} is not installed: ${installCommand(os, program)}${login}`);
}

/** Runs gh or glab, explaining how to install it when it is missing. */
async function cli(program: "gh" | "glab", args: string[], cwd: string, stdin: string): Promise<string> {
  try {
    return await run(program, args, { cwd, stdin });
  } catch (e) {
    if (e instanceof Missing) throw await missingTool(program);
    throw e;
  }
}

async function ensureTag(path: string, tag: string, message: string, ref: string): Promise<boolean> {
  if (await tagExists(path, tag)) return false;
  await git(path, ["tag", "--annotate", tag, "--file=-", "--cleanup=verbatim", ref], { stdin: message });
  return true;
}

async function notesView(r: Range, prefs: Prefs): Promise<DetailSpec> {
  const info = await repoInfo(r.path, prefs.remote || undefined);
  const commits = await commitsIn(r.path, r.from, r.to);
  const notes: Notes = groupCommits(commits, { hideMinor: prefs.hideMinor === true });
  const releasing = r.to === "HEAD";
  const current = r.from ? parseVersion(r.from) : undefined;
  const suggestion = suggest(current, notes);
  const nextVersion = releasing ? formatVersion(r.bump && current ? bump(current, r.bump) : suggestion.next) : r.to;
  const date = releasing ? new Date().toISOString().slice(0, 10) : await refDate(r.path, r.to);
  const links = prefs.links !== false;
  const base = { version: nextVersion, date, remote: info.remote, from: r.from, to: releasing ? nextVersion : r.to };
  const markdown = renderMarkdown(notes, { ...base, links });
  const noLinks = renderMarkdown(notes, { ...base, links: false });
  const body = renderMarkdown(notes, { ...base, links, heading: false });
  const plain = renderPlain(notes, nextVersion);
  const count = (title: string) => notes.groups.find(([t]) => t === title)?.[1].length ?? 0;
  const tagged = releasing ? await tagExists(r.path, nextVersion) : true;
  const rangeText = `${r.from ?? "first commit"}..${releasing ? "HEAD" : r.to}`;
  const compare = info.remote
    ? compareUrl(info.remote, r.from, releasing ? (info.branch.startsWith("(") ? info.head : info.branch) : r.to)
    : undefined;
  const again = (next: Partial<Range>) => async () => replace(await notesView({ ...r, ...next }, prefs));

  const actions: Action[] = [
    copy(markdown, "Copy Markdown"),
    paste(markdown, "Paste Markdown"),
    action("Add to CHANGELOG.md", async () => {
      const file = await readChangelog(r.path);
      if (file.text && hasVersion(file.text, nextVersion)) {
        throw new Error(`${name(file.path)} already has a section for ${nextVersion}`);
      }
      try {
        await Deno.writeTextFile(file.path, prependChangelog(file.text, markdown));
      } catch (e) {
        if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
          throw outsideFolders(r.path);
        }
        throw e;
      }
      await toast(`${file.text ? "Updated" : "Created"} ${name(file.path)}`, {
        style: "success",
        message: `${nextVersion} added on top: review and commit it`,
      });
    }, {
      icon: Icons.file,
      shortcut: "<Ctrl><Shift>w",
      confirm: `Add the ${nextVersion} notes on top of CHANGELOG.md in ${name(r.path)}?`,
    }),
  ];
  if (releasing && !tagged && notes.changes.length) {
    actions.push(action(`Create Tag ${nextVersion}`, async () => {
      await ensureTag(r.path, nextVersion, plain, "HEAD");
      await toast(`Tagged ${info.head} as ${nextVersion}`, {
        style: "success",
        message: "Push it with git push --tags",
      });
      // The notes of the new tag, ready to publish.
      return replace(await notesView({ ...r, to: nextVersion, bump: undefined }, prefs));
    }, {
      icon: Icons.tag,
      shortcut: "<Ctrl>t",
      confirm: `Create the annotated tag ${nextVersion} on ${info.head} (${info.branch})?`,
    }));
  }
  const remote = info.remote;
  if (remote && remote.kind !== "other" && info.remoteName && (notes.changes.length || !releasing)) {
    const github = remote.kind === "github";
    const site = github ? "GitHub" : "GitLab";
    const createRelease = (draft: boolean) => async () => {
      const created = releasing ? await ensureTag(r.path, nextVersion, plain, "HEAD") : false;
      await git(r.path, ["push", info.remoteName!, `refs/tags/${nextVersion}`]);
      const pre = Boolean(parseVersion(nextVersion)?.pre);
      const out = github
        ? await cli(
          "gh",
          [
            "release",
            "create",
            nextVersion,
            "--repo",
            remote.path,
            "--title",
            nextVersion,
            "--notes-file",
            "-",
            "--verify-tag",
            ...(draft ? ["--draft"] : []),
            ...(pre ? ["--prerelease"] : []),
          ],
          r.path,
          body,
        )
        : await cli(
          "glab",
          [
            "release",
            "create",
            nextVersion,
            "--repo",
            remote.host === "gitlab.com" ? remote.path : remote.web,
            "--name",
            nextVersion,
            "--notes-file",
            "-",
          ],
          r.path,
          body,
        );
      const url = out.split("\n").map((l) => l.trim()).find((l) => /^https?:\/\//.test(l)) ??
        (github ? `${remote.web}/releases/tag/${nextVersion}` : `${remote.web}/-/releases/${nextVersion}`);
      await openExternal(url).catch(() => {});
      return close(`${draft ? "Draft release" : "Release"} ${nextVersion} created${created ? " (tag pushed)" : ""}`);
    };
    const what = releasing && !tagged
      ? `Tag ${info.head} as ${nextVersion}, push the tag to ${info.remoteName} and publish`
      : `Push ${nextVersion} to ${info.remoteName} and publish`;
    actions.push(
      action(`Create ${site} Release`, createRelease(false), {
        icon: Icons.rocket,
        shortcut: "<Ctrl><Shift>r",
        confirm: `${what} the ${site} release of ${remote.path}?`,
      }),
    );
    if (github) {
      actions.push(action("Create Draft GitHub Release", createRelease(true), {
        icon: Icons.pullRequestDraft,
        confirm: `${what} a draft GitHub release of ${remote.path}?`,
      }));
    }
  }
  if (releasing && current) {
    actions.push(submenu(
      "Choose Version",
      (["major", "minor", "patch"] as Bump[]).map((k) =>
        action(
          `${formatVersion(bump(current, k))} (${k})${k === suggestion.kind ? " · suggested" : ""}`,
          again({ bump: k }),
          {
            icon: Icons.tag,
          },
        )
      ),
      { icon: Icons.tag, shortcut: "<Ctrl>v", section: "Range" },
    ));
  }
  actions.push(
    submenu("Change Range", () => rangeActions(r.path, info.tags, prefs), {
      icon: Icons.history,
      shortcut: "<Ctrl>g",
      section: "Range",
    }),
    copy(noLinks, "Copy Markdown Without Links", { icon: Icons.text, section: "Copy" }),
    copy(plain, "Copy Plain Text", { icon: Icons.text, section: "Copy" }),
    copy(nextVersion, "Copy Version", { icon: Icons.tag, section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(
      `git tag -a ${nextVersion} -m "${nextVersion}" && git push ${info.remoteName ?? "origin"} ${nextVersion}`,
      "Copy git tag Command",
      {
        icon: Icons.terminal,
        section: "Copy",
      },
    ),
    ...(compare
      ? [open(compare, `Open Comparison on ${remote?.kind === "gitlab" ? "GitLab" : "GitHub"}`, { section: "Open" })]
      : []),
    open(r.path, "Open Folder", { icon: Icons.folder, section: "Open", shortcut: "<Ctrl>o" }),
  );

  const empty = !notes.changes.length;
  return detail({
    title: `${name(r.path)} · ${nextVersion}`,
    markdown: empty
      ? `## Nothing to release\n\nNo commit in \`${rangeText}\`${
        notes.skipped ? ` besides ${plural(notes.skipped, "merge or version bump")}` : ""
      }. Pick another range with Ctrl+G.`
      : markdown,
    stats: [
      { label: "Commits", value: notes.changes.length },
      { label: "Features", value: count("Features"), color: "green" },
      { label: "Fixes", value: count("Bug Fixes"), color: "blue" },
      ...(notes.breaking.length ? [{ label: "Breaking", value: notes.breaking.length, color: "red" as const }] : []),
    ],
    metadata: [
      meta.text("Repository", tilde(r.path, HOME), { icon: Icons.repository }),
      meta.text("Branch", info.branch, { icon: Icons.branch }),
      meta.text("Range", rangeText, { icon: Icons.history }),
      ...(releasing
        ? [
          meta.text("Current version", r.from ?? "none", { icon: Icons.tag }),
          meta.text("Next version", nextVersion, { icon: Icons.tag, color: tagged ? "orange" : "green" }),
          meta.text("Why", r.bump ? `Chosen: ${r.bump}` : suggestion.reason),
          ...(tagged ? [meta.text("Tag", `${nextVersion} already exists`, { color: "orange" })] : []),
        ]
        : [meta.text("Release", r.to, { icon: Icons.tag })]),
      ...(remote ? [meta.link("Remote", remote.path, remote.web)] : []),
      ...(notes.skipped ? [meta.text("Left out", plural(notes.skipped, "merge or version commit"))] : []),
    ],
    status: empty ? "No changes in this range" : `${rangeText} · ${plural(notes.changes.length, "change")}`,
    actions,
  });
}

/** The ranges worth picking: since each recent tag, the last release, the whole history. */
function rangeActions(path: string, tags: string[], prefs: Prefs): Action[] {
  const go = (r: Range) => async () => replace(await notesView(r, prefs));
  const out: Action[] = tags.slice(0, 12).map((t, i) =>
    action(`Since ${t}${i === 0 ? " (latest)" : ""}`, go({ path, from: t, to: "HEAD" }), { icon: Icons.tag })
  );
  for (let i = 0; i < Math.min(tags.length, 6); i++) {
    out.push(action(
      `Release ${tags[i]} (${tags[i + 1] ?? "first commit"}..${tags[i]})`,
      go({
        path,
        from: tags[i + 1],
        to: tags[i],
      }),
      { icon: Icons.history, section: "Past releases" },
    ));
  }
  out.push(action("Whole History", go({ path, to: "HEAD" }), { icon: Icons.history }));
  return out;
}

function repoItem(s: RepoSummary, recent: boolean, prefs: Prefs, now: number): Item {
  const write = async () => {
    await rememberRepo(s.path);
    return await notesView({ path: s.path, from: s.tag, to: "HEAD" }, prefs);
  };
  return {
    id: s.path,
    title: name(s.path),
    subtitle: tilde(s.path, HOME),
    section: recent ? "Recent" : "Repositories",
    icon: { source: Icons.repository, tint: s.pending ? "green" : "gray" },
    keywords: [s.tag ?? ""],
    accessories: [
      ...(s.tag ? [{ tag: s.tag }] : [{ tag: "no tag", color: "gray" as const }]),
      {
        text: s.pending ? `${plural(s.pending, "commit")} since` : "up to date",
        color: s.pending ? "green" as const : undefined,
      },
      { text: age(s.lastCommit, now), tooltip: new Date(s.lastCommit * 1000).toLocaleString("en") },
    ],
    actions: [
      action("Write Release Notes", write, { icon: Icons.note }),
      submenu("Release Notes Since…", async () => {
        const info = await repoInfo(s.path, prefs.remote || undefined);
        return rangeActions(s.path, info.tags, prefs);
      }, { icon: Icons.history, shortcut: "<Ctrl>g" }),
      open(s.path, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      copy(s.path, "Copy Path", { section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

async function missingGit(): Promise<Item[]> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const cmd = installCommand(os, "git");
  return [{
    id: "no-git",
    title: "git is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    actions: [copy(cmd, "Copy Install Command")],
  }];
}

let footer = "";

export default list({
  placeholder: "Pick a repository to write its release notes…",
  empty: {
    title: "No git repository found",
    description: "Set the folders to scan in Settings → Extensions → Release Notes",
    icon: Icons.repository,
  },
  status: () => footer,
  async *items(ctx: Context) {
    const prefs = ctx.preferences as Prefs;
    const now = Date.now();
    try {
      // Recent repositories first, while the folders are scanned.
      const recent = await recentRepos();
      const first = (await Promise.all(recent.map((p) => summarize(p, ctx.signal).catch(() => undefined))))
        .filter((s): s is RepoSummary => s !== undefined && s.lastCommit > 0);
      if (first.length) {
        footer = "Scanning your folders…";
        yield first.map((s) => repoItem(s, true, prefs, now));
      }
      const all = await scanRepos(prefs, ctx.signal);
      const seen = new Set(first.map((s) => s.path));
      const ready = all.filter((s) => s.pending && !seen.has(s.path)).length;
      footer = `${all.length} ${all.length === 1 ? "repository" : "repositories"}${
        ready ? ` · ${ready} with unreleased commits` : ""
      }`;
      yield [
        ...first.map((s) => repoItem(s, true, prefs, now)),
        ...all.filter((s) => !seen.has(s.path)).map((s) => repoItem(s, false, prefs, now)),
      ];
    } catch (e) {
      if (e instanceof Missing && (e.program === "git" || e.program === "find")) {
        footer = "";
        yield await missingGit();
        return;
      }
      throw e;
    }
  },
});
