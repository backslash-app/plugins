import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { config, HOSTS, isAllowedHost, normalizeUrl, SetupError } from "./api.ts";
import {
  decodeWords,
  findCodes,
  findLinks,
  fromMailHog,
  fromMailpitMessage,
  fromMailpitSummary,
  htmlToText,
  messageMarkdown,
  messageText,
  parseAddresses,
  parseContentType,
  parseHeaders,
  parseMime,
  senderName,
  shortDate,
} from "./lib.ts";

// A signup confirmation as a framework sends it: multipart/alternative, quoted-printable HTML.
const RAW = [
  "Return-Path: <noreply@shop.test>",
  'From: "Shop =?UTF-8?Q?D=C3=A9mo?=" <noreply@shop.test>',
  "To: Ada Lovelace <ada@example.com>, bob@example.com",
  "Subject: =?UTF-8?B?Q29uZmlybWV6IHZvdHJlIGFkcmVzc2U=?=",
  "Date: Sat, 31 Oct 2026 11:58:03 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="mixed-1"',
  "",
  "This is a multi-part message in MIME format.",
  "--mixed-1",
  'Content-Type: multipart/alternative; boundary="alt-2"',
  "",
  "--alt-2",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Bonjour Ada,",
  "",
  "Votre code de v=C3=A9rification : 482 913",
  "",
  "Ou confirmez ici : https://shop.test/email/verify/42/ab12cd?expires=3D1761912000&signature=3Dde=",
  "adbeef",
  "--alt-2",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<html><head><style>p{color:red}</style></head><body><p>Bonjour Ada,</p><p>Code&nbsp;: <b>482913</b></p><a h=",
  'ref=3D"https://shop.test/email/verify/42/ab12cd?expires=3D1761912000&amp;signature=3Ddeadbeef">Confirmer l=E2=80=99adresse</a>',
  '<a href=3D"https://shop.test/unsubscribe">Se d=C3=A9sabonner</a></body></html>',
  "--alt-2--",
  "--mixed-1",
  'Content-Type: application/pdf; name="facture.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="facture.pdf"',
  "",
  "JVBERi0xLjQKJcOkw7zDtsOfCg==",
  "--mixed-1--",
  "",
].join("\r\n");

Deno.test("headers: encoded words, folding, content types", () => {
  assertEquals(decodeWords("=?UTF-8?B?Q29uZmlybWV6IHZvdHJlIGFkcmVzc2U=?="), "Confirmez votre adresse");
  assertEquals(decodeWords("=?iso-8859-1?Q?Caf=E9_cr=E8me?="), "Café crème");
  assertEquals(decodeWords("=?UTF-8?Q?a?= =?UTF-8?Q?b?= c"), "ab c");
  assertEquals(decodeWords("plain"), "plain");
  const h = parseHeaders("Subject: a long\r\n subject\r\nX-Twice: 1\r\nX-Twice: 2");
  assertEquals(h, { subject: "a long subject", "x-twice": "1" });
  assertEquals(parseContentType('text/html; charset="UTF-8"'), { type: "text/html", params: { charset: "UTF-8" } });
  assertEquals(parseContentType(undefined).type, "text/plain");
});

Deno.test("addresses", () => {
  assertEquals(parseAddresses('"Lovelace, Ada" <ada@example.com>, bob@example.com, <c@x.io>'), [
    { name: "Lovelace, Ada", address: "ada@example.com" },
    { address: "bob@example.com" },
    { name: undefined, address: "c@x.io" },
  ]);
  assertEquals(parseAddresses(""), []);
  assertEquals(senderName({ address: "noreply@shop.test" }), "noreply");
});

Deno.test("raw MIME: nested multiparts, quoted-printable, attachments", () => {
  const m = parseMime(RAW);
  assertEquals(m.headers.subject, "Confirmez votre adresse");
  assertEquals(m.headers.from, '"Shop Démo" <noreply@shop.test>');
  assert(m.text!.includes("Votre code de vérification : 482 913"));
  assert(m.text!.includes("expires=1761912000&signature=deadbeef"));
  assert(m.html!.includes("Confirmer l’adresse"));
  assertEquals(m.attachments, [{ name: "facture.pdf", type: "application/pdf", size: 19 }]);
  // A single part message, 8 bit.
  const plain = parseMime("Subject: Hi\nContent-Type: text/plain; charset=utf-8\n\nÇa marche, 1234 est ton code.\n");
  assertEquals(plain.text, "Ça marche, 1234 est ton code.\n");
  // Base64 HTML in latin-1.
  const latin = parseMime(
    "Content-Type: text/html; charset=iso-8859-1\nContent-Transfer-Encoding: base64\n\n" + btoa("<p>R\xe9sum\xe9</p>"),
  );
  assertEquals(latin.html, "<p>Résumé</p>");
});

Deno.test("codes and links of the message", () => {
  const m = parseMime(RAW);
  const msg = { text: m.text, html: m.html };
  assertEquals(findCodes(messageText(msg), m.headers.subject)[0].code, "482913");
  const links = findLinks(msg);
  assertEquals(links[0], {
    url: "https://shop.test/email/verify/42/ab12cd?expires=1761912000&signature=deadbeef",
    label: "Confirmer l’adresse",
    verify: true,
  });
  assert(links.some((l) => l.url === "https://shop.test/unsubscribe" && !l.verify));
  assertEquals(findCodes("Order #123456 shipped. Call 555-1234. © 2026", "Your order"), []);
  assertEquals(findCodes("", "Your login code: K7Q2XD")[0].code, "K7Q2XD");
  assertEquals(htmlToText("<style>x</style><p>A&amp;B</p><p>C</p>"), "A&B\nC");
});

// GET /api/v1/messages (Mailpit 1.21), one message.
const MAILPIT_LIST = {
  total: 2,
  unread: 1,
  count: 2,
  messages_count: 2,
  start: 0,
  tags: ["signup"],
  messages: [
    {
      ID: "J8nWm6tGXSiaLp9T4HcGQs",
      MessageID: "a1b2@shop.test",
      Read: false,
      From: { Name: "Shop Démo", Address: "noreply@shop.test" },
      To: [{ Name: "Ada Lovelace", Address: "ada@example.com" }],
      Cc: [],
      Bcc: [],
      ReplyTo: [],
      Subject: "Confirmez votre adresse",
      Created: "2026-10-31T11:58:03.123Z",
      Tags: ["signup"],
      Size: 2489,
      Attachments: 1,
      Snippet: "Bonjour Ada, Votre code de vérification : 482 913 Ou confirmez ici : https://shop.test/…",
    },
  ],
};

Deno.test("mailpit messages", () => {
  const s = fromMailpitSummary(MAILPIT_LIST.messages[0]);
  assertEquals([s.id, s.read, s.attachments, s.from?.name, s.to[0].address], [
    "J8nWm6tGXSiaLp9T4HcGQs",
    false,
    1,
    "Shop Démo",
    "ada@example.com",
  ]);
  assertEquals(findCodes(s.snippet!, s.subject)[0].code, "482913");
  const full = fromMailpitMessage({
    ...MAILPIT_LIST.messages[0],
    Read: true,
    Date: "2026-10-31T11:58:03Z",
    Text: "Code: 482913",
    HTML: "<p>Code: <b>482913</b></p>",
    Attachments: [{ PartID: "2", FileName: "facture.pdf", ContentType: "application/pdf", Size: 18 }],
  });
  assertEquals(full.files, [{ name: "facture.pdf", type: "application/pdf", size: 18, partId: "2" }]);
  assertEquals(full.attachments, 1);
  assert(messageMarkdown(full).includes("From **Shop Démo** <noreply@shop.test> to Ada Lovelace <ada@example.com>"));
});

Deno.test("mailhog messages", () => {
  const m = fromMailHog({
    ID: "kHq3x4Zq-1Fp5@mailhog.example",
    Created: "2026-10-31T11:58:03.123456789Z",
    Content: { Headers: { Subject: ["Confirmez votre adresse"] }, Body: "", Size: RAW.length },
    Raw: { From: "noreply@shop.test", To: ["ada@example.com", "bob@example.com"], Data: RAW },
  });
  assertEquals(m.subject, "Confirmez votre adresse");
  assertEquals(m.from, { name: "Shop Démo", address: "noreply@shop.test" });
  assertEquals(m.to.map((a) => a.address), ["ada@example.com", "bob@example.com"]);
  assertEquals([m.read, m.attachments, m.files[0].name], [true, 1, "facture.pdf"]);
  assert(m.snippet!.startsWith("Bonjour Ada, Votre code"));
  // Without Raw: built back from the parsed headers.
  const bare = fromMailHog({
    ID: "x",
    Content: {
      Headers: { Subject: ["Hi"], From: ["a@b.c"], "Content-Type": ["text/plain"] },
      Body: "Your code is 1234",
    },
  });
  assertEquals([bare.subject, bare.from?.address, bare.text], ["Hi", "a@b.c", "Your code is 1234"]);
});

Deno.test("addresses and configuration", () => {
  assertEquals(normalizeUrl(""), "http://localhost:8025");
  assertEquals(normalizeUrl("localhost:8025/#"), "http://localhost:8025");
  assertEquals(normalizeUrl("http://mail.lan/mailpit/view/abc"), "http://mail.lan/mailpit");
  assertEquals(normalizeUrl("http://localhost:8025/api/v1"), "http://localhost:8025");
  assertEquals(config({ address: "myapp.ddev.site:8025", kind: "Mailpit" }).kind, "mailpit");
  assertEquals(config({}).auth, undefined);
  assertEquals(config({ username: "dev", password: "pw" }).auth, `Basic ${btoa("dev:pw")}`);
  assertThrows(() => config({ address: "mail.example.com" }), SetupError, "outside the networks");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("shop.test"));
  assert(isAllowedHost("mail.app.localhost"));
  assert(isAllowedHost("172.17.0.2"));
  assert(!isAllowedHost("mailpit.example.org"));
});

Deno.test("dates", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(shortDate("2026-10-31T11:58:03Z", now), "1 min");
  assertEquals(shortDate("2026-10-31T11:59:30Z", now), "just now");
  assertEquals(shortDate("2026-10-12T08:00:00Z", now), "12 Oct");
  assertEquals(shortDate("", now), "");
});
