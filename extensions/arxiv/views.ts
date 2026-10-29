// Papers as launcher items.

import { type Action, action, copy, Icons, type Item, meta, type Metadata, open, refresh, toast } from "@backslash/api";
import { addToZotero, toggleSaved } from "./api.ts";
import {
  abstractMarkdown,
  absUrl,
  age,
  archiveOf,
  arxivDoi,
  authorLine,
  bibtex,
  citation,
  fullDate,
  htmlUrl,
  type Paper,
  pdfUrl,
} from "./lib.ts";

export interface Ctx {
  saved: Set<string>;
}

function paperMetadata(p: Paper): Metadata[] {
  const lines: Metadata[] = [];
  for (const a of p.authors.slice(0, 8)) {
    lines.push(meta.person(a.affiliation ? `Author · ${a.affiliation}` : "Author", a.name));
  }
  if (p.authors.length > 8) lines.push(meta.text("", `and ${p.authors.length - 8} more`));
  lines.push(meta.separator());
  lines.push(meta.tags("Categories", p.categories.map((c, i) => ({ text: c, color: i === 0 ? "blue" : undefined }))));
  const archive = p.primaryCategory && archiveOf(p.primaryCategory);
  if (archive) lines.push(meta.text("Field", archive, { icon: Icons.layers }));
  lines.push(meta.text("Submitted", fullDate(p.published), { icon: Icons.calendar }));
  if (p.version > 1 || p.updated !== p.published) {
    lines.push(meta.text(`Version ${p.version}`, fullDate(p.updated), { icon: Icons.history }));
  }
  if (p.comment) lines.push(meta.text("Comment", p.comment, { icon: Icons.comment }));
  if (p.journalRef) lines.push(meta.text("Journal", p.journalRef, { icon: Icons.book }));
  lines.push(meta.link("arXiv", `arXiv:${p.id}`, absUrl(p)));
  const doi = p.doi ?? arxivDoi(p);
  lines.push(meta.link("DOI", doi, `https://doi.org/${doi}`));
  return lines;
}

export function paperActions(p: Paper, c: Ctx): Action[] {
  const isSaved = c.saved.has(p.id);
  return [
    open(absUrl(p), "Open Abstract Page", { icon: Icons.globe }),
    open(pdfUrl(p), "Open PDF", { icon: Icons.file }),
    open(htmlUrl(p), "Open HTML Version", { icon: Icons.code, shortcut: "<Ctrl>h" }),
    copy(bibtex(p), "Copy BibTeX", { icon: Icons.braces, shortcut: "<Ctrl>b", section: "Copy" }),
    copy(citation(p), "Copy Citation (APA)", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(absUrl(p), "Copy Link", { icon: Icons.link, shortcut: "<Ctrl>l", section: "Copy" }),
    copy(`arXiv:${p.id}`, "Copy arXiv ID", { icon: Icons.hash, section: "Copy" }),
    copy(p.title, "Copy Title", { icon: Icons.text, section: "Copy" }),
    action(isSaved ? "Remove from Saved" : "Save for Later", async () => {
      const now = await toggleSaved(p);
      await toast(now ? "Saved for later" : "Removed from saved", { style: "success" });
      return refresh();
    }, { icon: isSaved ? Icons.bookmark : Icons.plus, shortcut: "<Ctrl>s", section: "Library" }),
    action("Add to Zotero", async () => {
      const ok = await addToZotero(p);
      await toast(ok ? "Added to Zotero" : "Zotero isn't running", {
        style: ok ? "success" : "failure",
        message: ok ? "In the collection selected in Zotero" : "Open Zotero, then try again",
      });
    }, { icon: Icons.book, shortcut: "<Ctrl>z", section: "Library" }),
  ];
}

export function paperItem(p: Paper, c: Ctx, o: { section?: string; date?: "published" | "updated" } = {}): Item {
  const when = o.date === "updated" ? p.updated : p.published;
  return {
    id: p.id,
    title: p.title,
    subtitle: authorLine(p.authors),
    icon: { source: c.saved.has(p.id) ? Icons.bookmark : Icons.file, tint: c.saved.has(p.id) ? "orange" : "red" },
    section: o.section,
    keywords: [p.id, ...p.categories, ...p.authors.map((a) => a.name)],
    accessories: [
      ...(p.primaryCategory ? [{ tag: p.primaryCategory, tooltip: archiveOf(p.primaryCategory) }] : []),
      { text: age(when), tooltip: fullDate(when) },
    ],
    detail: {
      markdown: `## ${p.title}\n\n${abstractMarkdown(p.abstract) || "_No abstract._"}`,
      metadata: paperMetadata(p),
    },
    actions: paperActions(p, c),
  };
}
