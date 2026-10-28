import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Client, ImapError, type Transport } from "./imap.ts";
import {
  type Account,
  accountsFrom,
  bodyText,
  capabilities,
  decodeWords,
  FETCH_ITEMS,
  Framer,
  parseAddress,
  parseDate,
  parseFetch,
  parseFolders,
  parseHeaders,
  parseMessage,
  parseServer,
  parseStatus,
  presetFor,
  PRESETS,
  preview,
  quote,
  replyUrl,
  searchUids,
  shortDate,
  specialFolder,
  tokenize,
  uidSet,
  unreadSubtitle,
  webmailUrl,
} from "./lib.ts";
import { accountErrorItem, messageItem, problemItem, setupItems } from "./views.ts";

const enc = new TextEncoder();
/** An IMAP literal: `{bytes}` CRLF and the text. */
const lit = (s: string) => `{${enc.encode(s).length}}\r\n${s}`;

// ---------------------------------------------------------------------------
// A transport replaying a recorded session: `C:` lines must be what the
// client sends, `S:` lines are what the server answers, delivered in small
// chunks so framing across reads is exercised.

type Step = { c: string } | { s: string | Uint8Array };

class Replay implements Transport {
  #steps: Step[];
  #out = "";
  closed = false;
  constructor(steps: Step[], private chunk = 7) {
    this.#steps = [...steps];
  }
  read(p: Uint8Array): Promise<number | null> {
    const step = this.#steps[0];
    if (!step) return Promise.resolve(null);
    if ("c" in step) throw new Error(`The client waits for an answer, but should send: ${step.c}`);
    const bytes = typeof step.s === "string" ? enc.encode(step.s) : step.s;
    const n = Math.min(this.chunk, bytes.length, p.length);
    p.set(bytes.subarray(0, n));
    const rest = bytes.subarray(n);
    if (rest.length) this.#steps[0] = { s: rest };
    else this.#steps.shift();
    return Promise.resolve(n);
  }
  write(p: Uint8Array): Promise<number> {
    this.#out += new TextDecoder().decode(p);
    let eol: number;
    while ((eol = this.#out.indexOf("\r\n")) >= 0) {
      const line = this.#out.slice(0, eol);
      this.#out = this.#out.slice(eol + 2);
      const step = this.#steps.shift();
      if (!step || !("c" in step)) throw new Error(`Unexpected client line: ${line}`);
      assertEquals(line, step.c);
    }
    return Promise.resolve(p.length);
  }
  close() {
    this.closed = true;
  }
  get done() {
    return this.#steps.length === 0;
  }
}

/** `C: …` / `S: …` lines; a server line may hold literals (CRLF inside). */
function transcript(...lines: string[]): Step[] {
  return lines.map((l) => (l.startsWith("C: ") ? { c: l.slice(3) } : { s: `${l.slice(3)}\r\n` }));
}

// ---------------------------------------------------------------------------
// Recorded sessions

const GMAIL_HEADERS_1 = [
  "From: =?UTF-8?B?w4lsZWN0cmljaXTDqQ==?= de France <factures@edf.fr>",
  "Subject: =?UTF-8?Q?Votre_facture_d=E2=80=99octobre?=",
  "Date: Tue, 27 Oct 2026 18:02:09 +0000",
  "Message-ID: <20261027180209.4F2A@edf.fr>",
  'Content-Type: multipart/alternative; boundary="b1_9f3"',
  "",
  "",
].join("\r\n");
const GMAIL_BODY_1 = [
  "--b1_9f3",
  'Content-Type: text/plain; charset="utf-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Bonjour Ada,=0D",
  "Votre facture d=E2=80=99octobre est disponible : 64,20 =E2=82=AC, pr=C3=A9l=",
  "ev=C3=A9e le 5 novembre.",
  "",
  "--b1_9f3",
  'Content-Type: text/html; charset="utf-8"',
  "",
  "<p>Bonjour Ada</p>",
].join("\r\n");

const GMAIL_HEADERS_2 = [
  "From: Grace Hopper <grace@navy.example>",
  "Subject: Re: Compiler meeting",
  "Date: Wed, 28 Oct 2026 08:15:00 -0400",
  "Message-ID: <CAF+abc123@mail.gmail.com>",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "",
].join("\r\n");
const GMAIL_BODY_2 = [
  "Works for me, see you at 10.",
  "",
  "On Tue, Oct 27, 2026 at 5:00 PM Ada <ada@gmail.com> wrote:",
  "> Shall we meet tomorrow?",
  "",
  "-- ",
  "Grace",
].join("\r\n");

const GMAIL = transcript(
  "S: * OK Gimap ready for requests from 203.0.113.9 x5mb12345687abc",
  "C: A1 CAPABILITY",
  "S: * CAPABILITY IMAP4rev1 UNSELECT IDLE NAMESPACE QUOTA ID XLIST CHILDREN X-GM-EXT-1 XYZZY SASL-IR AUTH=XOAUTH2 AUTH=PLAIN AUTH=PLAIN-CLIENTTOKEN AUTH=OAUTHBEARER AUTH=XOAUTH",
  "S: A1 OK Thats all she wrote! x5mb12345687abc",
  `C: A2 AUTHENTICATE PLAIN ${btoa("\0ada@gmail.com\0abcd efgh ijkl mnop")}`,
  "S: * CAPABILITY IMAP4rev1 UNSELECT IDLE NAMESPACE QUOTA ID XLIST CHILDREN X-GM-EXT-1 UIDPLUS COMPRESS=DEFLATE ENABLE MOVE CONDSTORE ESEARCH UTF8=ACCEPT LIST-EXTENDED LIST-STATUS LITERAL- SPECIAL-USE APPENDLIMIT=35651584",
  "S: A2 OK ada@gmail.com authenticated (Success)",
  "C: A3 EXAMINE INBOX",
  "S: * FLAGS (\\Answered \\Flagged \\Draft \\Deleted \\Seen $NotPhishing $Phishing)",
  "S: * OK [PERMANENTFLAGS ()] Flags permitted.",
  "S: * OK [UIDVALIDITY 1] UIDs valid.",
  "S: * 1203 EXISTS",
  "S: * 0 RECENT",
  "S: * OK [UIDNEXT 88213] Predicted next UID.",
  "S: A3 OK [READ-ONLY] INBOX selected. (Success)",
  "C: A4 UID SEARCH UNSEEN",
  "S: * SEARCH 88190 88207",
  "S: A4 OK SEARCH completed (Success)",
  `C: A5 UID FETCH 88190,88207 ${FETCH_ITEMS}`,
  `S: * 1199 FETCH (UID 88190 FLAGS () INTERNALDATE "27-Oct-2026 18:02:11 +0000" RFC822.SIZE 48213 ENVELOPE ("Tue, 27 Oct 2026 18:02:09 +0000" "=?UTF-8?Q?Votre_facture_d=E2=80=99octobre?=" (("=?UTF-8?B?w4lsZWN0cmljaXTDqQ==?= de France" NIL "factures" "edf.fr")) (("=?UTF-8?B?w4lsZWN0cmljaXTDqQ==?= de France" NIL "factures" "edf.fr")) (("=?UTF-8?B?w4lsZWN0cmljaXTDqQ==?= de France" NIL "factures" "edf.fr")) ((NIL NIL "ada" "gmail.com")) NIL NIL NIL "<20261027180209.4F2A@edf.fr>") BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] ${
    lit(GMAIL_HEADERS_1)
  } BODY[TEXT]<0> ${lit(GMAIL_BODY_1)})`,
  `S: * 1203 FETCH (UID 88207 FLAGS (\\Flagged) INTERNALDATE "28-Oct-2026 12:15:02 +0000" RFC822.SIZE 5120 ENVELOPE ("Wed, 28 Oct 2026 08:15:00 -0400" "Re: Compiler meeting" (("Grace Hopper" NIL "grace" "navy.example")) (("Grace Hopper" NIL "grace" "navy.example")) (("Grace Hopper" NIL "grace" "navy.example")) (("Ada Lovelace" NIL "ada" "gmail.com") (NIL NIL "team" "navy.example")) NIL NIL "<CAEx1@mail.gmail.com>" "<CAF+abc123@mail.gmail.com>") BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] ${
    lit(GMAIL_HEADERS_2)
  } BODY[TEXT]<0> ${lit(GMAIL_BODY_2)})`,
  "S: A5 OK Success",
  "C: A6 LOGOUT",
  "S: * BYE LOGOUT Requested",
  "S: A6 OK 73 good day (Success)",
);

Deno.test("a recorded Gmail session: sign in with AUTHENTICATE PLAIN and SASL-IR, unread messages", async () => {
  const t = new Replay(GMAIL);
  const c = new Client(t);
  await c.greeting();
  await c.login("ada@gmail.com", "abcd efgh ijkl mnop");
  assert(c.caps.has("MOVE"));
  const { total, messages } = await c.unread(30);
  await c.logout();
  assert(t.done);
  assertEquals(total, 2);
  assertEquals(messages.map((m) => m.uid), [88207, 88190]);
  const [grace, edf] = messages;
  assertEquals(grace.from, { name: "Grace Hopper", email: "grace@navy.example" });
  assertEquals(grace.subject, "Re: Compiler meeting");
  assertEquals(grace.preview, "Works for me, see you at 10.");
  assertEquals(grace.flags, ["\\Flagged"]);
  assertEquals(grace.to.map((a) => a.email), ["ada@gmail.com", "team@navy.example"]);
  assertEquals(grace.messageId, "<CAF+abc123@mail.gmail.com>");
  assertEquals(grace.date, Date.UTC(2026, 9, 28, 12, 15));
  assertEquals(edf.from, { name: "Électricité de France", email: "factures@edf.fr" });
  assertEquals(edf.subject, "Votre facture d’octobre");
  assertEquals(edf.preview, "Bonjour Ada, Votre facture d’octobre est disponible : 64,20 €, prélevée le 5 novembre.");
  assertEquals(edf.size, 48213);
});

Deno.test("a recorded Dovecot session: LOGIN with escaped quotes, greeting capabilities, archive with MOVE", async () => {
  const steps = transcript(
    "S: * OK [CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE LITERAL+ AUTH=LOGIN] Dovecot ready.",
    'C: A1 LOGIN "ada@example.org" "pa\\"ss\\\\word"',
    "S: A1 OK [CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE SORT THREAD=REFERENCES MULTIAPPEND UNSELECT CHILDREN NAMESPACE UIDPLUS LIST-EXTENDED I18NLEVEL=1 CONDSTORE QRESYNC ESEARCH SEARCHRES WITHIN CONTEXT=SEARCH LIST-STATUS BINARY MOVE SNIPPET=FUZZY SPECIAL-USE] Logged in",
    'C: A2 LIST "" "*"',
    '* LIST (\\HasNoChildren) "." INBOX'.replace(/^/, "S: "),
    'S: * LIST (\\HasNoChildren \\Archive) "." Archive',
    'S: * LIST (\\HasNoChildren \\Trash) "." Trash',
    'S: * LIST (\\HasNoChildren \\Sent) "." "Sent Messages"',
    "S: A2 OK List completed (0.001 + 0.000 secs).",
    "C: A3 SELECT INBOX",
    "S: * 12 EXISTS",
    "S: A3 OK [READ-WRITE] Select completed (0.001 + 0.000 secs).",
    'C: A4 UID MOVE 41:42 "Archive"',
    "S: * OK [COPYUID 1690000000 41:42 7:8] Moved UIDs.",
    "S: * 11 EXPUNGE",
    "S: * 11 EXPUNGE",
    "S: A4 OK Move completed (0.002 + 0.000 + 0.001 secs).",
  );
  const t = new Replay(steps, 5);
  const c = new Client(t);
  await c.greeting();
  await c.login("ada@example.org", 'pa"ss\\word');
  assertEquals(await c.moveTo([42, 41], "archive"), "Archive");
  assert(t.done);
});

Deno.test("no MOVE: copy to the trash, flag deleted and expunge; non-ASCII password as a literal", async () => {
  const steps = transcript(
    "S: * OK IMAP4rev1 Service Ready",
    "C: A1 CAPABILITY",
    "S: * CAPABILITY IMAP4rev1 IDLE",
    "S: A1 OK CAPABILITY completed",
    'C: A2 LOGIN "rene@example.fr" {10}',
    "S: + Ready for literal data",
    "C: mot2passé",
    "S: A2 OK LOGIN completed",
    "C: A3 CAPABILITY",
    "S: * CAPABILITY IMAP4rev1 IDLE CHILDREN",
    "S: A3 OK CAPABILITY completed",
    'C: A4 LIST "" "*"',
    'S: * LIST (\\HasChildren) "/" INBOX',
    'S: * LIST (\\HasNoChildren) "/" "Deleted Messages"',
    "S: A4 OK LIST completed",
    "C: A5 SELECT INBOX",
    "S: A5 OK [READ-WRITE] SELECT completed",
    'C: A6 UID COPY 7 "Deleted Messages"',
    "S: A6 OK COPY completed",
    "C: A7 UID STORE 7 +FLAGS.SILENT (\\Deleted)",
    "S: A7 OK STORE completed",
    "C: A8 EXPUNGE",
    "S: * 3 EXPUNGE",
    "S: A8 OK EXPUNGE completed",
  );
  const t = new Replay(steps);
  const c = new Client(t);
  await c.greeting();
  await c.login("rene@example.fr", "mot2passé");
  assertEquals(await c.moveTo([7], "trash"), "Deleted Messages");
  assert(t.done);
});

Deno.test("AUTHENTICATE PLAIN without SASL-IR answers the continuation; a refusal is an auth error", async () => {
  const token = btoa("\0bob@fastmail.com\0wrong");
  const steps = transcript(
    "S: * OK [CAPABILITY IMAP4rev1 LITERAL+ ID ENABLE AUTH=PLAIN] Fastmail IMAP4rev1 3.9.0",
    "C: A1 AUTHENTICATE PLAIN",
    "S: + ",
    `C: ${token}`,
    "S: A1 NO [AUTHENTICATIONFAILED] Authentication failed",
  );
  const c = new Client(new Replay(steps));
  await c.greeting();
  const e = await assertRejects(() => c.login("bob@fastmail.com", "wrong"), ImapError, "Authentication failed");
  assertEquals((e as ImapError).kind, "auth");
});

Deno.test("mark read selects the inbox and stores \\Seen silently", async () => {
  const steps = transcript(
    "C: A1 SELECT INBOX",
    "S: A1 OK [READ-WRITE] done",
    "C: A2 UID STORE 3,5:7 +FLAGS.SILENT (\\Seen)",
    "S: A2 OK done",
  );
  const t = new Replay(steps);
  await new Client(t).markRead([7, 3, 6, 5]);
  assert(t.done);
});

Deno.test("a BYE or a closed connection fails clearly", async () => {
  const c = new Client(new Replay(transcript("S: * BYE Too many connections from your IP")));
  await assertRejects(() => c.greeting(), ImapError, "Too many connections");
  const d = new Client(new Replay(transcript("S: * OK ready", "C: A1 NOOP")));
  await d.greeting();
  await assertRejects(() => d.command("NOOP"), ImapError, "closed");
});

// ---------------------------------------------------------------------------
// Parsing

Deno.test("framer: lines and literals, across chunks", () => {
  const f = new Framer();
  const data = `* OK hi\r\n* 1 FETCH (BODY[TEXT] ${lit("a\r\nb")})\r\n* 2 EXISTS\r\nA1 OK`;
  const out: string[] = [];
  for (const ch of enc.encode(data)) {
    f.push(new Uint8Array([ch]));
    let line;
    while ((line = f.next()) !== undefined) out.push(line);
  }
  assertEquals(out, ["* OK hi", "* 1 FETCH (BODY[TEXT] {4}\r\na\r\nb)", "* 2 EXISTS"]);
  assertEquals(f.pending, 5);
});

Deno.test("tokenize: lists, quoted strings, NIL, sections and literals", () => {
  assertEquals(
    tokenize('* 1 FETCH (UID 9 FLAGS (\\Seen $Junk) BODY[HEADER.FIELDS (FROM)]<0> {3}\r\nabc X "a \\"b\\"" NIL)'),
    ["*", "1", "FETCH", [
      "UID",
      "9",
      "FLAGS",
      ["\\Seen", "$Junk"],
      "BODY[HEADER.FIELDS (FROM)]<0>",
      "abc",
      "X",
      'a "b"',
      null,
    ]],
  );
});

Deno.test("status lines, capabilities, search results", () => {
  assertEquals(parseStatus("A1 NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)"), {
    tag: "A1",
    status: "NO",
    code: "AUTHENTICATIONFAILED",
    text: "Invalid credentials (Failure)",
  });
  assertEquals(parseStatus("* OK Gimap ready")?.code, undefined);
  assert(capabilities(["* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] Ready"]).has("AUTH=PLAIN"));
  assertEquals(searchUids(["* SEARCH 4 8 15", "* SEARCH"]), [4, 8, 15]);
});

Deno.test("fetch without an envelope falls back on the headers", () => {
  const headers =
    'From: "Lovelace, Ada" <ada@example.org>\r\nSubject: =?iso-8859-1?Q?R=E9union?=\r\n =?iso-8859-1?Q?_demain?=\r\nDate: 3 Nov 2026 09:00 +0100\r\n\r\n';
  const f = parseFetch(`* 4 FETCH (UID 77 FLAGS (\\Recent) BODY[HEADER.FIELDS (FROM SUBJECT DATE)] ${lit(headers)})`)!;
  const m = parseMessage(f)!;
  assertEquals(m.from, { name: "Lovelace, Ada", email: "ada@example.org" });
  assertEquals(m.subject, "Réunion demain");
  assertEquals(m.date, Date.UTC(2026, 10, 3, 8, 0));
  assertEquals(m.preview, "");
  assertEquals(parseMessage({ FLAGS: [] }), undefined);
});

Deno.test("decodeWords: B and Q, charsets, adjacent words, raw UTF-8", () => {
  assertEquals(decodeWords("=?UTF-8?B?8J+OiSBTb2xkZXM=?= -50%"), "🎉 Soldes -50%");
  assertEquals(decodeWords("=?utf-8?q?a?= =?utf-8?q?b?= c"), "ab c");
  assertEquals(decodeWords("=?windows-1252?Q?=93Hi=94?="), "“Hi”");
  assertEquals(decodeWords("Caf\xc3\xa9"), "Café");
  assertEquals(decodeWords("Caf\xe9"), "Café");
});

Deno.test("bodyText: base64 HTML, nested multipart, truncated parts", () => {
  const html = btoa("<html><head><style>p{}</style></head><body><p>Hello&nbsp;<b>you</b></p></body></html>");
  assertEquals(
    bodyText({ "content-type": "text/html", "content-transfer-encoding": "base64" }, html).trim().replace(/\s+/g, " "),
    "Hello you",
  );
  const nested = [
    "--outer",
    'Content-Type: multipart/alternative; boundary="inner"',
    "",
    "--inner",
    "Content-Type: text/plain; charset=iso-8859-1",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Ci-joint le devis sign=E9.",
    "--inner--",
    "--outer",
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQK",
  ].join("\r\n");
  assertEquals(
    bodyText({ "content-type": 'multipart/mixed; boundary="outer"' }, nested).trim(),
    "Ci-joint le devis signé.",
  );
  // Cut in the middle of a base64 part.
  assertEquals(
    bodyText({ "content-type": "text/plain", "content-transfer-encoding": "base64" }, "SGVsbG8gd29y"),
    "Hello wor",
  );
  assertEquals(bodyText({ "content-type": "image/png" }, "xx"), "");
});

Deno.test("preview skips quotes and signatures and shortens", () => {
  assertEquals(preview("Hi!\n\n> quoted\nLe 3 nov. 2026, Bob a écrit :\nThanks\n-- \nBob"), "Hi! Thanks");
  const long = preview("word ".repeat(100), 30);
  assert(long.length <= 31 && long.endsWith("…"));
});

Deno.test("headers, addresses and dates", () => {
  assertEquals(parseHeaders("Subject: a\r\n b\r\nFrom: x\r\nSubject: second"), { subject: "a b", from: "x" });
  assertEquals(parseAddress("bob@example.com (Bob)"), { name: "Bob", email: "bob@example.com" });
  assertEquals(parseAddress("<noreply@example.com>"), { name: undefined, email: "noreply@example.com" });
  assertEquals(parseDate("Tue, 27 Oct 2026 14:03:00 +0100"), Date.UTC(2026, 9, 27, 13, 3));
  assertEquals(parseDate("27-Oct-2026 14:03:00 -0700"), Date.UTC(2026, 9, 27, 21, 3));
  assertEquals(parseDate("Mon, 2 Nov 2026 10:00:00 GMT (UTC)"), Date.UTC(2026, 10, 2, 10));
  assertEquals(parseDate("garbage"), undefined);
});

Deno.test("folders: special use first, then usual names, never \\Noselect", () => {
  const gmail = parseFolders([
    '* LIST (\\HasNoChildren) "/" "INBOX"',
    '* LIST (\\HasChildren \\Noselect) "/" "[Gmail]"',
    '* LIST (\\All \\HasNoChildren) "/" "[Gmail]/All Mail"',
    '* LIST (\\HasNoChildren \\Trash) "/" "[Gmail]/Trash"',
  ]);
  assertEquals(specialFolder(gmail, "archive"), "[Gmail]/All Mail");
  assertEquals(specialFolder(gmail, "trash"), "[Gmail]/Trash");
  const plain = parseFolders(['* LIST () "." INBOX.Archive', '* LIST () "." {5}\r\nTrash']);
  assertEquals(specialFolder(plain, "archive"), "INBOX.Archive");
  assertEquals(specialFolder(plain, "trash"), "Trash");
  assertEquals(specialFolder([], "archive"), undefined);
});

Deno.test("quote and uid sets", () => {
  assertEquals(quote('a"b\\c'), '"a\\"b\\\\c"');
  assertEquals(quote("é"), undefined);
  assertEquals(uidSet([5, 1, 2, 3, 9, 10]), "1:3,5,9:10");
});

// ---------------------------------------------------------------------------
// Accounts

Deno.test("accounts: presets, guesses, custom servers, problems", () => {
  const { accounts, problems } = accountsFrom({
    provider1: "Gmail",
    email1: "ada@gmail.com",
    password1: "abcd efgh ijkl mnop",
    email2: "bob@hotmail.com",
    password2: "x",
    provider3: "custom",
    email3: "me@example.org",
    password3: "p",
    server3: "mail.example.org:143",
  });
  assertEquals(accounts.map((a) => [a.index, a.host, a.port, a.security]), [
    [1, "imap.gmail.com", 993, "tls"],
    [3, "mail.example.org", 143, "starttls"],
  ]);
  assertEquals(problems.length, 1);
  assertEquals(problems[0].preset.id, "outlook");
  assertEquals(accountsFrom({}).accounts, []);
  assertStringIncludes(
    accountsFrom({ provider1: "custom", email1: "a@b.c", password1: "x" }).problems[0].message,
    "IMAP server",
  );
  assertStringIncludes(accountsFrom({ email1: "a@icloud.com" }).problems[0].message, "password");
  assertEquals(presetFor("", "x@proton.me").port, 1143);
  assertEquals(presetFor("protonmail", "").security, "starttls");
  assertEquals(parseServer("imaps://IMAP.Example.com", PRESETS.custom), {
    host: "imap.example.com",
    port: 993,
    security: "tls",
  });
  assertEquals(parseServer("127.0.0.1:1143", PRESETS.custom).security, "starttls");
});

Deno.test("webmail and reply links", () => {
  const gmail = { preset: PRESETS.gmail, email: "ada@gmail.com" };
  assertEquals(
    webmailUrl(gmail, "<CAF+abc@mail.gmail.com>"),
    "https://mail.google.com/mail/u/ada%40gmail.com/#search/rfc822msgid%3ACAF%2Babc%40mail.gmail.com",
  );
  assertEquals(webmailUrl({ preset: PRESETS.custom, email: "x" }), undefined);
  assertEquals(
    replyUrl({ from: { email: "bob@example.com" }, subject: "Lunch?", messageId: "<1@x>" }),
    "mailto:bob@example.com?subject=Re%3A%20Lunch%3F&In-Reply-To=%3C1%40x%3E",
  );
  assertEquals(unreadSubtitle(5), "5 unread");
  assertEquals(unreadSubtitle(0), null);
});

Deno.test("short dates", () => {
  const now = new Date(2026, 9, 28, 15, 0).getTime();
  assertEquals(shortDate(new Date(2026, 9, 28, 9, 5).getTime(), now), "09:05");
  assertEquals(shortDate(new Date(2026, 9, 27, 22, 0).getTime(), now), "Yesterday");
  assertEquals(shortDate(new Date(2026, 3, 2).getTime(), now), "2 Apr");
  assertEquals(shortDate(new Date(2025, 3, 2).getTime(), now), "2 Apr 2025");
});

// ---------------------------------------------------------------------------
// Items

const ACCOUNT: Account = {
  index: 1,
  email: "ada@gmail.com",
  password: "x",
  preset: PRESETS.gmail,
  host: "imap.gmail.com",
  port: 993,
  security: "tls",
};

Deno.test("message item: sender avatar, preview, actions with a confirmed delete", () => {
  const item = messageItem(
    {
      uid: 9,
      flags: ["\\Flagged"],
      date: Date.now(),
      from: { name: "Grace Hopper", email: "grace@navy.example" },
      to: [{ email: "ada@gmail.com" }],
      subject: "Compiler",
      messageId: "<m1@x>",
      size: 2048,
      preview: "See you at 10",
      attachments: true,
    },
    ACCOUNT,
    { unreadUids: [9, 10], section: "ada@gmail.com · 2 unread" },
  );
  assertEquals(item.id, "1:9");
  assertEquals(item.subtitle, "Grace Hopper · See you at 10");
  assert(item.accessories?.some((a) => a.avatar === "Grace Hopper"));
  const titles = item.actions!.map((a) => a.title);
  assertEquals(titles.slice(0, 3), ["Open in Gmail", "Mark as Read", "Archive"]);
  assert(titles.includes("Mark All 2 as Read"));
  const del = item.actions!.find((a) => a.title === "Delete")!;
  assert(del.confirm && del.destructive);
  assertStringIncludes(item.detail!.markdown!, "See you at 10");
});

Deno.test("setup, problems and errors explain what to do", () => {
  assertEquals(setupItems()[0].id, "setup");
  const outlook = accountsFrom({ provider1: "outlook", email1: "a@outlook.com" }).problems[0];
  assertStringIncludes(problemItem(outlook).detail!.markdown!, "Microsoft 365 extension");
  const auth = accountErrorItem(ACCOUNT, new ImapError("[AUTHENTICATIONFAILED] Invalid credentials", "auth"), "x");
  assertEquals(auth.actions![0].title, "Create App Password");
  assertStringIncludes(auth.detail!.markdown!, "POP/IMAP");
  assertEquals(accountErrorItem(ACCOUNT, new Error("timeout"), "x").title, "Can't reach ada@gmail.com");
});
