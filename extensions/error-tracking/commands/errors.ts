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
  type Stat,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Config, config, load, type Loaded, SetupError, triage } from "../api.ts";
import {
  compact,
  isRecent,
  type Issue,
  issueMarkdown,
  levelLook,
  type Service,
  SERVICES,
  since,
  sortIssues,
} from "../lib.ts";

const LINKS: Record<Service, string> = {
  glitchtip: "https://app.glitchtip.com/profile/auth-tokens",
  rollbar: "https://docs.rollbar.com/reference/getting-started-1#authentication",
  honeybadger: "https://app.honeybadger.io/users/edit#authentication",
  bugsnag: "https://app.bugsnag.com/settings/my-account/personal-auth-tokens",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function triageAction(c: Config, i: Issue, what: "resolve" | "ignore"): Action {
  const resolve = what === "resolve";
  const verb = resolve ? "Resolve" : i.service === "rollbar" ? "Mute" : "Ignore";
  return action(verb, async () => {
    await triage(c, i, what);
    await toast(`${resolve ? "Resolved" : i.service === "rollbar" ? "Muted" : "Ignored"} ${i.title}`, {
      style: "success",
    });
    return refresh();
  }, {
    icon: resolve ? Icons.check : Icons.bellOff,
    shortcut: resolve ? "<Ctrl>e" : "<Ctrl><Shift>i",
    section: "Triage",
    ...(resolve ? {} : { confirm: `${verb} “${i.title}”? New events won't bring it back to this list.` }),
  });
}

function issueItem(c: Config, i: Issue): Item {
  const look = levelLook(i.level);
  const service = SERVICES[i.service];
  const stats: Stat[] = [
    ...(i.events !== undefined ? [{ label: "Events", value: compact(i.events) }] : []),
    ...(i.users !== undefined
      ? [{ label: i.service === "rollbar" ? "Unique" : "Users", value: compact(i.users) }]
      : []),
    ...(i.lastSeen ? [{ label: "Last seen", value: since(i.lastSeen) }] : []),
  ];
  const lines: Metadata[] = [
    meta.text("Service", service.title, { icon: Icons.bug, color: service.color }),
    meta.text("Project", i.project, { icon: Icons.project }),
    meta.text("Level", look.text, { icon: look.icon, color: look.tint }),
    ...(i.environment ? [meta.text("Environment", i.environment, { icon: Icons.server })] : []),
    ...(i.culprit ? [meta.text("Where", i.culprit, { icon: Icons.code })] : []),
    ...(i.assignee ? [meta.person("Assignee", i.assignee)] : []),
    meta.separator(),
    ...(i.firstSeen ? [meta.text("First seen", since(i.firstSeen), { icon: Icons.clock })] : []),
    ...(i.lastSeen ? [meta.text("Last seen", since(i.lastSeen), { icon: Icons.clock })] : []),
    ...(i.shortId ? [meta.text("ID", i.shortId)] : []),
    ...(i.url ? [meta.link("Link", new URL(i.url).host, i.url)] : []),
  ];
  const accessories: Accessory[] = [
    ...(i.environment && !i.environment.includes(",") ? [{ text: i.environment, tooltip: "Environment" }] : []),
    ...(i.events !== undefined ? [{ text: compact(i.events), icon: Icons.activity, tooltip: "Events" }] : []),
    ...(i.users ? [{ text: compact(i.users), icon: Icons.person, tooltip: "Users" }] : []),
    ...(i.lastSeen ? [{ text: since(i.lastSeen), tooltip: "Last seen" }] : []),
    { tag: service.title, color: service.color },
  ];
  return {
    id: `${i.service}:${i.id}`,
    title: i.title,
    subtitle: [i.project, i.culprit].filter(Boolean).join(" · "),
    icon: { source: look.icon, tint: look.tint },
    keywords: [i.project, i.culprit ?? "", i.shortId ?? "", service.title, i.environment ?? "", i.message ?? ""],
    accessories,
    detail: { stats, markdown: issueMarkdown(i), metadata: lines },
    actions: [
      ...(i.url ? [open(i.url, `Open in ${service.title}`)] : []),
      triageAction(c, i, "resolve"),
      triageAction(c, i, "ignore"),
      ...(i.url ? [copy(i.url, "Copy Link", { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
      copy(i.title, "Copy Title", { section: "Copy" }),
      ...(i.message ? [copy(i.message, "Copy Message", { section: "Copy" })] : []),
    ],
  };
}

function errorItem(l: Loaded): Item {
  const service = SERVICES[l.service];
  return {
    id: `error:${l.service}`,
    title: `${service.title} couldn't list its errors`,
    subtitle: l.error,
    icon: { source: Icons.alert, tint: "orange" },
    detail: { markdown: `## ${service.title}\n\n${l.error}` },
    actions: [
      open(LINKS[l.service], `Open ${service.title} Tokens`, { icon: Icons.key }),
      copy(l.error ?? "", "Copy Error"),
    ],
  };
}

function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: "Add a token for each service you use in the extension's preferences",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your error trackers",
        "",
        "In **Settings → Extensions → Error Tracking → Configure**, fill in the ones you use:",
        "",
        "- **GlitchTip**: the address (`https://app.glitchtip.com` or yours on your network), the organization slug",
        "  and an auth token from **Profile → Auth Tokens** (`project:read`, `event:write`)",
        "- **Rollbar**: a project access token with `read` (and `write` to resolve), and `account/project` for links",
        "- **Honeybadger**: your personal auth token, and `eu` if your account is on eu-app.honeybadger.io",
        "- **Bugsnag**: a personal auth token",
        "",
        "A self-hosted GlitchTip must be on this computer, your local network (`.lan`, `.local`, private",
        "addresses) or Tailscale: extensions declare the hosts they reach.",
      ].join("\n"),
    },
    actions: [
      open(LINKS.glitchtip, "GlitchTip Auth Tokens", { icon: Icons.key }),
      open(LINKS.bugsnag, "Bugsnag Personal Tokens", { icon: Icons.key }),
      open(LINKS.honeybadger, "Honeybadger Auth Token", { icon: Icons.key }),
      open(LINKS.rollbar, "Rollbar Access Tokens", { icon: Icons.key }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter errors by title, project, environment…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "recent", title: "Last 24 hours" },
      ...Object.entries(SERVICES).map(([value, s]) => ({ value, title: s.title })),
    ],
  },
  empty: { title: "No unresolved error", description: "Nothing matches this view. Well done.", icon: Icons.done },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items({ preferences, signal, filter }) {
    let c: Config;
    try {
      c = config(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        summary = "Not connected";
        return yield [setupItem(e)];
      }
      throw e;
    }
    let last: Loaded[] = [];
    for await (const loaded of load(c, signal)) {
      last = loaded;
      const all = sortIssues(loaded.flatMap((l) => l.issues));
      const shown = all.filter((i) =>
        filter === "recent" ? isRecent(i) : filter && filter in SERVICES ? i.service === filter : true
      );
      summary = `${plural(all.length, "unresolved error")}${
        loaded.length < Object.keys(c).length ? " · loading…" : ""
      }`;
      yield [
        ...loaded.filter((l) => l.error).map(errorItem),
        ...shown.map((i) => issueItem(c, i)),
      ];
    }
    const total = last.reduce((n, l) => n + l.issues.length, 0);
    updateCommandMetadata({ subtitle: total ? `${total} unresolved` : null }).catch(() => {});
  },
});
