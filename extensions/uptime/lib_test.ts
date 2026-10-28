import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ago,
  average,
  certLook,
  type Check,
  daysLeft,
  displayName,
  dnField,
  fetchError,
  firstPem,
  formatMs,
  health,
  issuerName,
  normalizeUrl,
  parseOpensslDate,
  parseVerify,
  parseX509,
  record,
  sparkline,
  subtitle,
  uptimeRatio,
} from "./lib.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");

// `openssl x509 -noout -subject -issuer -startdate -enddate -ext subjectAltName` on a Let's Encrypt certificate.
const X509 = `subject=CN = backslash.dev
issuer=C = US, O = Let's Encrypt, CN = R11
notBefore=Sep 30 08:12:03 2026 GMT
notAfter=Nov  3 08:12:02 2026 GMT
X509v3 Subject Alternative Name:
    DNS:backslash.dev, DNS:www.backslash.dev
`;

// The interesting bits of `openssl s_client -connect backslash.dev:443 -servername backslash.dev`.
const S_CLIENT = `CONNECTED(00000003)
depth=2 C = US, O = Internet Security Research Group, CN = ISRG Root X1
verify return:1
---
Certificate chain
 0 s:CN = backslash.dev
   i:C = US, O = Let's Encrypt, CN = R11
---
Server certificate
-----BEGIN CERTIFICATE-----
MIIFAjCCA+qgAwIBAgISA0xyz
-----END CERTIFICATE-----
subject=CN = backslash.dev
---
SSL handshake has read 4120 bytes and written 403 bytes
Verification: OK
---
    Verify return code: 0 (ok)
---
DONE`;

Deno.test("urls", () => {
  assertEquals(normalizeUrl("example.com"), "https://example.com/");
  assertEquals(normalizeUrl(" http://localhost:3000/health "), "http://localhost:3000/health");
  assertThrows(() => normalizeUrl("ftp://example.com"), Error, "Only http and https");
  assertThrows(() => normalizeUrl("nope"), Error, "not a host name");
  assertThrows(() => normalizeUrl(""), Error, "Type a URL");
  assertEquals(displayName({ url: "https://www.example.com/" }), "example.com");
  assertEquals(displayName({ url: "https://api.example.com/v1/health/" }), "api.example.com/v1/health");
  assertEquals(displayName({ url: "https://x.dev/", name: "Production" }), "Production");
});

Deno.test("openssl output", () => {
  assertEquals(parseOpensslDate("Nov  3 08:12:02 2026 GMT"), "2026-11-03T08:12:02.000Z");
  assertEquals(parseOpensslDate("garbage"), undefined);
  const cert = parseX509(X509);
  assertEquals(cert.subject, "CN = backslash.dev");
  assertEquals(cert.names, ["backslash.dev", "www.backslash.dev"]);
  assertEquals(cert.notAfter, "2026-11-03T08:12:02.000Z");
  assertEquals(issuerName(cert), "Let's Encrypt (R11)");
  assertEquals(dnField("CN=R11,O=Let's Encrypt,C=US", "O"), "Let's Encrypt");
  assertEquals(issuerName({ names: [], issuer: "CN = Mock CA" }), "Mock CA");
  assert(firstPem(S_CLIENT)?.startsWith("-----BEGIN CERTIFICATE-----"));
  assertEquals(parseVerify(S_CLIENT), { code: 0, text: "ok" });
  assertEquals(parseVerify("Verify return code: 10 (certificate has expired)"), {
    code: 10,
    text: "certificate has expired",
  });
});

Deno.test("parses a certificate made by openssl itself", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const run = (args: string[]) => new Deno.Command("openssl", { args, stdout: "piped", stderr: "null" }).output();
    const made = await run([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      `${dir}/k.pem`,
      "-out",
      `${dir}/c.pem`,
      "-days",
      "5",
      "-subj",
      "/O=Acme/CN=acme.test",
      "-addext",
      "subjectAltName=DNS:acme.test,IP:127.0.0.1",
    ]);
    if (!made.success) return; // no openssl here
    const out = await run([
      "x509",
      "-in",
      `${dir}/c.pem`,
      "-noout",
      "-subject",
      "-issuer",
      "-startdate",
      "-enddate",
      "-ext",
      "subjectAltName",
    ]);
    const cert = parseX509(new TextDecoder().decode(out.stdout));
    assertEquals(cert.names, ["acme.test", "127.0.0.1"]);
    assertEquals(issuerName(cert), "Acme (acme.test)");
    const days = daysLeft(cert)!;
    assert(days >= 4 && days <= 5, `${days}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("health and certificate looks", () => {
  assertEquals(health(undefined), "unknown");
  assertEquals(health({ at: 0, status: 200 }), "up");
  assertEquals(health({ at: 0, status: 301 }), "up");
  assertEquals(health({ at: 0, status: 404 }), "warn");
  assertEquals(health({ at: 0, status: 502 }), "down");
  assertEquals(health({ at: 0, error: "Connection refused" }), "down");
  const cert = parseX509(X509);
  assertEquals(daysLeft(cert, NOW), 5);
  assertEquals(certLook(6, 14).color, "red");
  assertEquals(certLook(10, 14).label, "Expires in 10 days");
  assertEquals(certLook(10, 14).color, "orange");
  assertEquals(certLook(60, 14).label, "60 days left");
  assertEquals(certLook(-1, 14).label, "Expired");
});

Deno.test("history", () => {
  let r = record(undefined, { at: 1, status: 200, ms: 100 });
  r = record(r, { at: 2, error: "Connection refused" });
  r = record(r, { at: 3, error: "Connection refused" });
  assertEquals(r.history, [100, null, null]);
  assertEquals(r.downSince, 2);
  r = record(r, { at: 4, status: 200, ms: 300 });
  assertEquals(r.downSince, undefined);
  assertEquals(uptimeRatio(r.history), 0.5);
  assertEquals(average(r.history), 200);
  assertEquals(sparkline(r.history), "▁✕✕█");
  for (let i = 0; i < 30; i++) r = record(r, { at: i, status: 200, ms: i });
  assertEquals(r.history.length, 20);
});

Deno.test("formatting", () => {
  assertEquals(formatMs(42.4), "42 ms");
  assertEquals(formatMs(1234), "1.23 s");
  assertEquals(formatMs(undefined), "—");
  assertEquals(ago(NOW - 10_000, NOW), "just now");
  assertEquals(ago(NOW - 5 * 60_000, NOW), "5m ago");
  assertEquals(ago(undefined, NOW), "never");
  assertEquals(
    fetchError(
      new TypeError("error sending request for url (https://x.dev/): Connection refused (os error 111)"),
      false,
      15,
    ),
    "Connection refused",
  );
  assertEquals(fetchError(new Error("invalid peer certificate: UnknownIssuer"), false, 15), "TLS certificate rejected");
  assertEquals(fetchError(new Error("dns error: failed to lookup address"), false, 15), "Host not found");
  assertEquals(fetchError(new Error("aborted"), true, 15), "No answer within 15 s");
  assertEquals(
    fetchError(
      new TypeError(
        "error sending request: client error (Connect): received corrupt message of type InvalidContentType",
      ),
      false,
      15,
    ),
    "TLS handshake failed: is it plain HTTP?",
  );
});

Deno.test("root subtitle", () => {
  const up: Check = { at: NOW, status: 200, ms: 80, cert: parseX509(X509.replace("Nov  3", "Dec 30")) };
  const down: Check = { at: NOW, error: "Connection refused" };
  const expiring: Check = { at: NOW, status: 200, cert: parseX509(X509) };
  assertEquals(subtitle([], 14, NOW), null);
  assertEquals(subtitle([{ last: up }, { last: down }], 14, NOW), "1 down");
  assertEquals(subtitle([{ last: up }, { last: expiring }], 14, NOW), "Cert expires in 5 d");
  assertEquals(subtitle([{ last: up }, { last: { at: NOW, status: 404 } }], 14, NOW), "1 with errors");
  assertEquals(subtitle([{ last: up }, { last: up }], 14, NOW), "All 2 up");
  assertEquals(subtitle([{ last: up }], 14, NOW), "Up");
});
