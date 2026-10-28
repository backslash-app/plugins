import {
  type Action,
  action,
  clipboard,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  download,
  getDocument,
  names,
  searchDocuments,
  type Server,
  server,
  setTags,
  SetupError,
  setupItem,
  shareLink,
  thumbnails,
} from "../api.ts";
import { asnText, type DocView, docView, formatDate, type Names, shareUrl, webUrl } from "../lib.ts";

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, "~");

function tagActions(s: Server, d: DocView, all: Names): Action[] {
  const current = new Set(d.tags.map((t) => t.id));
  return Object.entries(all.tags)
    .map(([id, t]) => ({ id: Number(id), ...t }))
    .sort((a, b) => Number(current.has(b.id)) - Number(current.has(a.id)) || a.name.localeCompare(b.name))
    .map((t) => {
      const on = current.has(t.id);
      return action(on ? `Remove ${t.name}` : `Add ${t.name}`, async () => {
        const next = on ? [...current].filter((x) => x !== t.id) : [...current, t.id];
        await setTags(s, d.id, next);
        await toast(on ? `Removed tag ${t.name}` : `Tagged ${t.name}`, { style: "success" });
        return refresh();
      }, { icon: on ? Icons.squareCheck : Icons.square });
    });
}

function fullText(s: Server, d: DocView) {
  return detail({
    title: d.title,
    async markdown({ signal }) {
      const doc = await getDocument(s, d.id, signal);
      const text = (doc.content ?? "").trim();
      return text
        ? `# ${d.title}\n\n\`\`\`\n${text.replace(/```/g, "ʼʼʼ")}\n\`\`\``
        : "*No text was recognized in this document.*";
    },
    actions: [
      open(webUrl(s.base, d.id), "Open in Paperless-ngx", { icon: Icons.external }),
      action("Copy Text", async () => {
        const doc = await getDocument(s, d.id);
        await clipboard.write(doc.content ?? "");
        await toast("Text copied", { style: "success" });
      }, { icon: Icons.copy }),
    ],
  });
}

function docItem(s: Server, d: DocView, all: Names, thumb?: string): Item {
  const metadata: Metadata[] = [];
  if (d.correspondent) metadata.push(meta.text("Correspondent", d.correspondent, { icon: Icons.person }));
  if (d.type) metadata.push(meta.text("Type", d.type, { icon: Icons.file }));
  if (d.tags.length) metadata.push(meta.tags("Tags", d.tags.map((t) => ({ text: t.name, color: t.color }))));
  if (d.created) metadata.push(meta.text("Created", formatDate(d.created), { icon: Icons.calendar }));
  if (d.added) metadata.push(meta.text("Added", formatDate(d.added), { icon: Icons.inbox }));
  if (d.asn !== undefined) metadata.push(meta.text("Archive number", asnText(d.asn), { icon: Icons.hash }));
  if (d.pages) metadata.push(meta.text("Pages", d.pages, { icon: Icons.layers }));
  if (d.path) metadata.push(meta.text("Storage path", d.path, { icon: Icons.folder }));
  if (d.notes) metadata.push(meta.text("Notes", d.notes, { icon: Icons.comment }));
  if (d.fileName) metadata.push(meta.text("Original file", d.fileName, { icon: Icons.archive }));

  const accessories: Item["accessories"] = [];
  for (const t of d.tags.slice(0, 2)) accessories.push({ tag: t.name, color: t.color });
  if (d.tags.length > 2) {
    accessories.push({
      text: `+${d.tags.length - 2}`,
      tooltip: d.tags.slice(2).map((t) => t.name).join(", "),
    });
  }
  if (d.asn !== undefined) accessories.push({ text: `#${d.asn}`, tooltip: asnText(d.asn) });
  if (d.created) accessories.push({ text: formatDate(d.created), tooltip: "Created" });

  const downloadAndOpen = (original: boolean) => async () => {
    await toast("Downloading…");
    const path = await download(s, d, original);
    await openExternal(path);
    await toast(`Saved ${tilde(path)}`, { style: "success" });
  };

  return {
    id: String(d.id),
    title: d.title,
    subtitle: [d.correspondent, d.type].filter(Boolean).join(" · "),
    icon: thumb ?? { source: Icons.file, tint: d.tags.some((t) => t.inbox) ? "blue" : "gray" },
    keywords: [
      d.correspondent ?? "",
      d.type ?? "",
      ...d.tags.map((t) => t.name),
      d.asn !== undefined ? String(d.asn) : "",
    ],
    accessories,
    detail: {
      image: thumb,
      markdown: d.highlights ? `…${d.highlights}…` : d.excerpt || "*No text*",
      metadata,
    },
    actions: [
      open(webUrl(s.base, d.id), "Open in Paperless-ngx", { icon: Icons.external }),
      action("Download and Open", downloadAndOpen(true), { icon: Icons.download, shortcut: "<Ctrl>d" }),
      action("Copy Share Link", async () => {
        const slug = await shareLink(s, d.id, true);
        await clipboard.write(shareUrl(s.base, slug));
        await toast("Share link copied", { style: "success", message: "Anyone with it can download the file" });
      }, { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Share" }),
      submenu("Edit Tags", () => tagActions(s, d, all), { icon: Icons.tag, shortcut: "<Ctrl>t", section: "Edit" }),
      action("Show Full Text", () => fullText(s, d), { icon: Icons.text, section: "Edit" }),
      action("Download Archived PDF", downloadAndOpen(false), { icon: Icons.download, section: "Share" }),
      copy(webUrl(s.base, d.id), "Copy Link", { section: "Copy" }),
      copy(d.title, "Copy Title", { section: "Copy" }),
      ...(d.asn !== undefined ? [copy(String(d.asn), "Copy Archive Number", { section: "Copy" })] : []),
    ],
  };
}

let footer = "";

export default list({
  placeholder: "Search document text, titles, correspondents…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "inbox", title: "Inbox" }],
    default: "all",
  },
  empty: {
    title: "No documents found",
    description: "Try other words: the search covers the text, titles, tags and correspondents",
    icon: Icons.file,
  },
  status: () => footer,
  async search(query, { preferences, signal, filter }) {
    let s: Server;
    try {
      s = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    try {
      let all = await names(s, [], signal);
      const inbox = filter === "inbox"
        ? Object.entries(all.tags).filter(([, t]) => t.inbox).map(([id]) => Number(id))
        : undefined;
      if (filter === "inbox" && !inbox?.length) {
        footer = "No inbox tag";
        return [{
          id: "no-inbox",
          title: "No inbox tag in Paperless-ngx",
          subtitle: "Mark a tag as inbox tag to see new documents here",
          icon: { source: Icons.inbox, tint: "gray" },
          actions: [open(`${s.base}/tags`, "Open Tags", { icon: Icons.external })],
        }];
      }
      const { count, docs } = await searchDocuments(s, query.trim(), { inbox, signal });
      all = await names(s, docs, signal);
      const views = docs.map((d) => docView(d, all));
      const thumbs = await thumbnails(s, views.map((d) => d.id), { signal, deadline: query ? 1200 : 2000 });
      footer = query.trim()
        ? `${count} document${count === 1 ? "" : "s"} match`
        : filter === "inbox"
        ? `${count} in the inbox`
        : `${count} document${count === 1 ? "" : "s"}, newest first`;
      if (filter === "inbox" && !query) {
        updateCommandMetadata({ subtitle: count ? `${count} in the inbox` : null }).catch(() => {});
      }
      return views.map((d) => docItem(s, d, all, thumbs.get(d.id)));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
