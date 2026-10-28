import { type Context, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { backend, query } from "../api.ts";
import {
  type Channel,
  declarationUrl,
  hits,
  mapOption,
  type NixOption,
  optionParent,
  optionQuery,
  optionSnippet,
  type OptionSource,
  optionUrl,
  pickChannel,
  shortType,
  source,
  SOURCES,
  total,
} from "../lib.ts";

const CONFIG_FILE: Record<OptionSource, string> = {
  "nixos": "configuration.nix",
  "home-manager": "home.nix",
  "darwin": "darwin-configuration.nix",
};

function optionItem(o: NixOption, channel: Channel): Item {
  const src = source(o.source);
  const declared = declarationUrl(o, channel);
  const snippet = optionSnippet(o);
  const block = (label: string, value?: string) =>
    value === undefined ? [] : ["", `**${label}**`, "", "```nix", value, "```"];
  return {
    id: `${o.source}:${o.name}`,
    title: o.name,
    subtitle: o.summary.slice(0, 140),
    icon: { source: Icons.settings, tint: src.tint },
    accessories: o.type ? [{ text: shortType(o.type, 28), tooltip: o.type }] : [],
    detail: {
      markdown: [
        o.description || "*No description.*",
        ...block("Default", o.default),
        ...block("Example", o.example),
        "",
        `**In ${CONFIG_FILE[o.source]}**`,
        "",
        "```nix",
        snippet,
        "```",
      ].join("\n"),
      metadata: [
        meta.text("Name", o.name, { icon: Icons.settings }),
        ...(o.type ? [meta.text("Type", shortType(o.type, 80), { icon: Icons.braces })] : []),
        ...(o.default !== undefined && o.default.length < 60 ? [meta.text("Default", o.default)] : []),
        meta.tags("Source", [{ text: src.title, color: src.tint }]),
        meta.separator(),
        ...(declared && o.declared ? [meta.link("Declared in", o.declared, declared)] : []),
        meta.link("Channel", `nixos-${channel.id}`, optionUrl(o, channel)),
      ],
    },
    actions: [
      copy(o.name, "Copy Option Name"),
      copy(snippet, "Copy Option Snippet", { icon: Icons.code }),
      open(optionUrl(o, channel), "Open on search.nixos.org", { shortcut: "<Ctrl>o" }),
      ...(declared ? [open(declared, "Open Declaration", { icon: Icons.code, shortcut: "<Ctrl>d" })] : []),
      ...(optionParent(o.name)
        ? [copy(optionParent(o.name), `Copy “${optionParent(o.name)}”`, { icon: Icons.copy, section: "Copy" })]
        : []),
      ...(o.default !== undefined
        ? [copy(o.default, "Copy Default Value", { icon: Icons.copy, section: "Copy" })]
        : []),
      ...(o.example !== undefined ? [copy(o.example, "Copy Example", { icon: Icons.copy, section: "Copy" })] : []),
    ],
  };
}

let last = "";

export default async (ctx: Context) => {
  const b = await backend(ctx.signal);
  const channel = pickChannel(b.channels, ctx.preferences.channel);
  return list({
    placeholder: "Search options… (services.openssh, firewall ports)",
    filter: { options: SOURCES.map((s) => ({ value: s.value, title: s.title })), default: "nixos" },
    empty: {
      title: "No option found",
      description: "Try a part of the name, or Tab to another source.",
      icon: Icons.settings,
    },
    status: () => last,
    async search(text, { filter, signal }) {
      const src = source(filter);
      if (!text.trim()) {
        last = `${src.title} options · nixos-${channel.id}`;
        return [{
          id: "hint",
          title: `Search ${src.title} options`,
          subtitle: "By name or description; Tab switches between NixOS, Home Manager and nix-darwin",
          icon: { source: Icons.search, tint: src.tint },
          actions: [
            open(`https://search.nixos.org/options?channel=${channel.id}&source=${src.site}`, "Open search.nixos.org"),
          ],
        }];
      }
      try {
        const json = await query(channel.id, optionQuery(text, src.value), signal);
        const found = hits(json).map(mapOption);
        const n = total(json);
        last = `${found.length < n ? `${found.length} of ${n.toLocaleString("en")}` : n} ${src.title} option${
          n === 1 ? "" : "s"
        } · nixos-${channel.id}`;
        return found.map((o) => optionItem(o, channel));
      } catch (e) {
        if (signal.aborted) throw e;
        last = "search.nixos.org is unreachable";
        return [{
          id: "error",
          title: e instanceof Error ? e.message : String(e),
          icon: { source: Icons.wifiOff, tint: "red" },
          actions: [
            open(
              `https://search.nixos.org/options?channel=${channel.id}&source=${src.site}&query=${
                encodeURIComponent(text)
              }`,
              "Search in the Browser",
            ),
          ],
        }];
      }
    },
  });
};
