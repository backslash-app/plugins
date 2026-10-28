import {
  type Action,
  action,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { normalizeUrl, parseFolders, tilde } from "../lib.ts";
import {
  fileSummaries,
  findSpecFiles,
  HOME,
  savedUrls,
  saveUrls,
  sourceOf,
  type Summary,
  urlSummary,
} from "../specs.ts";
import { endpointsView, where } from "../views.ts";

interface Prefs {
  folders?: string;
  depth?: number;
}

const date = (ms: number) => new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

function addUrlAction(): Action {
  return action("Add Spec URL…", () =>
    form({
      title: "Add Spec URL",
      submitTitle: "Add",
      fields: [
        field.text("url", "URL", {
          required: true,
          placeholder: "https://petstore3.swagger.io/api/v3/openapi.json",
        }),
      ],
      async submit(values) {
        const url = normalizeUrl(String(values.url ?? ""));
        const s = await urlSummary(url);
        if (s.error) {
          await toast("Not added", { style: "failure", message: s.error });
          return;
        }
        await saveUrls([...await savedUrls(), url]);
        await toast(`Added ${s.title}`, { style: "success", message: `${s.operations} endpoints` });
        return pop();
      },
    }), { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Specs" });
}

function specItem(s: Summary): Item {
  const source = sourceOf(s);
  const broken = !!s.error;
  return {
    id: s.uri,
    title: s.title,
    subtitle: where(source),
    section: s.url ? "Saved URLs" : "Files",
    icon: broken
      ? { source: Icons.alert, tint: "red" }
      : { source: s.url ? Icons.globe : Icons.braces, tint: s.kind.startsWith("Swagger") ? "green" : "blue" },
    keywords: [s.kind, s.version ?? "", s.server ?? ""].filter(Boolean),
    accessories: broken ? [{ tag: s.kind, color: "red" }] : [
      ...(s.version ? [{ tag: `v${s.version.replace(/^v/i, "")}` }] : []),
      { text: s.kind.replace(/^OpenAPI /, "OAS ") },
      { text: `${s.operations} endpoint${s.operations === 1 ? "" : "s"}` },
    ],
    detail: {
      stats: broken ? undefined : [
        { label: "Endpoints", value: s.operations },
        { label: "Tags", value: s.tags },
      ],
      markdown: broken ? `**${s.error}**` : s.description ? s.description.slice(0, 1500) : undefined,
      metadata: [
        meta.text("Format", s.kind, { icon: Icons.braces }),
        ...(s.version ? [meta.text("API version", s.version, { icon: Icons.tag })] : []),
        ...(s.server ? [meta.text("Server", s.server, { icon: Icons.server })] : []),
        meta.text(s.path ? "File" : "URL", where(source), { icon: s.path ? Icons.file : Icons.globe }),
        ...(s.modified ? [meta.text(s.path ? "Modified" : "Downloaded", date(s.modified), { icon: Icons.clock })] : []),
      ],
    },
    actions: [
      ...(broken ? [] : [action("Browse Endpoints", () => endpointsView(source, s.title), { icon: Icons.link })]),
      ...(s.path
        ? [
          open(s.path, "Open File", { icon: Icons.file }),
          open(s.path.replace(/\/[^/]+$/, ""), "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
          copy(s.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
        ]
        : [
          open(s.url!, "Open URL in Browser"),
          copy(s.url!, "Copy URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
          action("Remove URL", async () => {
            await saveUrls((await savedUrls()).filter((u) => u !== s.url));
            await toast(`Removed ${s.title}`, { style: "success" });
            return refresh();
          }, {
            icon: Icons.trash,
            destructive: true,
            confirm: `Remove ${s.url}?`,
            section: "Specs",
            shortcut: "<Ctrl>x",
          }),
        ]),
      ...(s.server && /^https?:/.test(s.server) ? [copy(s.server, "Copy Server URL", { section: "Copy" })] : []),
      addUrlAction(),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Specs" }),
    ],
  };
}

export default list({
  placeholder: "Filter API specs…",
  empty: {
    title: "No OpenAPI spec found",
    description: "Press Ctrl+N to add a spec URL, or set the folders to scan in Settings → Extensions → OpenAPI",
    icon: Icons.braces,
  },
  actions: [addUrlAction()],
  status: (items) => `${items.filter((i) => !i.id?.startsWith("denied:")).length} specs`,
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const roots = parseFolders(prefs.folders, HOME);
    const depth = Math.max(1, Math.min(8, Math.round(Number(prefs.depth) || 4)));
    const urls = await savedUrls();
    const [found, files] = await (async () => {
      const f = await findSpecFiles(roots, depth, signal);
      return [f, await fileSummaries(f.files)] as const;
    })();
    const denied: Item[] = found.denied.map((root) => ({
      id: `denied:${root}`,
      title: `${tilde(root, HOME)} can't be read`,
      subtitle: "Only the usual code folders of your home can be scanned",
      section: "Folders",
      icon: { source: Icons.lock, tint: "orange" },
      detail: {
        markdown:
          "This extension may only read **~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/Developer, ~/git, ~/repos, ~/workspace, ~/work** and ~/Work.\n\nMove the spec there, add it by URL, or remove this folder from the preferences.",
      },
      actions: [addUrlAction()],
    }));
    const local = files.sort((a, b) => b.modified - a.modified).map(specItem);
    yield [...local, ...denied];
    if (!urls.length) return;
    const remote = await Promise.all(urls.map((u) => urlSummary(u, signal)));
    yield [...local, ...remote.map(specItem), ...denied];
  },
});
