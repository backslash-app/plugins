// Pure logic of the AWS extension: ~/.aws parsers, aws CLI output mapping,
// console URLs, error classification and formatting. No I/O here.

// --- ~/.aws/config and ~/.aws/credentials ------------------------------------------

export type Ini = Map<string, Record<string, string>>;

export function parseIni(text: string): Ini {
  const out: Ini = new Map();
  let cur: Record<string, string> | undefined;
  let lastKey = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const head = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
    if (head) {
      cur = out.get(head[1]) ?? {};
      out.set(head[1], cur);
      continue;
    }
    if (!cur) continue;
    // Indented lines continue a nested value (`s3 =` then `  max_concurrent_requests = 20`).
    if (/^\s/.test(line) && lastKey) {
      cur[lastKey] = `${cur[lastKey]}\n${trimmed}`.trim();
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    lastKey = trimmed.slice(0, eq).trim().toLowerCase();
    cur[lastKey] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export type ProfileKind = "sso" | "role" | "keys" | "process" | "web-identity" | "other";

export interface Profile {
  name: string;
  kind: ProfileKind;
  region?: string;
  output?: string;
  ssoStartUrl?: string;
  ssoSession?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
  roleArn?: string;
  sourceProfile?: string;
  /** Static access key id, never the secret. */
  accessKeyId?: string;
  /** Static keys with a session token (temporary credentials). */
  temporary?: boolean;
  /** Where the profile was found. */
  files: ("config" | "credentials")[];
}

export function parseProfiles(configText: string, credentialsText: string): Profile[] {
  const config = parseIni(configText);
  const creds = parseIni(credentialsText);
  const byName = new Map<string, { config?: Record<string, string>; creds?: Record<string, string> }>();
  for (const [section, values] of config) {
    const name = section === "default" ? "default" : /^profile\s+(.+)$/.exec(section)?.[1]?.trim();
    if (!name) continue; // [sso-session x], [services x]…
    byName.set(name, { ...byName.get(name), config: values });
  }
  for (const [name, values] of creds) byName.set(name, { ...byName.get(name), creds: values });
  const sessions = new Map<string, Record<string, string>>();
  for (const [section, values] of config) {
    const m = /^sso-session\s+(.+)$/.exec(section);
    if (m) sessions.set(m[1].trim(), values);
  }
  const out: Profile[] = [];
  for (const [name, { config: c = {}, creds: k = {} }] of byName) {
    const all = { ...k, ...c };
    const session = c.sso_session ? sessions.get(c.sso_session) : undefined;
    const kind: ProfileKind = c.sso_session || c.sso_start_url
      ? "sso"
      : all.role_arn && all.web_identity_token_file
      ? "web-identity"
      : all.role_arn
      ? "role"
      : all.credential_process
      ? "process"
      : all.aws_access_key_id
      ? "keys"
      : "other";
    out.push({
      name,
      kind,
      region: all.region || session?.sso_region || undefined,
      output: all.output || undefined,
      ssoStartUrl: c.sso_start_url || session?.sso_start_url || undefined,
      ssoSession: c.sso_session || undefined,
      ssoAccountId: c.sso_account_id || undefined,
      ssoRoleName: c.sso_role_name || undefined,
      roleArn: all.role_arn || undefined,
      sourceProfile: all.source_profile || undefined,
      accessKeyId: all.aws_access_key_id || undefined,
      temporary: !!all.aws_session_token,
      files: [
        ...(byName.get(name)?.config ? ["config" as const] : []),
        ...(k.aws_access_key_id ? ["credentials" as const] : []),
      ],
    });
  }
  return out.sort((a, b) =>
    Number(b.name === "default") - Number(a.name === "default") || a.name.localeCompare(b.name)
  );
}

export const KIND_NAMES: Record<ProfileKind, string> = {
  sso: "IAM Identity Center (SSO)",
  role: "Assumed role",
  keys: "Access keys",
  process: "Credential process",
  "web-identity": "Web identity",
  other: "Settings only",
};

/** `AKIAIOSFODNN7EXAMPLE` → `AKIA…MPLE`. */
export const maskKey = (id: string) => id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "****";

/** The profile used: picked in Backslash, then `$AWS_PROFILE`, then `default`, then the first. */
export function activeProfile(profiles: Profile[], picked?: string, env?: string): string | undefined {
  for (const name of [picked, env]) if (name && profiles.some((p) => p.name === name)) return name;
  if (profiles.some((p) => p.name === "default")) return "default";
  return env || profiles[0]?.name;
}

/** The regions to query: the preference (comma or space separated), else the profile's, else us-east-1. */
export function regionsFor(pref: unknown, profileRegion?: string, envRegion?: string): string[] {
  const listed = String(pref ?? "").split(/[\s,]+/).map((r) => r.trim().toLowerCase()).filter((r) =>
    /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(r)
  );
  if (listed.length) return [...new Set(listed)];
  return [profileRegion || envRegion || "us-east-1"];
}

// --- EC2 ---------------------------------------------------------------------------

export type InstanceState = "pending" | "running" | "shutting-down" | "terminated" | "stopping" | "stopped";

export interface Instance {
  id: string;
  name?: string;
  state: InstanceState;
  type: string;
  region: string;
  zone?: string;
  privateIp?: string;
  publicIp?: string;
  publicDns?: string;
  imageId?: string;
  keyName?: string;
  vpcId?: string;
  subnetId?: string;
  platform: string;
  architecture?: string;
  launched?: Date;
  securityGroups: string[];
  tags: Record<string, string>;
  iamProfile?: string;
  stateReason?: string;
}

export function parseInstances(json: string, region: string): Instance[] {
  const data = JSON.parse(json || "{}") as { Reservations?: { Instances?: any[] }[] };
  const out: Instance[] = [];
  for (const r of data.Reservations ?? []) {
    for (const i of r.Instances ?? []) {
      const tags = Object.fromEntries(
        ((i.Tags ?? []) as { Key: string; Value: string }[]).map((t) => [t.Key, t.Value]),
      );
      out.push({
        id: i.InstanceId,
        name: tags.Name || undefined,
        state: (i.State?.Name ?? "pending") as InstanceState,
        type: i.InstanceType ?? "",
        region,
        zone: i.Placement?.AvailabilityZone,
        privateIp: i.PrivateIpAddress || undefined,
        publicIp: i.PublicIpAddress || undefined,
        publicDns: i.PublicDnsName || undefined,
        imageId: i.ImageId,
        keyName: i.KeyName,
        vpcId: i.VpcId,
        subnetId: i.SubnetId,
        platform: i.PlatformDetails ?? (i.Platform === "windows" ? "Windows" : "Linux/UNIX"),
        architecture: i.Architecture,
        launched: i.LaunchTime ? new Date(i.LaunchTime) : undefined,
        securityGroups: ((i.SecurityGroups ?? []) as { GroupName: string }[]).map((g) => g.GroupName),
        tags,
        iamProfile: i.IamInstanceProfile?.Arn?.split("/").pop(),
        stateReason: i.StateTransitionReason || undefined,
      });
    }
  }
  return out;
}

export const STATE_COLORS = {
  running: "green",
  pending: "yellow",
  stopping: "orange",
  "shutting-down": "orange",
  stopped: "gray",
  terminated: "red",
} as const;

const STATE_ORDER: InstanceState[] = ["running", "pending", "stopping", "shutting-down", "stopped", "terminated"];

export function sortInstances(all: Instance[]): Instance[] {
  return [...all].sort((a, b) =>
    STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
    (a.name ?? a.id).localeCompare(b.name ?? b.id)
  );
}

export type InstanceFilter = "running" | "stopped" | "all";

export function filterInstances(all: Instance[], filter: InstanceFilter): Instance[] {
  if (filter === "running") return all.filter((i) => i.state === "running" || i.state === "pending");
  if (filter === "stopped") return all.filter((i) => i.state === "stopped" || i.state === "stopping");
  return all;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

// --- S3 ----------------------------------------------------------------------------

export interface Bucket {
  name: string;
  created?: Date;
  region?: string;
}

export function parseBuckets(json: string): Bucket[] {
  const data = JSON.parse(json || "{}") as {
    Buckets?: { Name: string; CreationDate?: string; BucketRegion?: string }[];
  };
  return (data.Buckets ?? []).map((b) => ({
    name: b.Name,
    created: b.CreationDate ? new Date(b.CreationDate) : undefined,
    region: b.BucketRegion || undefined,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface S3Entry {
  key: string;
  folder: boolean;
  size?: number;
  modified?: Date;
  storageClass?: string;
}

export function parseObjects(json: string): S3Entry[] {
  const data = JSON.parse(json || "{}") as {
    CommonPrefixes?: { Prefix: string }[];
    Contents?: { Key: string; Size?: number; LastModified?: string; StorageClass?: string }[];
  };
  return [
    ...(data.CommonPrefixes ?? []).map((p) => ({ key: p.Prefix, folder: true })),
    ...(data.Contents ?? []).filter((o) => !o.Key.endsWith("/")).map((o) => ({
      key: o.Key,
      folder: false,
      size: o.Size,
      modified: o.LastModified ? new Date(o.LastModified) : undefined,
      storageClass: o.StorageClass,
    })),
  ];
}

/** `logs/2026/app.log` under `logs/` → `2026/app.log`. */
export const relativeKey = (key: string, prefix: string) => key.startsWith(prefix) ? key.slice(prefix.length) : key;

// --- CloudWatch Logs -----------------------------------------------------------------

export interface LogGroup {
  name: string;
  region: string;
  storedBytes: number;
  retentionDays?: number;
  created?: Date;
  className?: string;
  arn?: string;
}

export function parseLogGroups(json: string, region: string): LogGroup[] {
  const data = JSON.parse(json || "{}") as { logGroups?: any[] };
  return (data.logGroups ?? []).map((g) => ({
    name: g.logGroupName,
    region,
    storedBytes: g.storedBytes ?? 0,
    retentionDays: g.retentionInDays,
    created: g.creationTime ? new Date(g.creationTime) : undefined,
    className: g.logGroupClass,
    arn: g.logGroupArn ?? g.arn?.replace(/:\*$/, ""),
  }));
}

/** `/aws/lambda/checkout` → `Lambda`; the kind of resource writing the group. */
export function logSource(name: string): string {
  const m = /^\/aws\/([^/]+)/.exec(name);
  if (!m) return "Custom";
  const known: Record<string, string> = {
    lambda: "Lambda",
    ecs: "ECS",
    eks: "EKS",
    rds: "RDS",
    apigateway: "API Gateway",
    codebuild: "CodeBuild",
    "vendedlogs": "Vended",
    events: "EventBridge",
    "api-gateway": "API Gateway",
  };
  return known[m[1]] ?? m[1];
}

// --- Console URLs ---------------------------------------------------------------------

export const ec2ConsoleUrl = (i: Instance) =>
  `https://${i.region}.console.aws.amazon.com/ec2/home?region=${i.region}#InstanceDetails:instanceId=${i.id}`;

export const s3ConsoleUrl = (bucket: string, prefix = "", region?: string) =>
  `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(bucket)}?${
    region ? `region=${region}&` : ""
  }prefix=${encodeURIComponent(prefix)}&showversions=false`;

/** The CloudWatch console escapes the group name twice, with `$` for `%`. */
export const logGroupConsoleUrl = (g: { name: string; region: string }) =>
  `https://${g.region}.console.aws.amazon.com/cloudwatch/home?region=${g.region}#logsV2:log-groups/log-group/${
    encodeURIComponent(encodeURIComponent(g.name)).replace(/%/g, "$")
  }`;

export const consoleHome = (region: string) => `https://${region}.console.aws.amazon.com/console/home?region=${region}`;

// --- Errors ---------------------------------------------------------------------------

export type Problem = "credentials" | "expired" | "denied" | "network" | "profile" | "plugin" | "other";

export interface Classified {
  problem: Problem;
  title: string;
  message: string;
}

export function classifyError(err: unknown): Classified {
  const message = (err instanceof Error ? err.message : String(err)).replace(/^aws exited with \d+: /, "").trim();
  const is = (re: RegExp) => re.test(message);
  if (is(/SessionManagerPlugin is not found|session-manager-plugin/i)) {
    return { problem: "plugin", title: "The Session Manager plugin is missing", message };
  }
  if (
    is(
      /Token has expired|SSO session .*expired|ExpiredToken|Error loading SSO Token|token .* expired|refresh failed|UnauthorizedSSOToken/i,
    )
  ) {
    return { problem: "expired", title: "Session expired", message };
  }
  if (is(/Unable to locate credentials|NoCredentialProviders|You must specify a region|partial credentials/i)) {
    return { problem: "credentials", title: "No credentials for this profile", message };
  }
  if (is(/config profile \(.+\) could not be found/i)) {
    return { problem: "profile", title: "Profile not found", message };
  }
  if (is(/InvalidClientTokenId|SignatureDoesNotMatch|AuthFailure|security token included in the request is invalid/i)) {
    return { problem: "credentials", title: "AWS rejected the credentials", message };
  }
  if (is(/UnauthorizedOperation|AccessDenied|not authorized to perform/i)) {
    return { problem: "denied", title: "Access denied", message };
  }
  if (
    is(
      /Could not connect to the endpoint|Connect timeout|Read timeout|Name or service not known|EndpointConnectionError/i,
    )
  ) {
    return { problem: "network", title: "Cannot reach AWS", message };
  }
  return { problem: "other", title: "The aws command failed", message };
}

// --- Formatting -------------------------------------------------------------------------

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function age(date: Date | undefined, now = new Date()): string {
  if (!date || isNaN(date.getTime())) return "";
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (d?: Date) =>
  d && !isNaN(d.getTime()) ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

// --- Installing the CLI ------------------------------------------------------------------

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export function installCommand(family: Family | undefined): string {
  switch (family) {
    case "arch":
      return "sudo pacman -S aws-cli-v2";
    case "fedora":
      return "sudo dnf install awscli2";
    case "suse":
      return "sudo zypper install aws-cli";
    default:
      return "sudo snap install aws-cli --classic";
  }
}
