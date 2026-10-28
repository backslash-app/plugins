// ufw and firewalld outputs, and the commands that change them. No I/O here.

// ---------------------------------------------------------------------------
// Shell

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** A command line as a shell would read it back. */
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

// ---------------------------------------------------------------------------
// ufw configuration files (readable without root)

export type Policy = "allow" | "deny" | "reject";

export interface UfwConfig {
  enabled: boolean;
  logLevel?: string;
  incoming?: Policy;
  outgoing?: Policy;
  routed?: Policy;
}

const shellVars = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/^\s*([A-Z_]+)\s*=\s*"?([^"\n#]*)"?/gm)].map((m) => [m[1], m[2].trim()]),
  );

const policy = (v: string | undefined): Policy | undefined =>
  v === "DROP" ? "deny" : v === "ACCEPT" ? "allow" : v === "REJECT" ? "reject" : undefined;

/** /etc/ufw/ufw.conf and /etc/default/ufw. */
export function parseUfwConfig(ufwConf: string, defaults: string): UfwConfig {
  const conf = shellVars(ufwConf), def = shellVars(defaults);
  return {
    enabled: /^yes$/i.test(conf.ENABLED ?? ""),
    logLevel: conf.LOGLEVEL || undefined,
    incoming: policy(def.DEFAULT_INPUT_POLICY),
    outgoing: policy(def.DEFAULT_OUTPUT_POLICY),
    routed: policy(def.DEFAULT_FORWARD_POLICY),
  };
}

// ---------------------------------------------------------------------------
// ufw status (root)

export interface UfwStatus {
  active: boolean;
  logging?: string;
  incoming?: string;
  outgoing?: string;
  routed?: string;
  newProfiles?: string;
}

/** `ufw status verbose`. */
export function parseUfwVerbose(out: string): UfwStatus {
  const line = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(out)?.[1]?.trim();
  const defaults = line("Default") ?? "";
  const pick = (dir: string) => new RegExp(`(\\w+) \\(${dir}\\)`).exec(defaults)?.[1];
  return {
    active: line("Status") === "active",
    logging: line("Logging"),
    incoming: pick("incoming"),
    outgoing: pick("outgoing"),
    routed: pick("routed"),
    newProfiles: line("New profiles"),
  };
}

export type RuleAction = "ALLOW" | "DENY" | "REJECT" | "LIMIT";

export interface UfwRule {
  /** `ufw status numbered`'s number, for `ufw delete N`; undefined when ufw is inactive. */
  number?: number;
  to: string;
  action: RuleAction;
  direction: "IN" | "OUT" | "FWD";
  from: string;
  v6: boolean;
  comment?: string;
  log?: boolean;
  /** The rule as `ufw show added` prints it, without `ufw`. */
  spec?: string;
}

const RULE = /^(.*?)\s+(ALLOW|DENY|REJECT|LIMIT)(?: (IN|OUT|FWD))?(?: \((log|log-all)\))?\s+(.*?)(?:\s+#\s?(.*))?$/;

/** `ufw status numbered` (or plain `ufw status`, without numbers). */
export function parseUfwNumbered(out: string): UfwRule[] {
  const rules: UfwRule[] = [];
  for (const raw of out.split("\n")) {
    const numbered = /^\[\s*(\d+)\]\s(.*)$/.exec(raw);
    const body = (numbered ? numbered[2] : raw).trimEnd();
    if (!numbered && (!body || /^(Status|To\s|--|Logging|Default|New profiles)/.test(body.trim()))) continue;
    const m = RULE.exec(body.trim());
    if (!m) continue;
    const [, to, action, direction, log, from, comment] = m;
    const v6 = /\(v6\)/.test(to) || /\(v6\)/.test(from);
    rules.push({
      number: numbered ? Number(numbered[1]) : undefined,
      to: to.replace(/\s*\(v6\)/, "").trim(),
      action: action as RuleAction,
      direction: (direction ?? "IN") as UfwRule["direction"],
      from: from.replace(/\s*\(v6\)/, "").replace(/\s*\(out\)$/, "").replace(/\s{2,}/g, " ").trim(),
      v6,
      comment: comment?.trim() || undefined,
      log: log ? true : undefined,
    });
  }
  return rules;
}

/** `ufw show added`: the rules as commands, also while ufw is inactive. */
export function parseUfwAdded(out: string): UfwRule[] {
  const rules: UfwRule[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("ufw ")) continue;
    const spec = line.slice(4);
    const words = spec.replace(/\s+comment\s+'.*'$/, "").split(/\s+/);
    const comment = /comment\s+'(.*)'$/.exec(spec)?.[1];
    const actionWord = words.find((w) => /^(allow|deny|reject|limit)$/.test(w)) ?? "allow";
    const direction = words.includes("out") ? "OUT" : "IN";
    const at = (k: string) => {
      const i = words.indexOf(k);
      return i >= 0 ? words[i + 1] : undefined;
    };
    const proto = at("proto");
    const port = at("port") ?? at("app");
    const simple = words[words.indexOf(actionWord) + 1];
    const to = port
      ? `${port}${proto ? `/${proto}` : ""}`
      : simple && !["from", "to", "in", "out", "proto"].includes(simple)
      ? simple
      : (at("to") && at("to") !== "any" ? at("to")! : "Anywhere");
    const from = at("from");
    rules.push({
      to,
      action: actionWord.toUpperCase() as RuleAction,
      direction,
      from: !from || from === "any" ? "Anywhere" : from,
      v6: false,
      comment,
      spec,
    });
  }
  return rules;
}

/** The three outputs of {@link UFW_STATUS_SCRIPT}, split on its markers. */
export const UFW_MARK = "@@backslash@@";
export const UFW_STATUS_SCRIPT =
  `ufw status verbose; echo ${UFW_MARK}; ufw status numbered; echo ${UFW_MARK}; ufw show added`;

export interface UfwSnapshot {
  status: UfwStatus;
  rules: UfwRule[];
}

export function parseUfwScript(out: string): UfwSnapshot {
  const [verbose = "", numbered = "", added = ""] = out.split(UFW_MARK);
  const status = parseUfwVerbose(verbose);
  return { status, rules: status.active ? parseUfwNumbered(numbered) : parseUfwAdded(added) };
}

// ---------------------------------------------------------------------------
// firewalld

export interface Zone {
  name: string;
  active: boolean;
  default: boolean;
  target?: string;
  interfaces: string[];
  sources: string[];
  services: string[];
  ports: string[];
  protocols: string[];
  forward?: boolean;
  masquerade?: boolean;
  forwardPorts: string[];
  sourcePorts: string[];
  icmpBlocks: string[];
  richRules: string[];
}

/** `firewall-cmd --list-all-zones` (or `--list-all`): blocks of `key: value` lines. */
export function parseZones(out: string): Zone[] {
  const zones: Zone[] = [];
  let zone: Zone | undefined;
  let inRich = false;
  for (const raw of out.split("\n")) {
    if (!raw.trim()) {
      inRich = false;
      continue;
    }
    const head = /^(\S+)(?:\s+\(([^)]*)\))?\s*$/.exec(raw);
    if (head && !raw.startsWith(" ") && !raw.startsWith("\t")) {
      const flags = (head[2] ?? "").split(/,\s*/);
      zone = {
        name: head[1],
        active: flags.includes("active"),
        default: flags.includes("default"),
        interfaces: [],
        sources: [],
        services: [],
        ports: [],
        protocols: [],
        forwardPorts: [],
        sourcePorts: [],
        icmpBlocks: [],
        richRules: [],
      };
      zones.push(zone);
      inRich = false;
      continue;
    }
    if (!zone) continue;
    const kv = /^\s+([a-z -]+):\s?(.*)$/.exec(raw);
    if (kv && !(inRich && raw.startsWith("\t"))) {
      const key = kv[1].trim(), value = kv[2].trim();
      const list = value ? value.split(/\s+/) : [];
      inRich = key === "rich rules";
      switch (key) {
        case "target":
          zone.target = value;
          break;
        case "interfaces":
          zone.interfaces = list;
          break;
        case "sources":
          zone.sources = list;
          break;
        case "services":
          zone.services = list;
          break;
        case "ports":
          zone.ports = list;
          break;
        case "protocols":
          zone.protocols = list;
          break;
        case "forward":
          zone.forward = value === "yes";
          break;
        case "masquerade":
          zone.masquerade = value === "yes";
          break;
        case "forward-ports":
          zone.forwardPorts = value ? [value] : [];
          break;
        case "source-ports":
          zone.sourcePorts = list;
          break;
        case "icmp-blocks":
          zone.icmpBlocks = list;
          break;
        case "rich rules":
          if (value) zone.richRules.push(value);
          break;
      }
      continue;
    }
    const cont = raw.trim();
    if (inRich) zone.richRules.push(cont);
    else if (zone.forwardPorts.length && /^port=/.test(cont)) zone.forwardPorts.push(cont);
  }
  return zones;
}

/** Active zones first (the default one on top), then the others by name. */
export function sortZones(zones: Zone[]): Zone[] {
  return [...zones].sort((a, b) =>
    Number(b.default) - Number(a.default) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)
  );
}

/** A readable line for a rich rule: `Allow 22/tcp from 192.168.1.0/24`. */
export function describeRich(rule: string): { action: string; port?: string; service?: string; from?: string } {
  const attr = (re: RegExp) => re.exec(rule)?.[1];
  const action = attr(/\b(accept|reject|drop|mark)\b(?!=)/) ?? "accept";
  const port = attr(/\bport port="([^"]+)"/);
  const proto = attr(/\bport port="[^"]+" protocol="(\w+)"/);
  return {
    action: action === "accept" ? "Allow" : action === "drop" ? "Drop" : action === "reject" ? "Reject" : "Mark",
    port: port ? `${port}${proto ? `/${proto}` : ""}` : undefined,
    service: attr(/\bservice name="([^"]+)"/),
    from: attr(/\bsource (?:NOT )?address="([^"]+)"/),
  };
}

// ---------------------------------------------------------------------------
// New rules

export type Protocol = "tcp" | "udp" | "any";

export interface RuleInput {
  action: "allow" | "deny" | "reject" | "limit";
  /** `22`, `8000:8100`, `8000-8100`, `80,443` or a service name like `ssh`. */
  port: string;
  protocol: Protocol;
  /** Empty for anywhere; an address or network. */
  from: string;
  comment?: string;
}

export function validatePort(port: string): string | undefined {
  const p = port.trim();
  if (!p) return "Enter a port, a range or a service name";
  if (/^[a-z][\w-]*$/i.test(p)) return undefined;
  const parts = p.split(",");
  for (const part of parts) {
    const m = /^(\d{1,5})(?:[:-](\d{1,5}))?$/.exec(part.trim());
    if (!m) return `“${part.trim()}” is not a port`;
    const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
    if (lo < 1 || hi > 65535 || hi < lo) return `${part.trim()} is out of the 1–65535 range`;
  }
  return undefined;
}

export const isServiceName = (port: string) => /^[a-z][\w-]*$/i.test(port.trim());

export function validateSource(from: string): string | undefined {
  const f = from.trim();
  if (!f || /^(any|anywhere)$/i.test(f)) return undefined;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(f);
  if (v4) {
    return v4.slice(1, 5).every((n) => Number(n) <= 255) && (v4[5] === undefined || Number(v4[5]) <= 32)
      ? undefined
      : `“${f}” is not an IPv4 address`;
  }
  if (/^[0-9a-f:]+(?:\/\d{1,3})?$/i.test(f) && f.includes(":")) return undefined;
  return `“${f}” is not an IP address or network (192.168.1.0/24)`;
}

const anywhere = (from: string) => !from.trim() || /^(any|anywhere)$/i.test(from.trim());

/** The arguments after `ufw` that add the rule. */
export function ufwAddArgs(r: RuleInput): string[] {
  const port = r.port.trim().replace(/-/g, ":").replace(/\s+/g, "");
  const ranged = /[:,]/.test(port);
  // ufw needs a protocol with ranges and lists.
  const proto = r.protocol === "any" && ranged ? undefined : r.protocol;
  const comment = r.comment?.trim() ? ["comment", r.comment.trim()] : [];
  if (anywhere(r.from) && !ranged) {
    return [r.action, proto && proto !== "any" ? `${port}/${proto}` : port, ...comment];
  }
  return [
    r.action,
    ...(proto && proto !== "any" ? ["proto", proto] : []),
    "from",
    anywhere(r.from) ? "any" : r.from.trim(),
    "to",
    "any",
    "port",
    port,
    ...comment,
  ];
}

/** Both protocols for ranges and lists when "any" was picked: ufw wants one. */
export function ufwAddCommands(r: RuleInput): string[][] {
  const port = r.port.trim();
  if (r.protocol === "any" && /[:,-]/.test(port) && !isServiceName(port)) {
    return [ufwAddArgs({ ...r, protocol: "tcp" }), ufwAddArgs({ ...r, protocol: "udp" })];
  }
  return [ufwAddArgs(r)];
}

/** `firewall-cmd` arguments (without `--zone`/`--permanent`) that add the rule. */
export function firewalldAddArgs(r: RuleInput): string[] {
  const port = r.port.trim().replace(/:/g, "-").replace(/\s+/g, "");
  const protos = r.protocol === "any" ? ["tcp", "udp"] : [r.protocol];
  const service = isServiceName(port);
  if (anywhere(r.from) && r.action === "allow") {
    if (service) return [`--add-service=${port}`];
    return port.split(",").flatMap((p) => protos.map((proto) => `--add-port=${p}/${proto}`));
  }
  return richRules(r).map((rule) => `--add-rich-rule=${rule}`);
}

export function richRules(r: RuleInput): string[] {
  const port = r.port.trim().replace(/:/g, "-").replace(/\s+/g, "");
  const protos = r.protocol === "any" ? ["tcp", "udp"] : [r.protocol];
  const from = r.from.trim();
  const source = anywhere(from) ? "" : ` source address="${from}"`;
  const family = anywhere(from) ? "" : ` family="${from.includes(":") ? "ipv6" : "ipv4"}"`;
  const verdict = r.action === "allow" ? "accept" : r.action === "reject" ? "reject" : "drop";
  if (isServiceName(port)) return [`rule${family}${source} service name="${port}" ${verdict}`];
  return port.split(",").flatMap((p) =>
    protos.map((proto) => `rule${family}${source} port port="${p}" protocol="${proto}" ${verdict}`)
  );
}

/** Runtime and permanent configuration, in one script for one password prompt. */
export function firewalldScript(zone: string, args: string[]): string {
  const z = `--zone=${zone}`;
  return [
    shellLine(["firewall-cmd", z, ...args]),
    shellLine(["firewall-cmd", "--permanent", z, ...args]),
  ].join(" && ");
}

/** `--add-port=…` → `--remove-port=…`. */
export const removalArgs = (kind: "port" | "service" | "rich-rule" | "source" | "interface", value: string) => [
  `--remove-${kind}=${value}`,
];

// ---------------------------------------------------------------------------
// Looks

export function ruleTitle(r: UfwRule): string {
  return r.to === "Anywhere" ? "Any port" : r.to.replace(/^Anywhere on /, "Any port on ");
}

export function ruleSentence(r: UfwRule): string {
  const verb = { ALLOW: "Allow", DENY: "Deny", REJECT: "Reject", LIMIT: "Limit" }[r.action];
  const dir = r.direction === "OUT" ? "out to" : r.direction === "FWD" ? "forwarded from" : "in from";
  return `${verb} ${dir} ${r.from === "Anywhere" ? "anywhere" : r.from}`;
}

/** The rule as a ufw command, to copy. */
export function ruleCommand(r: UfwRule): string {
  if (r.spec) return `sudo ufw ${r.spec}`;
  const action = r.action.toLowerCase();
  const out = r.direction === "OUT" ? " out" : "";
  const [port, proto] = r.to.split("/");
  if (r.from === "Anywhere" && /^[\w:,]+(\/\w+)?$/.test(r.to)) return `sudo ufw ${action}${out} ${r.to}`;
  const from = r.from === "Anywhere" ? "any" : r.from;
  return `sudo ufw ${action}${out}${proto ? ` proto ${proto}` : ""} from ${from} to any port ${port}`;
}

/** What `ufw delete` needs: the number when active, else the rule itself. */
export function ufwDeleteArgs(r: UfwRule): string[] {
  if (r.number !== undefined) return ["--force", "delete", String(r.number)];
  if (r.spec) {
    const words = r.spec.replace(/\s+comment\s+'.*'$/, "").split(/\s+/);
    return ["--force", "delete", ...words];
  }
  throw new Error("This rule can't be deleted from here");
}

/** `ID` and `ID_LIKE` of /etc/os-release. */
export function osIds(osRelease: string): string[] {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(osRelease)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  return `${get("ID")} ${get("ID_LIKE")}`.toLowerCase().split(/\s+/).filter(Boolean);
}

/** The usual firewall of the distribution, and how to install it. */
export function installHint(osRelease: string): { tool: string; command: string } {
  const ids = osIds(osRelease);
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) {
    return { tool: "firewalld", command: "sudo dnf install firewalld && sudo systemctl enable --now firewalld" };
  }
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) {
    return { tool: "firewalld", command: "sudo zypper install firewalld && sudo systemctl enable --now firewalld" };
  }
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) {
    return { tool: "ufw", command: "sudo pacman -S ufw && sudo systemctl enable --now ufw && sudo ufw enable" };
  }
  return { tool: "ufw", command: "sudo apt install ufw && sudo ufw enable" };
}

/** pkexec's exit codes when nobody authenticated. */
export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}
