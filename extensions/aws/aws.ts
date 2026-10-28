// Calling the aws CLI with the profile picked in Backslash, and the items
// every command shares (missing CLI, errors, profile switching).

import {
  type Action,
  action,
  close,
  copy,
  exec,
  Icons,
  type Item,
  open,
  refresh,
  storage,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  activeProfile,
  classifyError,
  installCommand,
  osFamily,
  parseProfiles,
  type Profile,
  regionsFor,
} from "./lib.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export interface Prefs {
  regions?: string;
  terminal?: string;
}

const HOME = Deno.env.get("HOME") ?? "";
const read = (path: string) => Deno.readTextFile(path).catch(() => "");

export interface Session {
  profiles: Profile[];
  /** The profile commands run with; undefined when there is no config at all. */
  profile?: string;
  /** Where the choice came from. */
  origin: "backslash" | "env" | "default";
  regions: string[];
}

export async function session(prefs: Prefs): Promise<Session> {
  const [config, credentials, picked] = await Promise.all([
    read(`${HOME}/.aws/config`),
    read(`${HOME}/.aws/credentials`),
    storage.get<string>("profile").catch(() => undefined),
  ]);
  const profiles = parseProfiles(config, credentials);
  const env = Deno.env.get("AWS_PROFILE") || undefined;
  const profile = activeProfile(profiles, picked ?? undefined, env);
  const origin = picked && profile === picked ? "backslash" : env && profile === env ? "env" : "default";
  const current = profiles.find((p) => p.name === profile);
  const envRegion = Deno.env.get("AWS_REGION") || Deno.env.get("AWS_DEFAULT_REGION") || undefined;
  return { profiles, profile, origin, regions: regionsFor(prefs.regions, current?.region, envRegion) };
}

/** Runs `aws` with the profile and region, JSON output and no pager. */
export function aws(
  args: string[],
  o: { profile?: string; region?: string; signal?: AbortSignal; json?: boolean } = {},
): Promise<string> {
  return exec("aws", [
    ...args,
    ...(o.profile ? ["--profile", o.profile] : []),
    ...(o.region ? ["--region", o.region] : []),
    ...(o.json === false ? [] : ["--output", "json"]),
    "--no-cli-pager",
  ], { signal: o.signal });
}

/** The same command line, for terminals and "Copy Command". */
export const awsArgv = (args: string[], profile?: string, region?: string) => [
  "aws",
  ...args,
  ...(profile ? ["--profile", profile] : []),
  ...(region ? ["--region", region] : []),
];

export const isMissing = (err: unknown) => err instanceof Deno.errors.NotFound;

export async function useProfile(name: string) {
  await storage.set("profile", name);
  await toast(`Backslash now uses ${name}`, {
    style: "success",
    message: "Your shells keep their own AWS_PROFILE",
  });
}

export async function showProfile(s: Session, extra?: string) {
  await updateCommandMetadata({
    subtitle: s.profile ? [s.profile, s.regions.join(", "), extra].filter(Boolean).join(" · ") : null,
  }).catch(() => {});
}

export function inTerminal(
  title: string,
  argv: string[],
  prefs: Prefs,
  o: { icon?: string; shortcut?: string; section?: string; hold?: boolean } = {},
): Action {
  return action(title, () => {
    const term = runInTerminal(o.hold ? holdOpen(argv) : argv, prefs.terminal || undefined);
    return close(`Opened in ${term}`);
  }, { icon: Icons.terminal, shortcut: o.shortcut, section: o.section ?? "Terminal" });
}

/** "Switch Profile ›", loaded when opened. */
export function profileActions(prefs: Prefs): Action[] {
  return [
    submenu("Switch Profile", async () => {
      const s = await session(prefs);
      return s.profiles.map((p) =>
        action(p.name, async () => {
          await useProfile(p.name);
          return refresh();
        }, { icon: p.name === s.profile ? Icons.check : Icons.person })
      );
    }, { icon: Icons.person, shortcut: "<Ctrl><Shift>p", section: "Profile" }),
  ];
}

let family: Promise<string> | undefined;
export const installHint = () => (family ??= read("/etc/os-release").then((t) => installCommand(osFamily(t))));

export async function awsMissing(): Promise<Item> {
  const cmd = await installHint();
  return {
    id: "missing",
    title: "The AWS CLI is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs the **aws** command (AWS CLI v2) with your `~/.aws/config` profiles.",
        "",
        "```sh",
        cmd,
        "aws configure sso      # or: aws configure",
        "```",
        "",
        "SSM sessions also need the **Session Manager plugin**.",
      ].join("\n"),
    },
    actions: [
      copy(cmd, "Copy Install Command", { icon: Icons.terminal }),
      open(
        "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
        "Open Install Guide",
      ),
    ],
  };
}

export function noProfiles(prefs: Prefs): Item {
  return {
    id: "no-profile",
    title: "No AWS profile yet",
    subtitle: "Configure one with aws configure sso or aws configure",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "No profile in `~/.aws/config` or `~/.aws/credentials`.",
        "",
        "- **IAM Identity Center (SSO)**: `aws configure sso`",
        "- **Access keys**: `aws configure`",
      ].join("\n"),
    },
    actions: [
      inTerminal("Run aws configure sso", ["aws", "configure", "sso"], prefs, { section: "Setup" }),
      inTerminal("Run aws configure", ["aws", "configure"], prefs, { section: "Setup" }),
    ],
  };
}

/** An error as an item, with the way out (SSO login, configure, switch profile). */
export function errorItem(err: unknown, s: Session, prefs: Prefs, region?: string): Item {
  const e = classifyError(err);
  const p = s.profile;
  const fixes: Action[] = [];
  if (
    e.problem === "expired" || (e.problem === "credentials" && s.profiles.find((x) => x.name === p)?.kind === "sso")
  ) {
    fixes.push(inTerminal("Sign In with aws sso login", awsArgv(["sso", "login"], p), prefs, {
      icon: Icons.key,
      section: "Fix",
      hold: true,
    }));
  } else if (e.problem === "credentials") {
    fixes.push(inTerminal("Run aws configure", awsArgv(["configure"], p), prefs, { icon: Icons.key, section: "Fix" }));
  }
  return {
    id: `error:${region ?? ""}`,
    title: e.title,
    subtitle: [p, region].filter(Boolean).join(" · "),
    icon: { source: Icons.alert, tint: e.problem === "denied" ? "orange" : "red" },
    section: region ? `Errors` : undefined,
    detail: { markdown: `\`\`\`\n${e.message}\n\`\`\`` },
    actions: [
      ...fixes,
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...profileActions(prefs),
      copy(e.message, "Copy Error", { section: "Copy" }),
    ],
  };
}

/** Runs one call per region in parallel; failed regions become error items. */
export async function perRegion<T>(
  s: Session,
  prefs: Prefs,
  load: (region: string) => Promise<T[]>,
): Promise<{ results: T[]; errors: Item[] }> {
  const settled = await Promise.allSettled(s.regions.map(load));
  const results: T[] = [];
  const errors: Item[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") results.push(...r.value);
    else if (isMissing(r.reason)) throw r.reason;
    else errors.push(errorItem(r.reason, s, prefs, s.regions[i]));
  });
  // The same problem in every region (expired SSO…) is shown once.
  const unique = errors.filter((e, i) => errors.findIndex((x) => x.title === e.title) === i);
  return { results, errors: unique };
}
