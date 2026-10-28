import { action, copy, detail, Icons, type Item, list, meta, type Metadata, open, refresh } from "@backslash/api";
import { consoleHome, KIND_NAMES, maskKey, type Profile, type ProfileKind } from "../lib.ts";
import {
  aws,
  awsArgv,
  awsMissing,
  errorItem,
  inTerminal,
  isMissing,
  noProfiles,
  type Prefs,
  session,
  showProfile,
  useProfile,
} from "../aws.ts";

const KIND_ICONS: Record<ProfileKind, string> = {
  sso: Icons.shield,
  role: Icons.person,
  keys: Icons.key,
  process: Icons.terminal,
  "web-identity": Icons.globe,
  other: Icons.settings,
};

const ORIGIN = {
  backslash: "Picked in Backslash",
  env: "From $AWS_PROFILE",
  default: "Default profile",
};

const EXPLAIN = [
  "Backslash cannot change the environment of shells that are already open.",
  "**Use This Profile** makes this extension's commands (EC2, S3, CloudWatch) run with `--profile`;",
  "for your terminals, copy the `export AWS_PROFILE=…` line.",
].join(" ");

async function whoAmI(p: Profile, prefs: Prefs) {
  const region = p.region ?? "us-east-1";
  let markdown: string;
  let metadata: Metadata[] = [];
  try {
    const id = JSON.parse(await aws(["sts", "get-caller-identity"], { profile: p.name, region })) as {
      Account: string;
      Arn: string;
      UserId: string;
    };
    markdown = `## ${id.Arn.split("/").slice(1).join("/") || id.Arn}\n\n\`${id.Arn}\``;
    metadata = [
      meta.text("Account", id.Account, { icon: Icons.home }),
      meta.text("User ID", id.UserId, { icon: Icons.person }),
      meta.text("Profile", p.name, { icon: Icons.key }),
    ];
    return detail({
      title: `Who am I · ${p.name}`,
      markdown,
      metadata,
      actions: [copy(id.Account, "Copy Account ID"), copy(id.Arn, "Copy ARN")],
    });
  } catch (err) {
    const item = errorItem(err, { profiles: [p], profile: p.name, origin: "default", regions: [region] }, prefs);
    return detail({
      title: item.title,
      markdown: `## ${item.title}\n\n${item.detail?.markdown ?? ""}`,
      actions: item.actions,
    });
  }
}

function item(p: Profile, current: boolean, origin: keyof typeof ORIGIN, prefs: Prefs): Item {
  const lines: Metadata[] = [
    meta.text("Credentials", KIND_NAMES[p.kind], { icon: KIND_ICONS[p.kind] }),
    ...(p.region ? [meta.text("Region", p.region, { icon: Icons.globe })] : []),
    ...(p.ssoAccountId ? [meta.text("Account", p.ssoAccountId, { icon: Icons.home })] : []),
    ...(p.ssoRoleName ? [meta.text("Role", p.ssoRoleName, { icon: Icons.person })] : []),
    ...(p.ssoStartUrl ? [meta.link("SSO portal", new URL(p.ssoStartUrl).host, p.ssoStartUrl)] : []),
    ...(p.ssoSession ? [meta.text("SSO session", p.ssoSession)] : []),
    ...(p.roleArn ? [meta.text("Role ARN", p.roleArn, { icon: Icons.person })] : []),
    ...(p.sourceProfile ? [meta.text("Source profile", p.sourceProfile)] : []),
    ...(p.accessKeyId
      ? [
        meta.text("Access key", maskKey(p.accessKeyId), { icon: Icons.key, color: p.temporary ? "yellow" : undefined }),
      ]
      : []),
    ...(p.output ? [meta.text("Output", p.output)] : []),
    meta.separator(),
    meta.tags("Defined in", p.files.map((f) => `~/.aws/${f}`)),
    ...(current ? [meta.text("Status", ORIGIN[origin], { icon: Icons.check, color: "green" })] : []),
  ];
  const region = p.region ?? "us-east-1";
  return {
    id: p.name,
    title: p.name,
    subtitle: [KIND_NAMES[p.kind], p.ssoAccountId ?? p.roleArn?.split(":")[4]].filter(Boolean).join(" · "),
    icon: { source: current ? Icons.check : KIND_ICONS[p.kind], tint: current ? "green" : "orange" },
    section: current ? "Current Profile" : "Profiles",
    keywords: [p.kind, p.region ?? "", p.ssoAccountId ?? "", p.ssoRoleName ?? "", p.roleArn ?? ""],
    accessories: [
      ...(p.region ? [{ icon: Icons.globe, text: p.region, tooltip: "Region" }] : []),
      ...(current ? [{ tag: origin === "backslash" ? "In use" : "Current", color: "green" as const }] : []),
    ],
    detail: { markdown: current ? EXPLAIN : undefined, metadata: lines },
    actions: [
      ...(current && origin === "backslash" ? [] : [action("Use This Profile", async () => {
        await useProfile(p.name);
        return refresh();
      }, { icon: Icons.arrowRight })]),
      action("Who Am I", () => whoAmI(p, prefs), { icon: Icons.person, shortcut: "<Ctrl>i" }),
      ...(p.kind === "sso"
        ? [inTerminal("Sign In with aws sso login", awsArgv(["sso", "login"], p.name), prefs, {
          icon: Icons.key,
          shortcut: "<Ctrl>l",
          hold: true,
        })]
        : []),
      open(consoleHome(region), "Open AWS Console", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      copy(`export AWS_PROFILE=${p.name}`, "Copy export AWS_PROFILE", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(p.name, "Copy Profile Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(p.ssoAccountId ? [copy(p.ssoAccountId, "Copy Account ID", { section: "Copy" })] : []),
      ...(p.roleArn ? [copy(p.roleArn, "Copy Role ARN", { section: "Copy" })] : []),
    ],
  };
}

export default list({
  placeholder: "Switch AWS profile…",
  empty: { title: "No profiles", description: "Run aws configure sso or aws configure", icon: Icons.key },
  status: (items) => {
    const n = items.filter((i) => !["missing", "no-profile"].includes(i.id ?? "")).length;
    return n ? `${n} profile${n === 1 ? "" : "s"} · ~/.aws/config` : "";
  },
  async items({ preferences }) {
    const prefs = preferences as Prefs;
    const s = await session(prefs);
    await showProfile(s);
    if (!s.profiles.length) {
      try {
        await aws(["--version"], { json: false });
      } catch (err) {
        if (isMissing(err)) return [await awsMissing()];
      }
      return [noProfiles(prefs)];
    }
    return s.profiles
      .map((p) => item(p, p.name === s.profile, s.origin, prefs))
      .sort((a, b) => Number(b.section === "Current Profile") - Number(a.section === "Current Profile"));
  },
});
