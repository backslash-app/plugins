import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  cardsOf,
  components,
  dedupe,
  emailWithName,
  expandHome,
  formatAddress,
  HOSTS,
  hrefIn,
  initials,
  isAddressBook,
  isAllowedHost,
  multigetXml,
  nextBirthday,
  normalizeServer,
  parseBirthday,
  parseCard,
  parseMultistatus,
  parseProperty,
  parseVcf,
  parseXml,
  telUri,
  typeLabel,
  unfold,
  upcomingBirthdays,
} from "./lib.ts";

const V3 = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "PRODID:-//Apple Inc.//iPhone OS 17.0//EN",
  "N:Lovelace;Ada;King;Countess;",
  "FN:Ada Lovelace",
  "ORG:Analytical Engines Ltd;Research",
  "TITLE:Mathematician",
  "item1.EMAIL;type=INTERNET;type=WORK;type=pref:ada@engines.example",
  "EMAIL;TYPE=HOME:ada@home.example",
  "TEL;type=CELL;type=VOICE;type=pref:+33 6 12 34 56 78",
  "TEL;TYPE=WORK,VOICE:(555) 010-2000",
  "item2.ADR;type=HOME;type=pref:;;12 St James's Square\\nFlat 3;London;;SW1Y 4JH;United Kingdom",
  "BDAY;VALUE=date:1815-12-10",
  "NOTE:Met at the Babbage lecture\\, 1833.\\nWrites notes.",
  "URL:https://ada.example",
  "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ",
  " AAAQABAAD",
  "UID:6E1B4E3A-1D2C-4C7B-9E1B-ADA",
  "END:VCARD",
].join("\r\n");

const V4 = `BEGIN:VCARD
VERSION:4.0
FN:Grace Hopper
N:Hopper;Grace;;;
EMAIL;TYPE=work;PREF=1:grace@navy.example
TEL;VALUE=uri;TYPE="voice,cell":tel:+1-555-555-0100
BDAY:--1209
PHOTO:https://photos.example/grace.jpg
UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1
END:VCARD`;

const V21 = `BEGIN:VCARD
VERSION:2.1
N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Fran=C3=A7ois;Ren=C3=A9;;;
FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ren=C3=A9 Fran=C3=A7ois
TEL;CELL:0612345678
END:VCARD`;

Deno.test("property lines", () => {
  assertEquals(parseProperty("item1.EMAIL;type=INTERNET;type=WORK:a@b.c"), {
    group: "item1",
    name: "EMAIL",
    params: { TYPE: ["INTERNET", "WORK"] },
    value: "a@b.c",
  });
  assertEquals(parseProperty('TEL;TYPE="voice,cell":tel:+1')?.params.TYPE, ["voice", "cell"]);
  assertEquals(parseProperty("TEL;WORK;VOICE:1")?.params.TYPE, ["WORK", "VOICE"]);
  assertEquals(components(String.raw`Lovelace;Ada\; Countess;;`), ["Lovelace", "Ada; Countess", "", ""]);
  assertEquals(unfold("NOTE:a\r\n b\r\n\tc\r\nFN:x"), ["NOTE:abc", "FN:x"]);
});

Deno.test("vCard 3.0 from an iPhone", () => {
  const c = parseCard(V3, "iCloud");
  assertEquals(c.id, "6E1B4E3A-1D2C-4C7B-9E1B-ADA");
  assertEquals(c.name, "Ada Lovelace");
  assertEquals([c.given, c.family], ["Ada", "Lovelace"]);
  assertEquals(c.org, "Analytical Engines Ltd · Research");
  assertEquals(c.title, "Mathematician");
  assertEquals(c.emails.map((e) => e.value), ["ada@engines.example", "ada@home.example"]);
  assertEquals(c.emails[0].types, ["work", "pref"]);
  assertEquals(c.phones[0], { value: "+33 6 12 34 56 78", types: ["cell", "voice", "pref"] });
  assertEquals(typeLabel(c.phones[0].types), "Mobile");
  assertEquals(formatAddress(c.addresses[0]), "12 St James's Square\nFlat 3\nSW1Y 4JH London\nUnited Kingdom");
  assertEquals(c.birthday, { year: 1815, month: 12, day: 10 });
  assertEquals(c.note, "Met at the Babbage lecture, 1833.\nWrites notes.");
  assertEquals(c.urls, ["https://ada.example"]);
  assertEquals(c.photoData, { type: "image/jpeg", base64: "/9j/4AAQSkZJRgABAQAAAQABAAD" });
  assertEquals(c.vcard.includes("PHOTO"), false);
  assertEquals(c.vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0"), true);
});

Deno.test("vCard 4.0 and 2.1", () => {
  const g = parseCard(V4);
  assertEquals(g.emails[0], { value: "grace@navy.example", types: ["work", "pref"] });
  assertEquals(g.phones[0].value, "+1-555-555-0100");
  assertEquals(g.birthday, { month: 12, day: 9 });
  assertEquals(g.photoUrl, "https://photos.example/grace.jpg");
  const r = parseCard(V21);
  assertEquals(r.name, "René François");
  assertEquals(r.family, "François");
  assertEquals(r.phones[0], { value: "0612345678", types: ["cell"] });
  const noName = parseCard("BEGIN:VCARD\nVERSION:3.0\nORG:ACME\nEMAIL:hi@acme.example\nEND:VCARD", "", "x.vcf");
  assertEquals([noName.name, noName.id], ["ACME", "x.vcf"]);
  assertEquals(parseVcf(`${V3}\r\n${V4}\n${V21}`, "export").map((c) => c.name), [
    "Ada Lovelace",
    "Grace Hopper",
    "René François",
  ]);
  const dataUri = parseCard("BEGIN:VCARD\nFN:X\nPHOTO:data:image/png;base64,iVBORw0KGgo=\nEND:VCARD");
  assertEquals(dataUri.photoData, { type: "image/png", base64: "iVBORw0KGgo=" });
});

Deno.test("birthdays", () => {
  assertEquals(parseBirthday("19850412"), { year: 1985, month: 4, day: 12 });
  assertEquals(parseBirthday("--04-12"), { month: 4, day: 12 });
  assertEquals(parseBirthday("1604-04-12"), { month: 4, day: 12 });
  assertEquals(parseBirthday("1990-04-12", { "X-APPLE-OMIT-YEAR": ["1990"] }), { month: 4, day: 12 });
  assertEquals(parseBirthday("1985-04-12T00:00:00Z"), { year: 1985, month: 4, day: 12 });
  assertEquals(parseBirthday("soon"), undefined);
  const today = new Date(2026, 9, 28);
  assertEquals(nextBirthday({ year: 1985, month: 11, day: 1 }, today).days, 4);
  assertEquals(nextBirthday({ year: 1985, month: 11, day: 1 }, today).age, 41);
  assertEquals(nextBirthday({ month: 10, day: 28 }, today).days, 0);
  assertEquals(nextBirthday({ month: 10, day: 27 }, today).date.getFullYear(), 2027);
  assertEquals(nextBirthday({ month: 2, day: 29 }, new Date(2027, 0, 1)).date.getDate(), 28);
  const people = [
    parseCard("BEGIN:VCARD\nFN:Later\nBDAY:2000-11-20\nEND:VCARD"),
    parseCard("BEGIN:VCARD\nFN:Soon\nBDAY:--1030\nEND:VCARD"),
    parseCard("BEGIN:VCARD\nFN:Far\nBDAY:2000-03-01\nEND:VCARD"),
  ];
  assertEquals(upcomingBirthdays(people, today).map((b) => [b.contact.name, b.days]), [["Soon", 2], ["Later", 23]]);
});

Deno.test("formatting", () => {
  assertEquals(telUri("+33 6 12-34.56 78"), "tel:+33612345678");
  assertEquals(initials("Ada King Lovelace"), "AL");
  assertEquals(emailWithName(parseCard(V3)), "Ada Lovelace <ada@engines.example>");
  assertEquals(typeLabel(["work", "fax"]), "Work · Fax");
  assertEquals(typeLabel(["voice", "x-custom"]), "");
  assertEquals(dedupe([parseCard(V3), parseCard(V3, "file")]).length, 1);
});

const PRINCIPAL = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">
 <d:response>
  <d:href>/remote.php/dav/</d:href>
  <d:propstat><d:prop><d:current-user-principal><d:href>/remote.php/dav/principals/users/ada/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  <d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
 </d:response>
</d:multistatus>`;

const BOOKS = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <response><href>/dav/addressbooks/user/ada@fastmail.example/</href>
    <propstat><prop><resourcetype><collection/></resourcetype><displayname/></prop><status>HTTP/1.1 200 OK</status></propstat></response>
  <response><href>/dav/addressbooks/user/ada@fastmail.example/Default/</href>
    <propstat><prop><resourcetype><collection/><C:addressbook/></resourcetype><displayname>Personal &amp; Work</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;

const REPORT = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
 <d:response><d:href>/remote.php/dav/addressbooks/users/ada/contacts/a.vcf</d:href>
  <d:propstat><d:prop><d:getetag>&quot;abc&quot;</d:getetag><card:address-data>BEGIN:VCARD&#13;
VERSION:3.0&#13;
FN:Charles Babbage&#13;
EMAIL:charles@engines.example&#13;
END:VCARD&#13;
</card:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/addressbooks/users/ada/contacts/b.vcf</d:href>
  <d:propstat><d:prop><d:getetag>"def"</d:getetag><card:address-data><![CDATA[BEGIN:VCARD
VERSION:4.0
FN:Grace <Hopper>
END:VCARD]]></card:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

Deno.test("WebDAV multistatus", () => {
  const [p] = parseMultistatus(PRINCIPAL);
  assertEquals(hrefIn(p.props["current-user-principal"]), "/remote.php/dav/principals/users/ada/");
  assertEquals(p.props.resourcetype, undefined);
  const books = parseMultistatus(BOOKS);
  assertEquals(books.map(isAddressBook), [false, true]);
  assertEquals(books[1].props.displayname.text, "Personal & Work");
  const cards = cardsOf(REPORT, "Contacts");
  assertEquals(cards.map((c) => c.name), ["Charles Babbage", "Grace <Hopper>"]);
  assertEquals(cards[0].emails[0].value, "charles@engines.example");
  assertEquals(cards[0].source, "Contacts");
  assertEquals(parseXml("<a x='1'><b/>t&lt;</a>").children[0].attrs.x, "1");
  assertEquals(multigetXml(["/a&b.vcf"]).includes("<d:href>/a&amp;b.vcf</d:href>"), true);
});

Deno.test("servers, folders and hosts match the manifest", async () => {
  assertEquals(normalizeServer("cloud.home.lan/remote.php/dav"), "https://cloud.home.lan/remote.php/dav/");
  assertEquals(expandHome("~/Contacts", "/home/ada"), "/home/ada/Contacts");
  assertEquals(isAllowedHost("p42-contacts.icloud.com"), true);
  assertEquals(isAllowedHost("contacts.icloud.com"), true);
  assertEquals(isAllowedHost("192.168.1.10"), true);
  assertEquals(isAllowedHost("dav.example.com"), false);
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});
