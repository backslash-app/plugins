import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
  addAccount,
  decodeEntities,
  findCodes,
  findLinks,
  htmlToText,
  members,
  messageMarkdown,
  messageText,
  pickDomain,
  randomLocalPart,
  randomPassword,
  removeAccount,
  senderName,
  shortDate,
  shortUrl,
} from "./lib.ts";

const codes = (text: string, subject = "") => findCodes(text, subject).map((c) => c.code);

Deno.test("verification codes: the usual phrasings", () => {
  assertEquals(codes("Your verification code is 482913. It expires in 10 minutes."), ["482913"]);
  assertEquals(codes("Hi,\n\nUse this code to sign in:\n\n  731 044\n\nThanks"), ["731044"]);
  assertEquals(codes("Enter the following one-time password: 552-108"), ["552108"]);
  assertEquals(codes("Your OTP: 9921"), ["9921"]);
  assertEquals(codes("Votre code de vérification : 118822"), ["118822"]);
  assertEquals(codes("Confirm your email with code K7Q2XD"), ["K7Q2XD"]);
  assertEquals(codes("", "123456 is your Instagram code"), ["123456"]);
  // Alone on its line, without a keyword nearby.
  assertEquals(codes("Welcome!\n\n884213\n\nSee you soon"), ["884213"]);
  assertEquals(codes("Your code: <b>620154</b>".replace(/<[^>]+>/g, "")), ["620154"]);
});

Deno.test("verification codes: what isn't one", () => {
  assertEquals(codes("© 2026 Acme Inc. All rights reserved."), []);
  assertEquals(codes("Your order 100234 has shipped and costs $1999."), []);
  assertEquals(codes("Call us at 555 1234 or visit https://acme.test/verify/839201"), []);
  assertEquals(codes("The meeting is at 1030 in room 4. Width 600px."), []);
  assertEquals(codes("Invoice no. 445566 attached"), []);
  assertEquals(codes("Thanks for signing up to ACMECORP newsletter"), []);
  // Codes win over other numbers.
  assertEquals(codes("Order 2026: your login code is 552211")[0], "552211");
});

Deno.test("links: anchors with their text, verification first", () => {
  const html = `<p>Hi!</p>
<a href="https://twitter.com/acme">Twitter</a>
<a href="https://acme.test/account/confirm?token=abc&amp;u=1" class="btn">Confirm my email</a>
<a href='https://acme.test/unsubscribe?u=1'>Unsubscribe</a>
<a href="https://acme.test/go/x8y7">Get started</a>
<a href="mailto:help@acme.test">help</a>`;
  const links = findLinks({ html: [html], text: "Or paste https://acme.test/account/confirm?token=abc&u=1." });
  assertEquals(links[0], {
    url: "https://acme.test/account/confirm?token=abc&u=1",
    label: "Confirm my email",
    verify: true,
  });
  assertEquals(links.find((l) => l.url.includes("unsubscribe"))?.verify, false);
  assertEquals(links.find((l) => l.url.includes("twitter"))?.verify, false);
  assertEquals(links.some((l) => l.url.startsWith("mailto:")), false);
  assertEquals(links.length, 4);
  assertEquals(
    findLinks({ text: "Reset: https://x.test/reset-password/123)" })[0].url,
    "https://x.test/reset-password/123",
  );
  // The label alone can make a link a verification one.
  assertEquals(findLinks({ html: '<a href="https://l.test/c/abc">Verify email address</a>' })[0].verify, true);
});

Deno.test("reading: html to text, entities, markdown", () => {
  assertEquals(decodeEntities("a &amp; b &#39;c&#x27; &eacute; &unknown;"), "a & b 'c' é &unknown;");
  assertEquals(
    htmlToText(
      "<html><head><style>p{}</style></head><body><p>Hello&nbsp;there</p><p>Line <b>two</b></p><br>end</body></html>",
    ),
    "Hello there\nLine two\n\nend",
  );
  assertEquals(messageText({ text: "  plain\r\nbody ", html: ["<p>ignored</p>"] }), "plain\nbody");
  assertEquals(messageText({ text: "", html: ["<p>from html</p>"] }), "from html");
  const md = messageMarkdown({
    id: "1",
    from: { address: "no-reply@acme.test", name: "Acme" },
    to: [],
    subject: "Welcome",
    seen: false,
    createdAt: "",
    text: "# not a title\nhi",
  });
  assertEquals(md, "## Welcome\nFrom **Acme** <no-reply@acme.test>\n\n\\# not a title\nhi");
});

Deno.test("mail.tm shapes and accounts", () => {
  assertEquals(members([{ id: 1 }]), [{ id: 1 }]);
  assertEquals(members({ "hydra:member": [{ id: 2 }], "hydra:totalItems": 1 }), [{ id: 2 }]);
  assertEquals(members(undefined), []);
  const domains = [
    { id: "a", domain: "private.test", isActive: true, isPrivate: true },
    { id: "b", domain: "off.test", isActive: false },
    { id: "c", domain: "ok.test", isActive: true, isPrivate: false },
  ];
  assertEquals(pickDomain(domains, () => 0.99), "ok.test");
  assertThrows(() => pickDomain([domains[0]]), Error, "no domain");
  assertMatch(randomLocalPart(), /^[a-z][a-z0-9]{9}$/);
  assertEquals(randomPassword().length, 24);
  assert(randomLocalPart() !== randomLocalPart());
  const a = { id: "a", address: "a@x", password: "p", created: 1 };
  const b = { id: "b", address: "b@x", password: "p", created: 2 };
  assertEquals(addAccount([a], b), [b, a]);
  assertEquals(removeAccount([b, a], "b"), [a]);
});

Deno.test("display", () => {
  assertEquals(senderName({ address: "no-reply@acme.test", name: "" }), "no-reply");
  assertEquals(senderName({ address: "x@y", name: "Acme" }), "Acme");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(shortDate("2026-10-29T11:59:30+00:00", now), "just now");
  assertEquals(shortDate("2026-10-29T11:00:00+00:00", now), "1 h");
  assertEquals(shortDate("2026-10-12T11:00:00+00:00", now), "12 Oct");
  assertEquals(shortUrl("https://acme.test/account/confirm?token=1"), "acme.test/account/confirm");
});
