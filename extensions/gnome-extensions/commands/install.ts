import { action, close, copy, Icons, type Item, list, meta, open, toast } from "@backslash/api";
import { compact, descriptionMarkdown, type Remote } from "../lib.ts";
import { enable, install, type Installed, installed, search, shellVersion } from "../gnome.ts";

/** What is installed, loaded once while the command is open. */
let local: Promise<Installed | undefined> | undefined;

function remoteItem(r: Remote, shell: string | undefined, mine: Installed | undefined): Item {
  const here = mine?.extensions.find((e) => e.uuid === r.uuid);
  const supported = !shell || r.shells.includes(shell);
  const latest = r.shells.at(-1);
  return {
    id: r.uuid,
    title: r.name,
    subtitle: r.description.split("\n")[0],
    icon: r.icon ?? { source: Icons.apps, tint: supported ? "blue" : "gray" },
    keywords: [r.uuid, r.creator ?? ""],
    accessories: [
      ...(here
        ? [{
          tag: here.enabled ? "Installed" : "Installed, off",
          color: here.enabled ? "green" as const : "gray" as const,
        }]
        : []),
      ...(!supported ? [{ tag: `Up to GNOME ${latest ?? "?"}`, color: "orange" as const }] : []),
      ...(r.downloads !== undefined
        ? [{ text: compact(r.downloads), icon: Icons.download, tooltip: "Downloads" }]
        : []),
      ...(r.creator ? [{ text: r.creator, tooltip: "Author" }] : []),
    ],
    detail: {
      image: r.screenshot,
      markdown: descriptionMarkdown(r.description),
      metadata: [
        ...(r.creator ? [meta.person("Author", r.creator)] : []),
        ...(r.version ? [meta.text("Version", r.version, { icon: Icons.tag })] : []),
        ...(r.downloads !== undefined
          ? [meta.text("Downloads", r.downloads.toLocaleString("en"), { icon: Icons.download })]
          : []),
        meta.tags(
          "GNOME versions",
          r.shells.slice(-8).map((s) => ({ text: s, color: s === shell ? "green" as const : undefined })),
        ),
        meta.text("UUID", r.uuid, { icon: Icons.hash }),
        ...(r.url ? [meta.link("Homepage", r.url.replace(/^https?:\/\//, ""), r.url)] : []),
      ],
    },
    actions: [
      here
        ? here.enabled
          ? open(r.link, "Open on extensions.gnome.org", { icon: Icons.globe })
          : action("Enable", async () => {
            await enable(r.uuid);
            local = undefined;
            return close(`${r.name} enabled`);
          }, { icon: Icons.done })
        : action("Install", async () => {
          if (!supported) {
            throw new Error(`${r.name} doesn't support GNOME ${shell} yet (up to ${latest ?? "?"})`);
          }
          await toast(`Confirm the installation of ${r.name} in GNOME Shell's dialog…`);
          const result = await install(r.uuid);
          local = undefined;
          if (result === "successful") return close(`${r.name} installed`);
          if (result === "cancelled") {
            await toast("Installation cancelled");
            return;
          }
          throw new Error(`GNOME Shell couldn't install ${r.name}: ${result}`);
        }, { icon: Icons.download }),
      open(r.link, "Open on extensions.gnome.org", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      ...(r.url ? [open(r.url, "Open Homepage", { icon: Icons.external })] : []),
      copy(r.uuid, "Copy UUID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(r.link, "Copy Link", { section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Search extensions.gnome.org…",
  empty: { title: "No extension found", description: "Try other words", icon: Icons.search },
  async search(query, { signal }) {
    local ??= installed().catch(() => undefined);
    const [shell, mine] = await Promise.all([shellVersion().catch(() => undefined), local]);
    const { extensions } = await search(query, shell, signal);
    return extensions.map((r) => remoteItem(r, shell, mine));
  },
});
