import { type Context, copy, Icons, type Item, list, meta, open, paste, submenu } from "@backslash/api";
import { backend, query } from "../api.ts";
import {
  type Channel,
  hits,
  installCommands,
  mapPackage,
  type Package,
  packageQuery,
  packageUrl,
  pickChannel,
  platformSummary,
  sourceUrl,
  total,
} from "../lib.ts";

function packageItem(p: Package, channel: Channel): Item {
  const unfree = p.licenses.some((l) => !l.free);
  const { main, others } = platformSummary(p.platforms);
  const install = installCommands(p);
  const source = p.position ? sourceUrl(p.position, channel.branch) : undefined;
  return {
    id: p.attr,
    title: p.attr,
    subtitle: p.description,
    icon: { source: Icons.package, tint: unfree ? "orange" : "blue" },
    keywords: [p.pname, ...p.programs],
    accessories: [
      ...(unfree
        ? [{ tag: "Unfree", color: "orange" as const, tooltip: p.licenses.map((l) => l.name).join(", ") }]
        : []),
      ...(p.version ? [{ tag: p.version, color: "blue" as const }] : []),
    ],
    detail: {
      markdown: [
        `**${p.pname}** ${p.version}`,
        "",
        p.description ?? "",
        ...(p.longDescription ? ["", p.longDescription] : []),
        "",
        "```",
        `nix-shell -p ${p.attr}`,
        "```",
      ].join("\n"),
      metadata: [
        meta.text("Attribute", p.attr, { icon: Icons.braces }),
        ...(p.version ? [meta.text("Version", p.version, { icon: Icons.tag })] : []),
        meta.tags(
          p.licenses.length > 1 ? "Licenses" : "License",
          p.licenses.length
            ? p.licenses.map((l) => ({ text: l.spdx ?? l.name, color: l.free ? "green" as const : "orange" as const }))
            : [{ text: "Not set", color: "gray" }],
        ),
        ...(main.length || others ? [meta.tags("Platforms", [...main, ...(others ? [`+${others} more`] : [])])] : []),
        ...(p.programs.length ? [meta.tags("Programs", p.programs.slice(0, 8))] : []),
        ...(p.outputs.length > 1 ? [meta.tags("Outputs", p.outputs)] : []),
        ...(p.maintainers.length
          ? [meta.text(
            "Maintainers",
            p.maintainers.slice(0, 4).map((m) => m.name).join(", ") +
              (p.maintainers.length > 4 ? ` +${p.maintainers.length - 4}` : ""),
            { icon: Icons.person },
          )]
          : [meta.text("Maintainers", "None", { color: "orange" })]),
        meta.separator(),
        ...(p.homepage ? [meta.link("Homepage", p.homepage.replace(/^https?:\/\/(www\.)?/, ""), p.homepage)] : []),
        ...(source && p.position ? [meta.link("Source", p.position.replace(/^pkgs\//, ""), source)] : []),
        meta.link("Channel", `nixos-${channel.id}`, packageUrl(p.attr, channel)),
      ],
    },
    actions: [
      copy(p.attr, "Copy Attribute Name"),
      open(packageUrl(p.attr, channel), "Open on search.nixos.org"),
      copy(install[0][1], "Copy nix-shell Command", { icon: Icons.terminal, shortcut: "<Ctrl><Shift>c" }),
      ...(install.find(([t]) => t === "nix run")
        ? [copy(`nix run nixpkgs#${p.attr}`, "Copy nix run Command", { icon: Icons.play, shortcut: "<Ctrl>r" })]
        : []),
      submenu(
        "Copy Install Snippet…",
        install.map(([title, text]) => copy(text, title, { icon: Icons.code })),
        { icon: Icons.code, shortcut: "<Ctrl>i" },
      ),
      paste(p.attr, "Paste Attribute Name", { section: "Copy" }),
      ...(p.version ? [copy(p.version, "Copy Version", { icon: Icons.tag, section: "Copy" })] : []),
      ...(p.homepage
        ? [open(p.homepage, "Open Homepage", { icon: Icons.home, section: "Links", shortcut: "<Ctrl>h" })]
        : []),
      ...(source
        ? [open(source, "Open Source in Nixpkgs", { icon: Icons.code, section: "Links", shortcut: "<Ctrl>o" })]
        : []),
    ],
  };
}

let last = "";

export default async (ctx: Context) => {
  const b = await backend(ctx.signal);
  const preferred = pickChannel(b.channels, ctx.preferences.channel);
  return list({
    placeholder: "Search nixpkgs packages…",
    filter: {
      options: b.channels.map((c) => ({ value: c.id, title: c.id === "unstable" ? "Unstable" : c.id })),
      default: preferred.id,
    },
    empty: { title: "No package found", description: "Try a program name or other words.", icon: Icons.package },
    status: () => last,
    async search(text, { filter, signal }) {
      const channel = b.channels.find((c) => c.id === filter) ?? preferred;
      if (!text.trim()) {
        last = `nixos-${channel.id} · ${channel.status}`;
        return [{
          id: "hint",
          title: `Search ${channel.id === "unstable" ? "nixos-unstable" : `NixOS ${channel.id}`} packages`,
          subtitle: "By attribute, program or description; Tab switches the channel",
          icon: { source: Icons.search, tint: "blue" },
          actions: [open(`https://search.nixos.org/packages?channel=${channel.id}`, "Open search.nixos.org")],
        }];
      }
      try {
        const json = await query(channel.id, packageQuery(text), signal);
        const found = hits(json).map(mapPackage);
        const n = total(json);
        last = `${found.length < n ? `${found.length} of ${n.toLocaleString("en")}` : n} package${
          n === 1 ? "" : "s"
        } · nixos-${channel.id}`;
        return found.map((p) => packageItem(p, channel));
      } catch (e) {
        if (signal.aborted) throw e;
        last = "search.nixos.org is unreachable";
        return [{
          id: "error",
          title: e instanceof Error ? e.message : String(e),
          icon: { source: Icons.wifiOff, tint: "red" },
          actions: [
            open(
              `https://search.nixos.org/packages?channel=${channel.id}&query=${encodeURIComponent(text)}`,
              "Search in the Browser",
            ),
          ],
        }];
      }
    },
  });
};
