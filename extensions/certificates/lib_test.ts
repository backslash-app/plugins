import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  certName,
  chainRole,
  connectError,
  covers,
  daysLeft,
  dnField,
  expandHome,
  expiryText,
  fingerprints,
  FOLDERS,
  hasPrivateKey,
  health,
  isMkcert,
  issuerName,
  keyFileFor,
  looksLikeCert,
  mkcertBase,
  parseCertText,
  parseHandshake,
  parseNames,
  parseOpensslDate,
  parseTarget,
  pemBlocks,
  pemToDer,
  selfSigned,
  sortByExpiry,
  targetText,
  tildify,
  verifyLook,
} from "./lib.ts";

// A self-signed ECDSA certificate made with openssl req for these tests, and its `openssl x509 -noout -text`.
const PEM = `-----BEGIN CERTIFICATE-----
MIICRTCCAeugAwIBAgIUCMA2hWA/eggq3enVBQhzBVNfx+QwCgYIKoZIzj0EAwIw
VTEnMCUGA1UECgwebWtjZXJ0IGRldmVsb3BtZW50IGNlcnRpZmljYXRlMRMwEQYD
VQQLDAphZGFAbGFwdG9wMRUwEwYDVQQDDAxleGFtcGxlLnRlc3QwHhcNMjYxMDI5
MDgxMjI5WhcNMjYxMTI4MDgxMjI5WjBVMScwJQYDVQQKDB5ta2NlcnQgZGV2ZWxv
cG1lbnQgY2VydGlmaWNhdGUxEzARBgNVBAsMCmFkYUBsYXB0b3AxFTATBgNVBAMM
DGV4YW1wbGUudGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABIyhAI3ahRwY
bjg54m5A2VNoUcou2A42f0Vyx6ZYcpykWd0E/04QsWV1WXpmfsT2Qffh6bJB17dj
xvSs15nFI9CjgZgwgZUwHQYDVR0OBBYEFGlCYJ1zOC7EIHOMl3Xa6CUr4m+bMB8G
A1UdIwQYMBaAFGlCYJ1zOC7EIHOMl3Xa6CUr4m+bMA8GA1UdEwEB/wQFMAMBAf8w
LQYDVR0RBCYwJIIMZXhhbXBsZS50ZXN0gg4qLmV4YW1wbGUudGVzdIcEfwAAATAT
BgNVHSUEDDAKBggrBgEFBQcDATAKBggqhkjOPQQDAgNIADBFAiEApBOJXHnLmp9V
FMh7tZaKMXvH4vepycIayoyrF4qbpjoCIGbMMnUYnKH8kYPmDPeqCHmZ4mpUqLfQ
TP73QygBdXXn
-----END CERTIFICATE-----`;

const TEXT = `Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number:
            08:c0:36:85:60:3f:7a:08:2a:dd:e9:d5:05:08:73:05:53:5f:c7:e4
        Signature Algorithm: ecdsa-with-SHA256
        Issuer: O = mkcert development certificate, OU = ada@laptop, CN = example.test
        Validity
            Not Before: Oct 29 08:12:29 2026 GMT
            Not After : Nov 28 08:12:29 2026 GMT
        Subject: O = mkcert development certificate, OU = ada@laptop, CN = example.test
        Subject Public Key Info:
            Public Key Algorithm: id-ecPublicKey
                Public-Key: (256 bit)
                pub:
                    04:8c:a1:00:8d:da:85:1c:18:6e:38:39:e2:6e:40:
                    d9:53:68:51:ca:2e:d8:0e:36:7f:45:72:c7:a6:58:
                    72:9c:a4:59:dd:04:ff:4e:10:b1:65:75:59:7a:66:
                    7e:c4:f6:41:f7:e1:e9:b2:41:d7:b7:63:c6:f4:ac:
                    d7:99:c5:23:d0
                ASN1 OID: prime256v1
                NIST CURVE: P-256
        X509v3 extensions:
            X509v3 Subject Key Identifier: 
                69:42:60:9D:73:38:2E:C4:20:73:8C:97:75:DA:E8:25:2B:E2:6F:9B
            X509v3 Authority Key Identifier: 
                69:42:60:9D:73:38:2E:C4:20:73:8C:97:75:DA:E8:25:2B:E2:6F:9B
            X509v3 Basic Constraints: critical
                CA:TRUE
            X509v3 Subject Alternative Name: 
                DNS:example.test, DNS:*.example.test, IP Address:127.0.0.1
            X509v3 Extended Key Usage: 
                TLS Web Server Authentication
    Signature Algorithm: ecdsa-with-SHA256
    Signature Value:
        30:45:02:21:00:a4:13:89:5c:79:cb:9a:9f:55:14:c8:7b:b5:
        96:8a:31:7b:c7:e2:f7:a9:c9:c2:1a:ca:8c:ab:17:8a:9b:a6:
        3a:02:20:66:cc:32:75:18:9c:a1:fc:91:83:e6:0c:f7:aa:08:
        79:99:e2:6a:54:a8:b7:d0:4c:fe:f7:43:28:01:75:75:e7`;

// An RSA CA, trimmed (`openssl x509 -noout -text` with the hex dumps removed).
const RSA_TEXT = `Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number: 4096 (0x1000)
        Signature Algorithm: sha256WithRSAEncryption
        Issuer: C = US, O = Internet Security Research Group, CN = ISRG Root X1
        Validity
            Not Before: Mar 13 00:00:00 2024 GMT
            Not After : Mar 12 23:59:59 2027 GMT
        Subject: C = US, O = Let's Encrypt, CN = R11
        Subject Public Key Info:
            Public Key Algorithm: rsaEncryption
                Public-Key: (2048 bit)
        X509v3 extensions:
            X509v3 Key Usage: critical
                Digital Signature, Certificate Sign, CRL Sign
            X509v3 Extended Key Usage: 
                TLS Web Client Authentication, TLS Web Server Authentication
            X509v3 Basic Constraints: critical
                CA:TRUE, pathlen:0
            Authority Information Access: 
                CA Issuers - URI:http://x1.i.lencr.org/
    Signature Algorithm: sha256WithRSAEncryption
`;

const ED_TEXT = `        Signature Algorithm: ED25519
        Issuer: CN = ed
        Subject: CN = ed
        Subject Public Key Info:
            Public Key Algorithm: ED25519
                ED25519 Public-Key:
`;

Deno.test("PEM blocks and fingerprints match openssl", async () => {
  const bundle = `junk\n${PEM}\r\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n${
    PEM.replace(/CERTIFICATE/g, "TRUSTED CERTIFICATE")
  }`;
  const blocks = pemBlocks(bundle);
  assertEquals(blocks.length, 2);
  assertEquals(blocks[1], PEM);
  assert(hasPrivateKey(bundle));
  assert(!hasPrivateKey(PEM));
  assertEquals(pemToDer(PEM)[0], 0x30);
  // openssl x509 -fingerprint -sha256 / -sha1 of the same certificate:
  assertEquals(await fingerprints(PEM), {
    sha256: "EF:DB:E6:05:D6:BD:0F:D1:60:DB:CB:96:97:DF:0F:FF:5A:C4:DF:FE:1C:89:E9:36:D6:72:98:55:51:0A:0D:7D",
    sha1: "D2:BE:32:76:05:3F:74:93:3B:29:47:5B:04:0A:37:2E:AA:E0:5B:DA",
  });
});

Deno.test("x509 text: ECDSA with names", () => {
  const c = parseCertText(TEXT);
  assertEquals(c.subject, "O = mkcert development certificate, OU = ada@laptop, CN = example.test");
  assertEquals(c.serial, "08C03685603F7A082ADDE9D505087305535FC7E4");
  assertEquals(c.keyType, "ECDSA P-256");
  assertEquals(c.signature, "ecdsa-with-SHA256");
  assertEquals(c.names, ["example.test", "*.example.test", "127.0.0.1"]);
  assertEquals(c.notAfter?.toISOString(), "2026-11-28T08:12:29.000Z");
  assertEquals(c.notBefore?.toISOString(), "2026-10-29T08:12:29.000Z");
  assertEquals(c.isCA, true);
  assertEquals(c.extendedKeyUsage, ["TLS Web Server Authentication"]);
  assertEquals(certName(c), "example.test");
  assert(isMkcert(c));
  assert(selfSigned(c));
});

Deno.test("x509 text: RSA CA, inline serial, usages, AIA; Ed25519", () => {
  const c = parseCertText(RSA_TEXT);
  assertEquals(c.serial, "1000");
  assertEquals(c.keyType, "RSA 2048");
  assertEquals(c.isCA, true);
  assertEquals(c.keyUsage, ["Digital Signature", "Certificate Sign", "CRL Sign"]);
  assertEquals(c.extendedKeyUsage, ["TLS Web Client Authentication", "TLS Web Server Authentication"]);
  assertEquals(c.caIssuers, "http://x1.i.lencr.org/");
  assertEquals(c.ocsp, undefined);
  assertEquals(c.names, []);
  assertEquals(certName(c), "R11");
  assertEquals(issuerName(c), "Internet Security Research Group (ISRG Root X1)");
  assertEquals(chainRole(1, c, 2), "Intermediate");
  assertEquals(chainRole(0, c, 2), "Server");
  assertEquals(parseCertText(ED_TEXT).keyType, "Ed25519");
  assertEquals(
    issuerName({ issuer: "O = mkcert development CA, CN = mkcert development CA" }),
    "mkcert development CA",
  );
});

Deno.test("distinguished names and dates", () => {
  assertEquals(dnField('C = US, O = "Acme, Inc", CN = acme.com', "O"), "Acme, Inc");
  assertEquals(dnField("/C=US/CN=x", "CN"), "x");
  assertEquals(parseOpensslDate("Nov  7 12:44:37 2026 GMT")?.toISOString(), "2026-11-07T12:44:37.000Z");
  assertEquals(parseOpensslDate("nope"), undefined);
});

Deno.test("expiry: health, text and order", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const at = (iso: string) => ({ notAfter: new Date(iso) });
  assertEquals(daysLeft(at("2026-11-08T12:00:00Z"), now), 10);
  assertEquals(health(at("2026-11-08T12:00:00Z"), 30, now), "expiring");
  assertEquals(health(at("2027-11-08T12:00:00Z"), 30, now), "valid");
  assertEquals(health(at("2026-10-01T12:00:00Z"), 30, now), "expired");
  assertEquals(health({ notAfter: new Date("2027-01-01"), notBefore: new Date("2026-12-01") }, 30, now), "notYet");
  assertEquals(health({}, 30, now), "unknown");
  assertEquals(expiryText(at("2026-11-08T12:00:00Z"), now), "in 10 days");
  assertEquals(expiryText(at("2026-10-29T18:00:00Z"), now), "expires today");
  assertEquals(expiryText(at("2026-10-29T06:00:00Z"), now), "expired today");
  assertEquals(expiryText(at("2026-10-19T12:00:00Z"), now), "expired 9 days ago");
  assertEquals(expiryText(at("2029-10-29T12:00:00Z"), now), "in 3 years");
  assertEquals(expiryText(at("2027-04-29T12:00:00Z"), now), "in 6 months");
  const sorted = sortByExpiry([{ id: 1, cert: {} }, { id: 2, cert: at("2027-01-01") }, {
    id: 3,
    cert: at("2026-11-01"),
  }]);
  assertEquals(sorted.map((x) => x.id), [3, 2, 1]);
});

Deno.test("host names and wildcards", () => {
  const c = { names: ["example.test", "*.example.test"], subject: "" };
  assert(covers(c, "example.test"));
  assert(covers(c, "api.example.test"));
  assert(!covers(c, "a.b.example.test"));
  assert(!covers(c, "example.com"));
  assert(covers({ names: [], subject: "CN = legacy.test" }, "legacy.test"));
});

Deno.test("targets", () => {
  assertEquals(parseTarget("example.com"), { host: "example.com", port: 443 });
  assertEquals(parseTarget("Example.com:8443"), { host: "example.com", port: 8443 });
  assertEquals(parseTarget("https://example.com/path?q=1"), { host: "example.com", port: 443 });
  assertEquals(parseTarget("imaps://mail.example.com"), { host: "mail.example.com", port: 993 });
  assertEquals(parseTarget("[::1]:8443"), { host: "::1", port: 8443 });
  assertEquals(parseTarget("example.com/path"), { host: "example.com", port: 443 });
  assertEquals(targetText({ host: "::1", port: 443 }), "[::1]:443");
  assertThrows(() => parseTarget(""));
  assertThrows(() => parseTarget("exa mple.com"));
  assertThrows(() => parseTarget("example.com:99999"));
});

Deno.test("s_client output", () => {
  const out = `CONNECTED(00000003)
---
Certificate chain
 0 s:CN = example.com
---
Server Temp Key: X25519, 253 bits
---
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
Server public key is 2048 bit
    Verify return code: 0 (ok)
`;
  assertEquals(parseHandshake(out), {
    protocol: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    verifyCode: 0,
    verifyText: "ok",
    tempKey: "X25519, 253 bits",
  });
  assertEquals(verifyLook(0).title, "Trusted");
  assertEquals(verifyLook(62).title, "Wrong host name");
  assertEquals(verifyLook(99, "odd").title, "odd");
  assertEquals(verifyLook(undefined).color, "gray");
  assertEquals(
    connectError(
      "openssl exited with 1: 4007BEDE887F0000:error:10080002:BIO routines:BIO_lookup_ex:system lib:../crypto/bio/bio_addr.c:738:Name or service not known\nconnect:errno=0",
    ),
    "This host name does not resolve",
  );
  assertEquals(connectError("connect:errno=111\nConnection refused"), "Connection refused");
  assertEquals(
    connectError("SSL routines:ssl3_get_record:wrong version number"),
    "The server does not speak TLS on this port",
  );
});

Deno.test("files and mkcert names", () => {
  assert(looksLikeCert("site.pem"));
  assert(looksLikeCert("example.test+2.pem"));
  assert(looksLikeCert("ca.crt"));
  assert(!looksLikeCert("example.test+2-key.pem"));
  assert(!looksLikeCert("server.key"));
  assert(!looksLikeCert("private.pem"));
  assert(!looksLikeCert("notes.txt"));
  assertEquals(keyFileFor("/a/x+1.pem"), "/a/x+1-key.pem");
  assertEquals(parseNames("myapp.test, *.myapp.test localhost 127.0.0.1 ::1 me@x.org myapp.test"), [
    "myapp.test",
    "*.myapp.test",
    "localhost",
    "127.0.0.1",
    "::1",
    "me@x.org",
  ]);
  assertThrows(() => parseNames(""));
  assertThrows(() => parseNames("rm -rf; x"), Error, "not a host name");
  assertEquals(mkcertBase(["example.test", "localhost", "127.0.0.1"]), "example.test+2");
  assertEquals(mkcertBase(["*.example.test"]), "_wildcard.example.test");
  assertEquals(mkcertBase(["::1"]), "__1");
  assertEquals(expandHome("~/certs/", "/home/ada"), "/home/ada/certs");
  assertEquals(expandHome("/srv/x", "/home/ada"), "/srv/x");
  assertEquals(tildify("/home/ada/certs/a.pem", "/home/ada"), "~/certs/a.pem");
  assertEquals(tildify("/home/adam/a.pem", "/home/ada"), "/home/adam/a.pem");
});

Deno.test("searched folders match the read permission", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.read, FOLDERS);
});
