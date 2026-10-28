// Zotero items as launcher items.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  paste,
} from "@backslash/api";
import {
  apaCitation,
  bibtex,
  citationKey,
  creatorSummary,
  displayDate,
  doiUrl,
  fullName,
  inTextCitation,
  mainPdf,
  openPdfUrl,
  publication,
  selectUrl,
  typeName,
  year,
  type ZItem,
} from "./lib.ts";
import { apiBibtex, type Kind, SetupError } from "./source.ts";

const TYPE_ICONS: Record<string, string> = {
  book: Icons.book,
  bookSection: Icons.book,
  thesis: Icons.archive,
  webpage: Icons.globe,
  blogPost: Icons.rss,
  forumPost: Icons.comment,
  videoRecording: Icons.video,
  film: Icons.film,
  audioRecording: Icons.music,
  podcast: Icons.mic,
  radioBroadcast: Icons.radio,
  tvBroadcast: Icons.monitor,
  computerProgram: Icons.code,
  dataset: Icons.database,
  presentation: Icons.monitor,
  map: Icons.globe,
  artwork: Icons.image,
  email: Icons.mail,
  letter: Icons.mail,
  patent: Icons.shield,
  statute: Icons.shield,
  case: Icons.shield,
  conferencePaper: Icons.person,
  report: Icons.file,
  preprint: Icons.file,
};

const pages = (item: ZItem) => {
  const f = item.fields;
  return [f.volume ? `Vol. ${f.volume}` : "", f.issue ? `No. ${f.issue}` : "", f.pages ? `pp. ${f.pages}` : ""]
    .filter(Boolean)
    .join(", ");
};

function itemMetadata(item: ZItem): Metadata[] {
  const f = item.fields;
  const lines: Metadata[] = [
    meta.text("Type", typeName(item.itemType), { icon: TYPE_ICONS[item.itemType] ?? Icons.file }),
  ];
  for (const c of item.creators.slice(0, 6)) {
    lines.push(meta.person(c.creatorType === "author" ? "Author" : typeName(c.creatorType), fullName(c)));
  }
  if (item.creators.length > 6) lines.push(meta.text("", `and ${item.creators.length - 6} more`));
  if (f.date) lines.push(meta.text("Date", displayDate(f.date)!, { icon: Icons.calendar }));
  const pub = publication(item);
  if (pub) lines.push(meta.text("Published in", pub, { icon: Icons.book }));
  if (pages(item)) lines.push(meta.text("Volume", pages(item)));
  if (f.publisher && f.publisher !== pub) {
    lines.push(meta.text("Publisher", [f.publisher, f.place].filter(Boolean).join(", ")));
  }
  if (f.DOI) lines.push(meta.link("DOI", f.DOI, doiUrl(f.DOI)!));
  else if (f.url) lines.push(meta.link("URL", f.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50), f.url));
  if (f.ISBN) lines.push(meta.text("ISBN", f.ISBN));
  if (item.tags.length) {
    lines.push(meta.tags("Tags", item.tags.slice(0, 10).map((t) => ({ text: t, color: "orange" as const }))));
  }
  lines.push(meta.separator());
  if (item.attachments.length) {
    lines.push(meta.tags(
      "Attachments",
      item.attachments.slice(0, 4).map((a) => ({
        text: a.title.length > 28 ? `${a.title.slice(0, 27)}…` : a.title,
        color: a.contentType === "application/pdf" ? "red" as const : undefined,
      })),
    ));
  }
  lines.push(meta.text("Citation key", citationKey(item), { icon: Icons.braces }));
  if (item.groupId) lines.push(meta.text("Library", `Group ${item.groupId}`, { icon: Icons.person }));
  if (item.dateAdded) {
    lines.push(
      meta.text("Added", new Date(item.dateAdded).toLocaleDateString("en", { dateStyle: "medium" }), {
        icon: Icons.plus,
      }),
    );
  }
  return lines;
}

function itemMarkdown(item: ZItem): string {
  const abstract = item.fields.abstractNote?.trim();
  const short = abstract && abstract.length > 1200 ? `${abstract.slice(0, 1200).replace(/\s+\S*$/, "")}…` : abstract;
  return [
    `### ${(item.title || "Untitled").replace(/[#*_`[\]]/g, "\\$&")}`,
    "",
    `> ${apaCitation(item).replace(/[*_`[\]]/g, "\\$&")}`,
    ...(short ? ["", "**Abstract**", "", short] : []),
  ].join("\n");
}

function itemActions(item: ZItem, kind: Kind): Action[] {
  const pdf = mainPdf(item);
  const f = item.fields;
  const link = doiUrl(f.DOI) ?? f.url;
  const citation = apaCitation(item);
  return [
    open(selectUrl(item), "Show in Zotero", { icon: Icons.external }),
    ...(pdf
      ? [
        open(openPdfUrl(item, pdf), "Open PDF in Zotero", { icon: Icons.file, shortcut: "<Ctrl>o" }),
        ...(pdf.path
          ? [open(pdf.path, "Open PDF in Default App", { icon: Icons.file, shortcut: "<Ctrl><Shift>o" })]
          : []),
      ]
      : []),
    copy(citation, "Copy Citation", { shortcut: "<Ctrl><Shift>c", section: "Cite", icon: Icons.copy }),
    paste(citation, "Paste Citation", { shortcut: "<Ctrl><Shift>v", section: "Cite" }),
    copy(inTextCitation(item), "Copy In-Text Citation", { section: "Cite" }),
    action("Copy BibTeX", async () => {
      // Zotero's own export when the local API is on; the built one otherwise.
      const text = (kind === "api" ? await apiBibtex(item) : undefined) ?? bibtex(item);
      return close(await copyText(text, "BibTeX copied"));
    }, { icon: Icons.braces, shortcut: "<Ctrl>b", section: "Cite" }),
    copy(citationKey(item), "Copy Citation Key", { section: "Cite" }),
    ...(link
      ? [
        open(link, f.DOI ? "Open DOI" : "Open URL", { icon: Icons.globe, section: "Links" }),
        copy(link, f.DOI ? "Copy DOI Link" : "Copy URL", { icon: Icons.link, section: "Links" }),
      ]
      : []),
    copy(selectUrl(item), "Copy Zotero Link", { icon: Icons.link, section: "Links" }),
    copy(item.title, "Copy Title", { section: "Links" }),
    ...item.attachments.filter((a) => a !== pdf && a.path).slice(0, 3).map((a) =>
      open(a.path!, `Open “${a.title.length > 30 ? `${a.title.slice(0, 29)}…` : a.title}”`, {
        icon: Icons.file,
        section: "Attachments",
      })
    ),
  ];
}

async function copyText(text: string, message: string): Promise<string> {
  await clipboard.write(text);
  return message;
}

export function zoteroItem(item: ZItem, kind: Kind): Item {
  const pdf = mainPdf(item);
  const y = year(item);
  const who = creatorSummary(item);
  return {
    id: `${item.groupId ?? 0}/${item.key}`,
    title: item.title || "Untitled",
    subtitle: [who, publication(item)].filter(Boolean).join(" · ") || undefined,
    icon: { source: TYPE_ICONS[item.itemType] ?? Icons.file, tint: item.itemType === "book" ? "orange" : "blue" },
    accessories: [
      ...item.tags.slice(0, 1).map((t) => ({ tag: t, color: "orange" as const })),
      ...(pdf ? [{ icon: { source: Icons.file, tint: "red" as const }, tooltip: "PDF attached" }] : []),
      ...(y ? [{ text: y, tooltip: displayDate(item.fields.date) }] : []),
    ],
    detail: { markdown: itemMarkdown(item), metadata: itemMetadata(item) },
    actions: itemActions(item, kind),
  };
}

export async function setupItems(e: SetupError): Promise<Item[]> {
  const osRelease = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const enable = [
    "**Turn on Zotero's local API** (Zotero 7): **Edit → Settings → Advanced → Miscellaneous →",
    "Allow other applications on this computer to communicate with Zotero**. Backslash then searches",
    "through Zotero while it runs.",
  ];
  if (e.reason === "no-sqlite") {
    return [{
      id: "setup",
      title: "Turn on Zotero's local API, or install sqlite3",
      subtitle: "Zotero 7 → Settings → Advanced → Allow other applications…",
      icon: { source: Icons.plug, tint: "orange" },
      detail: {
        markdown: [
          "## Connect Zotero",
          "",
          ...enable,
          "",
          "**Or install sqlite3** to read your library even when Zotero is closed:",
          "",
          `\`${sqliteInstall(osRelease)}\``,
        ].join("\n"),
      },
      actions: [
        copy(sqliteInstall(osRelease), "Copy Install Command"),
        open("zotero://select/library", "Open Zotero", { icon: Icons.external }),
      ],
    }];
  }
  return [{
    id: "setup",
    title: "No Zotero library found",
    subtitle: "Backslash reads ~/Zotero, Zotero's default data directory",
    icon: { source: Icons.book, tint: "orange" },
    detail: {
      markdown: [
        "## No Zotero library",
        "",
        "Zotero keeps its library in **~/Zotero** unless you moved it (Settings → Advanced → Files and Folders).",
        "Backslash reads that folder only.",
        "",
        ...enable,
      ].join("\n"),
    },
    actions: [open("https://www.zotero.org/download/", "Download Zotero", { icon: Icons.download })],
  }];
}

/** `ID` and `ID_LIKE` from /etc/os-release, to pick the package manager. */
export function sqliteInstall(osRelease: string): string {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(osRelease)?.[1]?.replace(/["']/g, "") ?? "";
  const ids = `${get("ID")} ${get("ID_LIKE")}`.toLowerCase().split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros"].includes(i))) return "sudo pacman -S sqlite";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "sudo dnf install sqlite";
  if (ids.some((i) => ["opensuse", "suse", "opensuse-tumbleweed"].includes(i))) return "sudo zypper install sqlite3";
  if (ids.includes("alpine")) return "sudo apk add sqlite";
  return "sudo apt install sqlite3";
}
