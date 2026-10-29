// Rows for design files and projects, and the cached-then-fresh loading both
// tools share.

import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  refresh,
  storage,
  toast,
} from "@backslash/api";
import {
  cachedIndex,
  type FigmaAuth,
  type Index,
  markOpened,
  type PenpotAuth,
  recentFiles,
  saveIndex,
  SetupError,
} from "./api.ts";
import {
  ago,
  type DesignFile,
  figmaDesktopUrl,
  figmaProjectUrl,
  figmaTeamUrl,
  figmaUrl,
  penpotProjectUrl,
  penpotUrl,
  type Project,
  shortAge,
  sortFiles,
  type Tool,
} from "./lib.ts";

export const TOOL_NAMES: Record<Tool, string> = { figma: "Figma", penpot: "Penpot" };

export function setupItem(e: SetupError): Item {
  const md = e.tool === "figma"
    ? [
      "## Connect Figma",
      "",
      "1. In Figma, open **Settings → Security → Personal access tokens → Generate new token**, with read access to",
      "   **File content** and **Projects**. Paste it in **Settings → Extensions → Figma & Penpot → Configure**.",
      "2. Figma's API can't list your teams: open each team in Figma (its name in the sidebar) and copy the link,",
      "   which holds `…/team/1234567890123456789/…`. Paste the links or the numbers in **Figma teams**, separated",
      "   by commas.",
    ]
    : [
      "## Connect Penpot",
      "",
      "In Penpot, open **Your account → Access tokens → Generate new token**, and paste it in",
      "**Settings → Extensions → Figma & Penpot → Configure**. Keep the address `https://design.penpot.app`, or set",
      "the one of your own Penpot: this computer, a local name (`*.local`, `*.lan`, `penpot`…), a private network",
      "(`192.168.x.x`, `10.x.x.x`) or Tailscale (`100.64.x.x`, `*.ts.net`).",
    ];
  return {
    id: "setup",
    title: e.message,
    subtitle: `${TOOL_NAMES[e.tool]} settings`,
    icon: { source: /token/i.test(e.message) ? Icons.key : Icons.settings, tint: "orange" },
    detail: { markdown: md.join("\n") },
    actions: [
      e.tool === "figma"
        ? open("https://www.figma.com/settings", "Open Figma Settings", { icon: Icons.external })
        : open(`${e.base ?? "https://design.penpot.app"}/#/settings/access-tokens`, "Open Penpot Access Tokens", {
          icon: Icons.external,
        }),
    ],
  };
}

export type Auth = { tool: "figma"; a: FigmaAuth } | { tool: "penpot"; a: PenpotAuth };

export function fileUrl(auth: Auth, f: DesignFile): string {
  return auth.tool === "figma" ? figmaUrl(f) : penpotUrl(auth.a.base, f);
}

function opener(url: string, f: DesignFile, title: string, o: { icon?: string; shortcut?: string } = {}): Action {
  return action(title, async () => {
    await markOpened(f);
    await openExternal(url);
    return close();
  }, { icon: Icons.external, ...o });
}

export function fileActions(auth: Auth, f: DesignFile): Action[] {
  const web = fileUrl(auth, f);
  const opens: Action[] = auth.tool === "figma"
    ? auth.a.desktop
      ? [
        opener(figmaDesktopUrl(f), f, "Open in Figma App"),
        opener(web, f, "Open in Browser", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      ]
      : [
        opener(web, f, "Open in Browser", { icon: Icons.globe }),
        opener(figmaDesktopUrl(f), f, "Open in Figma App", { shortcut: "<Ctrl>o" }),
      ]
    : [opener(web, f, "Open in Penpot", { icon: Icons.globe })];
  return [
    ...opens,
    copy(web, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(f.name, "Copy Name", { section: "Copy" }),
    copy(f.id, auth.tool === "figma" ? "Copy File Key" : "Copy File ID", { section: "Copy" }),
    open(
      auth.tool === "figma"
        ? figmaProjectUrl({ id: f.projectId })
        : penpotProjectUrl(auth.a.base, { id: f.projectId, teamId: f.teamId }),
      "Open Project",
      { icon: Icons.folder, section: "Project" },
    ),
  ];
}

export function fileItem(auth: Auth, f: DesignFile, recent: string[]): Item {
  const isRecent = recent.includes(`${f.tool}:${f.id}`);
  return {
    id: `${f.tool}:${f.id}`,
    title: f.name,
    subtitle: `${f.team} · ${f.project}`,
    icon: f.thumbnail ??
      { source: f.tool === "figma" ? Icons.palette : Icons.layers, tint: f.tool === "figma" ? "purple" : "teal" },
    section: isRecent ? "Recently Opened" : undefined,
    keywords: [f.project, f.team, f.id],
    accessories: [
      ...(f.shared ? [{ tag: "Library", color: "blue" as const, tooltip: "Shared library" }] : []),
      {
        text: shortAge(f.modified),
        tooltip: f.modified ? `Modified ${new Date(f.modified).toLocaleString("en-GB")}` : undefined,
      },
    ],
    detail: {
      image: f.thumbnail,
      metadata: [
        meta.text("Modified", ago(f.modified), { icon: Icons.clock }),
        meta.text("Project", f.project, { icon: Icons.folder }),
        meta.text("Team", f.team, { icon: Icons.person }),
        ...(f.shared ? [meta.text("Library", "Shared with the team", { icon: Icons.layers })] : []),
        meta.separator(),
        meta.text(f.tool === "figma" ? "File key" : "File ID", f.id, { icon: Icons.key }),
      ],
    },
    actions: fileActions(auth, f),
  };
}

export function projectFilesView(auth: Auth, p: Project, files: DesignFile[]) {
  return list({
    title: `${p.team} · ${p.name}`,
    placeholder: `Filter ${p.name}…`,
    empty: { title: "No file in this project", icon: Icons.folder },
    async items() {
      const recent = await recentFiles();
      return sortFiles(files.filter((f) => f.projectId === p.id)).map((f) => ({
        ...fileItem(auth, f, recent),
        section: undefined,
      }));
    },
  });
}

export function projectItem(auth: Auth, p: Project, files: DesignFile[]): Item {
  const web = auth.tool === "figma" ? figmaProjectUrl(p) : penpotProjectUrl(auth.a.base, p);
  return {
    id: `${p.tool}:${p.id}`,
    title: p.name,
    subtitle: p.files === undefined ? undefined : `${p.files} file${p.files === 1 ? "" : "s"}`,
    icon: { source: Icons.folder, tint: p.tool === "figma" ? "purple" : "teal" },
    section: p.team,
    accessories: p.modified ? [{ text: shortAge(p.modified), tooltip: `Last change ${ago(p.modified)}` }] : [],
    actions: [
      action("Show Files", () => projectFilesView(auth, p, files), { icon: Icons.file }),
      open(web, `Open in ${TOOL_NAMES[p.tool]}`, { shortcut: "<Ctrl>o" }),
      ...(auth.tool === "figma" ? [open(figmaTeamUrl(p.teamId), "Open Team", { icon: Icons.person })] : []),
      copy(web, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

/** The saved index at once (if any), then the fresh one; errors after a cached paint become a toast. */
export async function* indexed(
  key: string,
  load: () => Promise<Omit<Index, "at">>,
  render: (index: Omit<Index, "at">) => Promise<Item[]>,
  signal: AbortSignal,
): AsyncGenerator<Item[]> {
  const saved = await cachedIndex(key);
  if (saved) yield await render(saved);
  // Fresh enough: a design index barely changes within a few minutes.
  if (saved && Date.now() - saved.at < 3 * 60_000) return;
  try {
    const fresh = await load();
    await saveIndex(key, fresh);
    yield await render(fresh);
  } catch (e) {
    if (signal.aborted) return;
    if (e instanceof SetupError) {
      yield [setupItem(e)];
      return;
    }
    if (!saved) throw e;
    await toast("Couldn't refresh the files", { style: "failure", message: (e as Error).message });
  }
}

export const reloadAction = (key: string) =>
  action("Reload", async () => {
    await storage.delete(key).catch(() => {});
    return refresh();
  }, { icon: Icons.refresh, shortcut: "<Ctrl>r" });
