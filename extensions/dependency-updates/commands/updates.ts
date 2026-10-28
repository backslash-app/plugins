import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { approve, AuthError, merge, type Prefs, rebase, searchPulls, token } from "../api.ts";
import { age, CHECK_LOOK, JUMP_COLORS, matchesChip, type Pull, sortPulls, tickRebase, versionText } from "../lib.ts";

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=Backslash%20Dependency%20Updates";
const CACHE = "pulls";

const BOT_NAMES: Record<Pull["bot"], string> = { renovate: "Renovate", dependabot: "Dependabot", other: "Bot" };

/** GraphQL gives a GitHub App's login without "[bot]"; search wants app/<name>. */
const authorQualifier = (p: Pull) => (p.bot === "other" ? p.author : `app/${p.author}`);

function checksMarkdown(p: Pull): string {
  if (!p.checkRuns.length) return "";
  const icon = { success: "✓", failure: "✗", pending: "…", neutral: "–", skipped: "–" };
  const order = { failure: 0, pending: 1, success: 2, neutral: 3, skipped: 4 };
  return [
    "### Checks",
    "",
    ...[...p.checkRuns].sort((a, b) => order[a.state] - order[b.state]).map((c) =>
      `- ${icon[c.state]} ${c.url ? `[${c.name}](${c.url})` : c.name}`
    ),
  ].join("\n");
}

function changesMarkdown(p: Pull): string {
  const u = p.update;
  if (u.changes.length < 2) return "";
  return [
    "| Package | From | To | Update |",
    "| --- | --- | --- | --- |",
    ...u.changes.map((c) => `| ${c.name} | ${c.from ?? ""} | ${c.to ?? ""} | ${c.jump ?? ""} |`),
  ].join("\n");
}

function pullActions(t: string, p: Pull, all: Pull[]): Action[] {
  const actions: Action[] = [
    open(p.url, "Open Pull Request", { icon: Icons.pullRequest }),
    action("Approve", async () => {
      await approve(t, p);
      await toast(`Approved #${p.number}`, { style: "success", message: p.repo });
      return refresh();
    }, { icon: Icons.check, shortcut: "<Ctrl><Shift>a" }),
    action("Merge (Squash)", async () => {
      const message = await merge(t, p);
      await toast(`Merged #${p.number}`, { style: "success", message });
      return refresh();
    }, {
      icon: Icons.merged,
      shortcut: "<Ctrl><Shift>m",
      destructive: true,
      confirm: `Squash and merge ${p.update.label} into ${p.base} of ${p.repo}?${
        p.checks !== "passing" ? ` Its checks are ${CHECK_LOOK[p.checks].label.toLowerCase()}.` : ""
      }`,
    }),
  ];
  const passingHere = all.filter((x) => x.repo === p.repo && x.checks === "passing" && x.mergeable !== "CONFLICTING");
  if (passingHere.length > 1) {
    actions.push(action(`Merge All ${passingHere.length} Passing in ${p.repo}`, async () => {
      const failed: string[] = [];
      for (const x of passingHere) {
        try {
          await merge(t, x);
        } catch (e) {
          failed.push(`#${x.number}: ${(e as Error).message}`);
        }
      }
      await toast(
        `Merged ${passingHere.length - failed.length} of ${passingHere.length}`,
        { style: failed.length ? "failure" : "success", message: failed[0] },
      );
      return refresh();
    }, {
      icon: Icons.merged,
      destructive: true,
      confirm: `Squash and merge the ${passingHere.length} passing dependency updates of ${p.repo}, one after another?`,
      section: "Repository",
    }));
  }
  if (p.bot === "dependabot" || (p.bot === "renovate" && p.renovateRebase)) {
    actions.push(action(`Ask ${BOT_NAMES[p.bot]} to Rebase`, async () => {
      await rebase(t, p, p.bot === "renovate" ? tickRebase(p.body) : undefined);
      await toast(`${BOT_NAMES[p.bot]} will rebase #${p.number}`, { style: "success" });
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>b" }));
  }
  actions.push(
    open(`${p.url}/checks`, "Open Checks", { icon: Icons.activity, shortcut: "<Ctrl>k", section: "Open" }),
    open(`${p.url}/files`, "Open Changed Files", { icon: Icons.file, section: "Open" }),
    open(
      `https://github.com/${p.repo}/pulls?q=${encodeURIComponent(`is:pr is:open author:${authorQualifier(p)}`)}`,
      "Open All in Repository",
      {
        icon: Icons.repository,
        section: "Open",
      },
    ),
    copy(p.url, "Copy URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(p.update.label, "Copy Package Name", { section: "Copy", shortcut: "<Ctrl>." }),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
  );
  return actions;
}

function pullItem(t: string, p: Pull, all: Pull[]): Item {
  const u = p.update;
  const look = CHECK_LOOK[p.checks];
  const versions = versionText(u);
  const accessories: Accessory[] = [];
  if (u.security) accessories.push({ tag: "Security", color: "red", icon: Icons.shield });
  if (p.mergeable === "CONFLICTING") accessories.push({ tag: "Conflicts", color: "orange" });
  if (p.review === "APPROVED") accessories.push({ icon: { source: Icons.check, tint: "green" }, tooltip: "Approved" });
  if (p.autoMerge) accessories.push({ icon: { source: Icons.bolt, tint: "purple" }, tooltip: "Auto-merge enabled" });
  if (u.jump) accessories.push({ tag: u.jump, color: JUMP_COLORS[u.jump] });
  accessories.push({ tag: look.label, color: look.color });
  accessories.push({ text: age(p.created), tooltip: `Opened ${new Date(p.created).toLocaleDateString()}` });
  const failing = p.checkRuns.filter((c) => c.state === "failure");
  return {
    id: p.id,
    title: u.label,
    subtitle: [versions, u.directory].filter(Boolean).join(" · ") || p.title,
    icon: {
      source: p.draft ? Icons.pullRequestDraft : p.checks === "failing" ? Icons.pullRequestClosed : Icons.pullRequest,
      tint: look.color,
    },
    section: p.repo,
    keywords: [p.repo, BOT_NAMES[p.bot], String(p.number), u.jump ?? "", ...u.changes.map((c) => c.name), ...p.labels]
      .filter(Boolean),
    accessories,
    detail: {
      markdown: [`**${p.title}**`, changesMarkdown(p), checksMarkdown(p)].filter(Boolean).join("\n\n"),
      metadata: [
        meta.link("Pull request", `${p.repo}#${p.number}`, p.url),
        meta.text("Opened by", BOT_NAMES[p.bot], { icon: Icons.person }),
        ...(versions ? [meta.text("Versions", versions, { icon: Icons.tag })] : []),
        ...(u.jump ? [meta.tags("Update", [{ text: u.jump, color: JUMP_COLORS[u.jump] }])] : []),
        meta.text("Checks", `${look.label}${failing.length ? ` (${failing.map((c) => c.name).join(", ")})` : ""}`, {
          icon: Icons.activity,
          color: look.color,
        }),
        meta.text(
          "Mergeable",
          p.mergeable === "MERGEABLE" ? "Yes" : p.mergeable === "CONFLICTING" ? "No, conflicts" : "Checking…",
        ),
        meta.text(
          "Review",
          p.review === "APPROVED"
            ? "Approved"
            : p.review === "CHANGES_REQUESTED"
            ? "Changes requested"
            : p.review === "REVIEW_REQUIRED"
            ? "Required"
            : "Not required",
        ),
        meta.text("Branch", `${p.head} → ${p.base}`, { icon: Icons.branch }),
        ...(p.labels.length ? [meta.tags("Labels", p.labels)] : []),
        meta.text("Opened", new Date(p.created).toLocaleString(), { icon: Icons.clock }),
      ],
    },
    actions: pullActions(t, p, all),
  };
}

function setupItems(e: AuthError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "A classic token with the repo scope, or a fine-grained one",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect GitHub",
        "",
        "Enter creates a classic token with the **repo** scope (needed to approve and merge).",
        "A fine-grained token works too: **Pull requests: Read and write**, **Contents: Read and write**,",
        "**Commit statuses: Read** and **Checks: Read** on your repositories.",
        "",
        "Paste it in **Settings → Extensions → Dependency Updates → Configure**, or sign in with",
        "`gh auth login`: the GitHub CLI's token is used when none is set.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Token", { icon: Icons.key })],
  }];
}

export default list({
  placeholder: "Filter by package, repository or version…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "passing", title: "Passing" },
      { value: "failing", title: "Failing" },
      { value: "major", title: "Major" },
    ],
  },
  empty: {
    title: "No dependency update waiting",
    description: "No open Renovate or Dependabot pull request matches. Add organizations or repositories in Settings.",
    icon: Icons.done,
  },
  status: (items) => {
    if (items[0]?.id === "setup") return "Not connected";
    const repos = new Set(items.map((i) => i.section)).size;
    return `${items.length} update${items.length === 1 ? "" : "s"} in ${repos} repositor${repos === 1 ? "y" : "ies"}`;
  },
  items: async function* ({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    let t: string;
    try {
      t = await token(prefs);
    } catch (e) {
      if (e instanceof AuthError) {
        yield setupItems(e);
        return;
      }
      throw e;
    }
    const rows = (pulls: Pull[]) => {
      const sorted = sortPulls(pulls);
      return sorted.filter((p) => matchesChip(p, filter)).map((p) => pullItem(t, p, sorted));
    };
    const cached = await storage.get(CACHE).catch(() => undefined) as Pull[] | undefined;
    if (cached?.length) yield rows(cached);
    try {
      const { pulls } = await searchPulls(t, prefs, signal);
      // Without the bodies, which can be long (release notes); the next load brings them back.
      await storage.set(CACHE, pulls.map((p) => ({ ...p, body: "" })) as any).catch(() => {});
      const failing = pulls.filter((p) => p.checks === "failing").length;
      updateCommandMetadata({
        subtitle: pulls.length ? `${pulls.length} open${failing ? `, ${failing} failing` : ""}` : null,
      }).catch(() => {});
      yield rows(pulls);
    } catch (e) {
      if (e instanceof AuthError) {
        yield setupItems(e);
        return;
      }
      throw e;
    }
  },
});
