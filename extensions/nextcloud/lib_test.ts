import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  absoluteUrl,
  basicAuth,
  type DeckBoard,
  deckCards,
  type DeckStack,
  dueBucket,
  dueText,
  encodePath,
  fileGlyph,
  filesWebUrl,
  freePath,
  normalizeUrl,
  type Note,
  noteBody,
  noteSnippet,
  ocsData,
  parentOf,
  parseMultistatus,
  providerGlyph,
  searchableProviders,
  sortCards,
  sortEntries,
  sortNotes,
} from "./lib.ts";

// PROPFIND Depth: 1 on /remote.php/dav/files/alice/, Nextcloud 30.
const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/alice/</d:href>
  <d:propstat><d:prop><d:getlastmodified>Mon, 28 Oct 2026 09:00:00 GMT</d:getlastmodified><d:resourcetype><d:collection/></d:resourcetype><oc:size>5242880</oc:size><oc:fileid>2</oc:fileid></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/alice/Photos%20%C3%A9t%C3%A9/</d:href>
  <d:propstat>
   <d:prop>
    <d:getlastmodified>Sun, 27 Oct 2026 18:12:45 GMT</d:getlastmodified>
    <d:resourcetype><d:collection/></d:resourcetype>
    <d:getetag>&quot;671e8a3d5b1c2&quot;</d:getetag>
    <oc:fileid>153</oc:fileid>
    <oc:size>4194304</oc:size>
    <oc:favorite>1</oc:favorite>
    <oc:permissions>RGDNVCK</oc:permissions>
    <oc:share-types><oc:share-type>3</oc:share-type></oc:share-types>
    <nc:has-preview>false</nc:has-preview>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
  <d:propstat><d:prop><d:getcontentlength/><d:getcontenttype/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/alice/Rapport%202026.pdf</d:href>
  <d:propstat>
   <d:prop>
    <d:getlastmodified>Fri, 25 Oct 2026 07:30:00 GMT</d:getlastmodified>
    <d:getcontentlength>1048576</d:getcontentlength>
    <d:getcontenttype>application/pdf</d:getcontenttype>
    <d:resourcetype/>
    <d:getetag>"abc123"</d:getetag>
    <oc:fileid>210</oc:fileid>
    <oc:size>1048576</oc:size>
    <oc:favorite>0</oc:favorite>
    <oc:owner-display-name>Alice &amp; Bob</oc:owner-display-name>
    <oc:share-types/>
    <nc:has-preview>true</nc:has-preview>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/alice/10.txt</d:href>
  <d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/alice/2.txt</d:href>
  <d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
</d:multistatus>`;

Deno.test("manifest allows the server's own address", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  // Nextcloud servers live on arbitrary public domains: see the manifest's comment.
  assertEquals(manifest.permissions.net, ["*"]);
  for (const c of manifest.commands) {
    assert((await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url))).isFile);
  }
});

Deno.test("addresses and auth", () => {
  assertEquals(normalizeUrl("cloud.example.com"), "https://cloud.example.com");
  assertEquals(
    normalizeUrl("https://example.com/nextcloud/index.php/apps/files/?dir=/"),
    "https://example.com/nextcloud",
  );
  assertEquals(normalizeUrl("http://192.168.1.5:8080/apps/dashboard/"), "http://192.168.1.5:8080");
  assertEquals(normalizeUrl(""), "");
  assertEquals(basicAuth("alice", "pässword"), `Basic ${btoa("alice:pÃ¤ssword")}`);
  assertEquals(
    absoluteUrl("https://c.example.com/nc", "/nc/index.php/f/12"),
    "https://c.example.com/nc/index.php/f/12",
  );
  assertEquals(absoluteUrl("https://c.example.com", "https://c.example.com/x"), "https://c.example.com/x");
  assertEquals(absoluteUrl("https://c.example.com", undefined), undefined);
});

Deno.test("OCS envelopes", () => {
  assertEquals(ocsData({ ocs: { meta: { status: "ok", statuscode: 200 }, data: { id: "alice" } } }), { id: "alice" });
  assertEquals(ocsData({ ocs: { meta: { status: "ok", statuscode: 100 }, data: 1 } }), 1);
  assertThrows(
    () =>
      ocsData({
        ocs: {
          meta: { status: "failure", statuscode: 404, message: "Wrong path, file/folder does not exist" },
          data: [],
        },
      }),
    Error,
    "Wrong path",
  );
});

Deno.test("WebDAV listing", () => {
  const all = parseMultistatus(MULTISTATUS, "/remote.php/dav/files/alice");
  assertEquals(all.map((e) => e.path), ["/", "/Photos été", "/Rapport 2026.pdf", "/10.txt", "/2.txt"]);
  const [, photos, pdf] = all;
  assertEquals(photos.folder, true);
  assertEquals(photos.size, 4194304);
  assertEquals(photos.favorite, true);
  assertEquals(photos.shared, true);
  assertEquals(photos.etag, "671e8a3d5b1c2");
  assertEquals(photos.mime, undefined);
  assertEquals(pdf.folder, false);
  assertEquals(pdf.fileId, 210);
  assertEquals(pdf.owner, "Alice & Bob");
  assertEquals(pdf.shared, false);
  assertEquals(pdf.hasPreview, true);
  assertEquals(pdf.modified, Date.parse("2026-10-25T07:30:00Z"));
  assertEquals(sortEntries(all.slice(1)).map((e) => e.name), ["Photos été", "2.txt", "10.txt", "Rapport 2026.pdf"]);
});

Deno.test("paths and links", () => {
  assertEquals(encodePath("/Photos été/IMG #1.jpg"), "Photos%20%C3%A9t%C3%A9/IMG%20%231.jpg");
  assertEquals(encodePath("/"), "");
  assertEquals(parentOf("/a/b/c.txt"), "/a/b");
  assertEquals(parentOf("/a"), "/");
  assertEquals(filesWebUrl("https://c", { path: "/a/b.pdf", fileId: 9, folder: false }), "https://c/index.php/f/9");
  assertEquals(
    filesWebUrl("https://c", { path: "/a b", folder: true }),
    "https://c/index.php/apps/files/?dir=%2Fa%20b",
  );
  assertEquals(fileGlyph({ folder: false, mime: "image/jpeg", name: "a.jpg" }).source, "bs-image");
  assertEquals(fileGlyph({ folder: true, name: "x", shared: true }).tint, "teal");
  assertEquals(fileGlyph({ folder: false, name: "notes.md" }).source, "bs-note");
  const taken = new Set(["/d/a.pdf"]);
  assertEquals(freePath("/d", "a.pdf", (p) => taken.has(p)), "/d/a (2).pdf");
});

Deno.test("unified search providers", () => {
  const list = searchableProviders([
    { id: "settings_apps", name: "Apps", order: -50 },
    { id: "notes", appId: "notes", name: "Notes", order: 30 },
    { id: "files", appId: "files", name: "Files", order: 5 },
    { id: "talk-message", name: "Messages", order: 20 },
  ]);
  assertEquals(list.map((p) => p.id), ["files", "talk-message", "notes"]);
  assertEquals(providerGlyph("talk-message").source, "bs-comment");
  assertEquals(providerGlyph("deck").source, "bs-kanban");
  assertEquals(providerGlyph("something-else").source, "bs-search");
});

Deno.test("notes", () => {
  const notes: Note[] = [
    {
      id: 1,
      title: "Groceries",
      category: "",
      content: "Groceries\n\n- milk\n- **eggs**",
      favorite: false,
      modified: 100,
    },
    { id: 2, title: "Ideas", category: "Work", content: "# Ideas\nLauncher plugins", favorite: true, modified: 50 },
    { id: 3, title: "Old", category: "Work", content: "Something else first", favorite: false, modified: 10 },
  ];
  assertEquals(sortNotes(notes).map((n) => n.id), [2, 1, 3]);
  assertEquals(noteBody(notes[0]), "- milk\n- **eggs**");
  assertEquals(noteSnippet(notes[0]), "milk");
  assertEquals(noteBody(notes[1]), "Launcher plugins");
  assertEquals(noteBody(notes[2]), "Something else first");
});

Deno.test("deck cards", () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  const board: DeckBoard = { id: 4, title: "Home", color: "0082c9" };
  // `GET /index.php/apps/deck/api/v1.0/boards/4/stacks`.
  const stacks: DeckStack[] = [
    {
      id: 11,
      title: "Doing",
      boardId: 4,
      order: 1,
      cards: [
        {
          id: 101,
          title: "Fix the bike",
          stackId: 11,
          duedate: new Date(2026, 9, 26, 12).toISOString(),
          assignedUsers: [{ participant: { uid: "alice", displayname: "Alice" }, type: 0 }],
          labels: [{ id: 1, title: "Urgent", color: "ff7a66" }],
        },
        { id: 102, title: "Archived", stackId: 11, archived: true },
      ],
    },
    {
      id: 10,
      title: "To do",
      boardId: 4,
      order: 0,
      cards: [
        {
          id: 100,
          title: "Taxes",
          stackId: 10,
          duedate: new Date(2026, 9, 29, 17).toISOString(),
          assignedUsers: [{ participant: { uid: "alice", displayname: "Alice" } }],
        },
        { id: 103, title: "Paint", stackId: 10, assignedUsers: [{ participant: { uid: "bob", displayname: "Bob" } }] },
      ],
    },
    {
      id: 12,
      title: "Done",
      boardId: 4,
      order: 2,
      cards: [{ id: 104, title: "Old", stackId: 12, done: "2026-10-01T10:00:00+00:00" }],
    },
  ];
  const cards = deckCards(board, stacks, "alice");
  assertEquals(cards.map((c) => c.card.id), [100, 103, 101, 104]);
  assertEquals(cards[0].stacks.map((s) => s.title), ["To do", "Doing", "Done"]);
  assertEquals(cards.filter((c) => c.mine).map((c) => c.card.id), [100, 101]);
  assertEquals(cards.map((c) => dueBucket(c, now)), ["Tomorrow", "No Due Date", "Overdue", "Done"]);
  assertEquals(sortCards(cards, now).map((c) => c.card.id), [101, 100, 103, 104]);
  assertEquals(dueText(cards[2].due, now), "2 days overdue");
  assertEquals(dueText(cards[0].due, now), "tomorrow 17:00");
  assertEquals(dueText(new Date(2026, 10, 12).getTime(), now), "12 Nov");
});
