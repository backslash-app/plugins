// Pure logic of the NixOS Search extension: Elasticsearch queries and responses of search.nixos.org.

import type { Color } from "@backslash/api";
import { htmlToMarkdown, htmlToText } from "./html.ts";

// ---------------------------------------------------------------------------
// Backend

/** What the search.nixos.org page itself uses (its index.*.js), kept in case it can't be read. */
export const FALLBACK: Backend = {
  version: 52,
  username: "aWVSALXpZv",
  password: "X8gPHnzL52wFEekuxsfQ9cSh",
  channels: [{ id: "26.05", branch: "nixos-26.05", status: "stable" }, {
    id: "unstable",
    branch: "nixos-unstable",
    status: "rolling",
  }],
};

export interface Channel {
  id: string;
  branch: string;
  status: string;
}

export interface Backend {
  version: number;
  username: string;
  password: string;
  channels: Channel[];
}

/** The script of search.nixos.org: `<script src="/static/js/index.b0e64e8e.js">`. */
export function scriptUrl(html: string): string | undefined {
  const m = html.match(/src="(\/static\/js\/index\.[\w.]+\.js)"/);
  return m ? `https://search.nixos.org${m[1]}` : undefined;
}

/** Index version, public credentials and channels, from the site's script. */
export function parseBackend(js: string): Backend | undefined {
  const version = js.match(/elasticsearchMappingSchemaVersion:parseInt\("(\d+)"\)/)?.[1];
  const username = js.match(/elasticsearchUsername:"([^"]+)"/)?.[1];
  const password = js.match(/elasticsearchPassword:"([^"]+)"/)?.[1];
  if (!version || !username || !password) return undefined;
  let channels = FALLBACK.channels;
  const raw = js.match(/nixosChannels:JSON\.parse\('(.+?)'\)/)?.[1];
  if (raw) {
    try {
      const parsed = JSON.parse(raw.replace(/\\'/g, "'"));
      const list = (parsed.channels ?? []).filter((c: any) => c.id && c.branch)
        .map((c: any) => ({ id: String(c.id), branch: String(c.branch), status: String(c.status ?? "") }));
      if (list.length) channels = list;
    } catch {
      // keep the fallback list
    }
  }
  return { version: Number(version), username, password, channels };
}

export const indexName = (b: Backend, channel: string) => `latest-${b.version}-nixos-${channel}`;

/** The preferred channel if it exists ("unstable", "26.05", "nixos-26.05", "stable"), else unstable. */
export function pickChannel(channels: Channel[], wanted: unknown): Channel {
  const w = String(wanted ?? "").trim().toLowerCase().replace(/^nixos-/, "");
  return channels.find((c) => c.id === w) ??
    (w === "stable" ? channels.find((c) => c.status === "stable") : undefined) ??
    channels.find((c) => c.id === "unstable") ?? channels[0];
}

// ---------------------------------------------------------------------------
// Queries

const words = (q: string) => q.trim().split(/\s+/).filter(Boolean);

/** Close to the site's own query: weighted fields, plus substring matches on the attribute name. */
export function packageQuery(q: string, size = 30) {
  const text = q.trim();
  return {
    from: 0,
    size,
    query: {
      bool: {
        filter: [{ term: { type: "package" } }],
        must: [{
          dis_max: {
            tie_breaker: 0.7,
            queries: [
              {
                multi_match: {
                  type: "cross_fields",
                  query: text,
                  analyzer: "whitespace",
                  auto_generate_synonyms_phrase_query: false,
                  operator: "and",
                  fields: [
                    "package_attr_name^9",
                    "package_attr_name.*^5.4",
                    "package_programs^9",
                    "package_programs.*^5.4",
                    "package_pname^6",
                    "package_pname.*^3.6",
                    "package_description^1.3",
                    "package_description.*^0.78",
                    "package_longDescription^1",
                    "package_longDescription.*^0.6",
                  ],
                },
              },
              ...words(text).map((w) => ({
                wildcard: { package_attr_name: { value: `*${w}*`, case_insensitive: true } },
              })),
            ],
          },
        }],
      },
    },
  };
}

export type OptionSource = "nixos" | "home-manager" | "darwin";

export const SOURCES: { value: OptionSource; title: string; type: string; site: string; tint: Color }[] = [
  { value: "nixos", title: "NixOS", type: "option", site: "nixos", tint: "blue" },
  { value: "home-manager", title: "Home Manager", type: "home-manager-option", site: "home_manager", tint: "teal" },
  { value: "darwin", title: "nix-darwin", type: "darwin-option", site: "darwin", tint: "purple" },
];

export const source = (v: unknown) => SOURCES.find((s) => s.value === v) ?? SOURCES[0];

/** Options: weighted fields, exact and prefix names, and `services.<q>.enable` first for one word. */
export function optionQuery(q: string, src: OptionSource, size = 30) {
  const text = q.trim();
  const single = words(text).length === 1 && !text.includes(".");
  return {
    from: 0,
    size,
    query: {
      bool: {
        filter: [{ term: { type: source(src).type } }],
        must: [{
          dis_max: {
            tie_breaker: 0.7,
            queries: [
              {
                multi_match: {
                  type: "cross_fields",
                  query: text,
                  analyzer: "whitespace",
                  auto_generate_synonyms_phrase_query: false,
                  operator: "and",
                  fields: ["option_name^6", "option_name.*^3.6", "option_description^1", "option_description.*^0.6"],
                },
              },
              ...words(text).map((w) => ({ wildcard: { option_name: { value: `*${w}*`, case_insensitive: true } } })),
              { term: { option_name: { value: text, boost: 100 } } },
              { prefix: { option_name: { value: text, boost: 20 } } },
              ...(single
                ? ["services", "programs", "networking", "hardware", "virtualisation"].map((p) => ({
                  term: { option_name: { value: `${p}.${text}.enable`, boost: 60 } },
                }))
                : []),
              ...(single
                ? [{ wildcard: { option_name: { value: `*.${text}.enable`, case_insensitive: true, boost: 30 } } }]
                : []),
            ],
          },
        }],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Responses

export interface License {
  name: string;
  spdx?: string;
  url?: string;
  free: boolean;
}

export interface Maintainer {
  name: string;
  github?: string;
}

export interface Package {
  attr: string;
  pname: string;
  version: string;
  description?: string;
  /** Markdown. */
  longDescription?: string;
  licenses: License[];
  platforms: string[];
  homepage?: string;
  /** `pkgs/by-name/ri/ripgrep/package.nix:66`. */
  position?: string;
  programs: string[];
  mainProgram?: string;
  outputs: string[];
  maintainers: Maintainer[];
  set?: string;
}

const UNFREE = /^(unfree|unfreeRedistributable|unfreeRedistributableFirmware)$/i;

export function mapPackage(s: any): Package {
  const licenses: License[] = (s.package_license ?? []).map((l: any) => ({
    name: l.fullName ?? l.shortName ?? "Unknown",
    ...(l.spdxId ? { spdx: l.spdxId } : {}),
    ...(l.url ? { url: l.url } : {}),
    free: !(UNFREE.test(l.shortName ?? "") || /^unfree/i.test(l.fullName ?? "")),
  }));
  const homepage = (s.package_homepage ?? []).find((h: string) => /^https?:\/\//.test(h));
  return {
    attr: s.package_attr_name,
    pname: s.package_pname ?? s.package_attr_name,
    version: s.package_pversion ?? "",
    ...(s.package_description ? { description: s.package_description } : {}),
    ...(s.package_longDescription
      ? {
        longDescription: s.package_longDescription.includes("<")
          ? htmlToMarkdown(s.package_longDescription)
          : s.package_longDescription.trim(),
      }
      : {}),
    licenses,
    platforms: s.package_platforms ?? [],
    ...(homepage ? { homepage } : {}),
    ...(s.package_position ? { position: s.package_position } : {}),
    programs: s.package_programs ?? [],
    ...(s.package_mainProgram ? { mainProgram: s.package_mainProgram } : {}),
    outputs: s.package_outputs ?? [],
    maintainers: (s.package_maintainers ?? []).map((m: any) => ({
      name: m.name ?? m.github ?? "?",
      ...(m.github ? { github: m.github } : {}),
    })),
    ...(s.package_attr_set && s.package_attr_set !== "No package set" ? { set: s.package_attr_set } : {}),
  };
}

export interface NixOption {
  name: string;
  source: OptionSource;
  /** Markdown. */
  description: string;
  /** The description as plain text, for subtitles. */
  summary: string;
  type?: string;
  default?: string;
  example?: string;
  /** `nixos/modules/services/networking/ssh/sshd.nix`. */
  declared?: string;
}

const literal = (v: unknown): string | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  // Older indexes wrap values as `{ _type: "literalExpression", text }`.
  return s.replace(/^<rendered-html>|<\/rendered-html>$/g, "");
};

export function mapOption(s: any): NixOption {
  const src: OptionSource = s.type === "home-manager-option"
    ? "home-manager"
    : s.type === "darwin-option"
    ? "darwin"
    : "nixos";
  return {
    name: s.option_name,
    source: src,
    description: s.option_description ? htmlToMarkdown(s.option_description) : "",
    summary: s.option_description ? htmlToText(s.option_description) : "",
    ...(s.option_type ? { type: s.option_type } : {}),
    ...(literal(s.option_default) !== undefined ? { default: literal(s.option_default) } : {}),
    ...(literal(s.option_example) !== undefined ? { example: literal(s.option_example) } : {}),
    ...(s.option_source ? { declared: s.option_source } : {}),
  };
}

export const hits = (json: any): any[] => (json?.hits?.hits ?? []).map((h: any) => h._source);
export const total = (json: any): number => json?.hits?.total?.value ?? 0;

// ---------------------------------------------------------------------------
// Links and snippets

/** `pkgs/…/package.nix:66` → the file on GitHub, at that line. */
export function sourceUrl(position: string, branch: string): string {
  const m = position.match(/^(.*?)(?::(\d+))?$/)!;
  return `https://github.com/NixOS/nixpkgs/blob/${branch}/${m[1]}${m[2] ? `#L${m[2]}` : ""}`;
}

/** Where an option is declared, like the site does (Home Manager and nix-darwin have their own repositories). */
export function declarationUrl(o: NixOption, channel: Channel): string | undefined {
  if (!o.declared) return undefined;
  const path = o.declared.replace(/:(\d+)$/, "#L$1");
  if (/^https?:\/\//.test(path)) return path;
  const stable = channel.id !== "unstable";
  if (o.source === "home-manager") {
    return `https://github.com/nix-community/home-manager/blob/${stable ? `release-${channel.id}` : "master"}/${path}`;
  }
  if (o.source === "darwin") {
    return `https://github.com/nix-darwin/nix-darwin/blob/${stable ? `nix-darwin-${channel.id}` : "master"}/${path}`;
  }
  return `https://github.com/NixOS/nixpkgs/blob/${channel.branch}/${path}`;
}

export const packageUrl = (attr: string, channel: Channel) =>
  `https://search.nixos.org/packages?channel=${channel.id}&query=${encodeURIComponent(attr)}#show=${
    encodeURIComponent(attr)
  }`;

export const optionUrl = (o: NixOption, channel: Channel) =>
  `https://search.nixos.org/options?channel=${channel.id}&source=${source(o.source).site}&query=${
    encodeURIComponent(o.name)
  }`;

/** A value to put in a snippet: the example, else the default, else a placeholder by type. */
export function snippetValue(o: NixOption): string {
  if (o.type === "boolean") return o.default === "true" ? "false" : "true";
  const value = o.example ?? o.default;
  if (value !== undefined && value.length < 200) return value.trim();
  const t = o.type ?? "";
  if (/^list of/.test(t)) return "[ ]";
  if (/^attribute set|^submodule/.test(t)) return "{ }";
  if (/^string|^path/.test(t)) return '""';
  if (/integer|number/.test(t)) return "0";
  if (/^package/.test(t)) return "pkgs.";
  return "…";
}

/** `services.openssh.enable = true;`, indented when the value has several lines. */
export function optionSnippet(o: NixOption): string {
  const value = snippetValue(o);
  if (!value.includes("\n")) return `${o.name} = ${value};`;
  const lines = value.split("\n");
  return `${o.name} = ${lines[0]}\n${lines.slice(1).map((l) => `  ${l}`).join("\n")};`;
}

/** The commands to try or install a package. */
export function installCommands(p: Package): [string, string][] {
  const a = p.attr;
  return [
    ["nix-shell", `nix-shell -p ${a}`],
    ["nix shell", `nix shell nixpkgs#${a}`],
    ...(p.mainProgram || p.programs.length ? [["nix run", `nix run nixpkgs#${a}`] as [string, string]] : []),
    ["NixOS configuration", `environment.systemPackages = [ pkgs.${a} ];`],
    ["Home Manager", `home.packages = [ pkgs.${a} ];`],
    ["nix profile", `nix profile install nixpkgs#${a}`],
    ["nix-env", `nix-env -iA nixpkgs.${a}`],
  ];
}

/** `x86_64-linux`, `aarch64-darwin`… → the usual four first, then how many others. */
export function platformSummary(platforms: string[]): { main: string[]; others: number } {
  const usual = ["x86_64-linux", "aarch64-linux", "x86_64-darwin", "aarch64-darwin"];
  const main = usual.filter((p) => platforms.includes(p));
  return { main, others: platforms.length - main.length };
}

/** `programs.git.enable` → `programs.git`: the part shown dimmed. */
export const optionParent = (name: string) => name.split(".").slice(0, -1).join(".");

/** Shortens a long type: "string matching the pattern ^$|^[[:alnum:]]…" */
export const shortType = (t: string, max = 60) => (t.length > max ? t.slice(0, max - 1) + "…" : t);
