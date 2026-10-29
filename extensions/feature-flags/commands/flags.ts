import { type Action, action, type Context, copy, Icons, type Item, list, open, refresh, toast } from "@backslash/api";
import { type Account, accounts, loadFlags, type Prefs, SetupError, toggle, TOKEN_PAGES } from "../api.ts";
import {
  envAccessories,
  type Flag,
  flagMetadata,
  type Provider,
  PROVIDER_COLORS,
  PROVIDER_NAMES,
  PROVIDERS,
  sortFlags,
  stateSummary,
  toggleConfirm,
  toggleTitle,
} from "../lib.ts";

function toggleActions(a: Account, f: Flag): Action[] {
  return f.environments.map((e, i) =>
    action(toggleTitle(e), async () => {
      await toggle(a, f, e);
      await toast(`${f.name}: ${e.on ? "off" : "on"} in ${e.name}`, {
        style: "success",
        message: PROVIDER_NAMES[f.provider],
      });
      return refresh();
    }, {
      icon: e.on ? Icons.eyeOff : Icons.eye,
      destructive: e.production,
      confirm: toggleConfirm(f, e),
      // The first environment that isn't production gets Ctrl+T.
      shortcut: i === f.environments.findIndex((x) => !x.production) ? "<Ctrl>t" : undefined,
      section: "Toggle",
    })
  );
}

function flagItem(a: Account, f: Flag, multi: boolean): Item {
  const s = stateSummary(f);
  return {
    id: `${f.provider}/${f.project}/${f.key}`,
    title: f.name,
    subtitle: f.name !== f.key ? f.key : f.description,
    icon: { source: f.archived ? Icons.archive : s.icon, tint: f.archived ? "gray" : s.color },
    section: multi ? `${PROVIDER_NAMES[f.provider]} · ${f.project}` : f.project,
    keywords: [f.key, f.project, PROVIDER_NAMES[f.provider], ...f.tags, ...f.environments.map((e) => e.name)],
    accessories: [
      ...(f.stale ? [{ tag: "Stale", color: "orange" as const }] : []),
      ...(f.archived ? [{ tag: "Archived", color: "gray" as const }] : []),
      ...envAccessories(f),
      ...(multi ? [{ tag: PROVIDER_NAMES[f.provider], color: PROVIDER_COLORS[f.provider] }] : []),
    ],
    detail: {
      markdown: f.description ? `**${f.name}**\n\n${f.description}` : `**${f.name}**`,
      metadata: flagMetadata(f),
    },
    actions: [
      open(f.url, `Open in ${PROVIDER_NAMES[f.provider]}`),
      ...(f.archived ? [] : toggleActions(a, f)),
      copy(f.key, "Copy Key", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(f.url, "Copy URL", { shortcut: "<Ctrl>period", section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function errorItem(provider: Provider, err: unknown): Item {
  const setup = err instanceof SetupError;
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: `error:${provider}`,
    title: message,
    subtitle: setup ? "Settings → Extensions → Feature Flags" : PROVIDER_NAMES[provider],
    icon: { source: setup ? Icons.key : Icons.alert, tint: "orange" },
    section: "Problems",
    detail: { markdown: `**${PROVIDER_NAMES[provider]}**: ${message}` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(TOKEN_PAGES[provider], "Open Token Help", { icon: Icons.key }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a feature flag service",
    subtitle: "Add a LaunchDarkly, Unleash, Flagsmith or GrowthBook token in Settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your flags",
        "",
        "In **Settings → Extensions → Feature Flags**, fill the ones you use:",
        "",
        "- **LaunchDarkly**: an access token (role *Writer* to toggle) and the project keys",
        "- **Unleash**: your server's address, a personal or admin API token, and the project IDs",
        "- **Flagsmith**: an organisation API key and the project ID (and the API address if self-hosted)",
        "- **GrowthBook**: a secret API key (and the API address if self-hosted)",
        "",
        "Toggling a flag in an environment whose name looks like production (`prod`, `production`, `live`)",
        "asks for a confirmation first.",
      ].join("\n"),
    },
    actions: PROVIDERS.map((p) => open(TOKEN_PAGES[p], `Open ${PROVIDER_NAMES[p]} Token Help`, { icon: Icons.key })),
  };
}

let summary = "";

export default (ctx: Context) => {
  const configured = accounts(ctx.preferences as Prefs);
  const providers = [...new Set(configured.map((a) => a.provider))];
  return list({
    placeholder: "Filter flags by name, key, tag, project…",
    filter: {
      options: [
        { value: "active", title: "Active" },
        { value: "archived", title: "Archived" },
        ...(providers.length > 1 ? providers.map((p) => ({ value: p, title: PROVIDER_NAMES[p] })) : []),
      ],
      default: "active",
    },
    empty: { title: "No flags", description: "Nothing matches this filter.", icon: Icons.flag },
    status: () => summary,
    async *items({ preferences, filter, signal }) {
      summary = "";
      const all = accounts(preferences as Prefs);
      if (!all.length) {
        yield [setupItem()];
        return;
      }
      const picked = all.filter((a) => a.provider === filter);
      const shown = picked.length ? picked : all;
      const multi = new Set(shown.map((a) => a.provider)).size > 1;
      const flags: { a: Account; f: Flag }[] = [];
      const errors: Item[] = [];
      const render = () => {
        const byFlag = new Map(flags.map((x) => [x.f, x.a]));
        const visible = flags.map((x) => x.f).filter((f) => filter === "archived" ? f.archived : !f.archived);
        return [...errors, ...sortFlags(visible).map((f) => flagItem(byFlag.get(f)!, f, multi))];
      };
      const pending = new Map<Provider, Promise<Provider>>();
      for (const a of shown) {
        if (a instanceof SetupError) {
          errors.push(errorItem(a.provider, a));
          continue;
        }
        pending.set(
          a.provider,
          loadFlags(a, signal).then(
            (found) => void flags.push(...found.map((f) => ({ a, f }))),
            (err) => {
              if (signal.aborted) throw err;
              errors.push(errorItem(a.provider, err));
            },
          ).then(() => a.provider),
        );
      }
      if (!pending.size) yield render();
      while (pending.size) {
        pending.delete(await Promise.race(pending.values()));
        const active = flags.filter((x) => !x.f.archived).length;
        summary = [`${active} flag${active === 1 ? "" : "s"}`, pending.size ? "loading…" : ""].filter(Boolean).join(
          " · ",
        );
        yield render();
      }
    },
  });
};
