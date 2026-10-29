import { assertEquals, assertThrows } from "@std/assert";
import {
  algoFromName,
  algoFromSumsName,
  algosForLength,
  clearsignedBody,
  copiedHash,
  findEntry,
  groupedFingerprint,
  groupedHash,
  isSumsFile,
  parseFileList,
  parseGpgStatus,
  parseHashOutput,
  parseSums,
  pgpKind,
  sameHash,
  shortHash,
  signedFile,
  sigVerdict,
  sumsLine,
  sumsSubject,
} from "./lib.ts";

const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA2 = "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03";
const MD5 = "d41d8cd98f00b204e9800998ecf8427e";
const SHA512 =
  "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e";

Deno.test("copied files", () => {
  assertEquals(parseFileList("file:///home/ada/Downloads/debian-13.iso\nfile:///home/ada/Downloads/SHA256SUMS"), [
    "/home/ada/Downloads/debian-13.iso",
    "/home/ada/Downloads/SHA256SUMS",
  ]);
});

Deno.test("algorithms", () => {
  assertEquals(algosForLength(64), ["sha256"]);
  assertEquals(algosForLength(128), ["sha512", "blake2b"]);
  assertEquals(algosForLength(50), []);
  assertEquals(algoFromName("SHA-256"), "sha256");
  assertEquals(algoFromName("BLAKE2b"), "blake2b");
  assertEquals(algoFromName("sha2-512"), "sha512");
  assertEquals(algoFromName("whirlpool"), undefined);
  assertEquals(parseHashOutput(`${SHA}  /home/ada/a.iso\n`), SHA);
  assertEquals(parseHashOutput(`\\${SHA}  /home/ada/a\\nb`), SHA);
  assertThrows(() => parseHashOutput("sha256sum: x: No such file"), Error, "Unexpected");
});

Deno.test("sums file names", () => {
  for (
    const n of [
      "SHA256SUMS",
      "sha256sums.txt",
      "SHA512SUMS",
      "MD5SUMS",
      "B2SUMS",
      "CHECKSUMS",
      "x.iso.sha256",
      "x.iso.sha256sum",
      "x.md5",
      "x.DIGESTS",
    ]
  ) {
    assertEquals(isSumsFile(`/d/${n}`), true, n);
  }
  for (const n of ["SHA256SUMS.asc", "SHA256SUMS.gpg", "x.iso", "notes.txt", "sha256.c"]) {
    assertEquals(isSumsFile(`/d/${n}`), false, n);
  }
  assertEquals(algoFromSumsName("/d/SHA512SUMS"), "sha512");
  assertEquals(algoFromSumsName("/d/B2SUMS"), "blake2b");
  assertEquals(algoFromSumsName("/d/x.iso.sha256sum"), "sha256");
  assertEquals(algoFromSumsName("/d/CHECKSUMS"), undefined);
  assertEquals(sumsSubject("/d/x.iso.sha256"), "x.iso");
  assertEquals(sumsSubject("/d/SHA256SUMS"), undefined);
});

Deno.test("GNU sums", () => {
  const s = parseSums(
    `# Debian\n${SHA}  debian-13.0.0-amd64-netinst.iso\n${SHA2} *debian-13.0.0-amd64-DVD-1.iso\n\n${MD5}  ./notes.txt\n\\${SHA}  a\\\\b\\nc.txt\n`,
    "/d/SHA256SUMS",
  );
  assertEquals(s.entries.map((e) => [e.name, e.algo]), [
    ["debian-13.0.0-amd64-netinst.iso", "sha256"],
    ["debian-13.0.0-amd64-DVD-1.iso", "sha256"],
    ["./notes.txt", "md5"],
    ["a\\b\nc.txt", "sha256"],
  ]);
  assertEquals(s.algo, "sha256");
  assertEquals(s.clearsigned, false);
  assertEquals(findEntry(s, "notes.txt")?.hash, MD5);
  assertEquals(findEntry(s, "debian-13.0.0-amd64-DVD-1.iso")?.hash, SHA2);
  assertEquals(findEntry(s, "other.iso"), undefined);
  // A 128-character hash in SHA512SUMS is SHA-512; in B2SUMS, BLAKE2b.
  assertEquals(parseSums(`${SHA512}  x`, "/d/SHA512SUMS").entries[0].algo, "sha512");
  assertEquals(parseSums(`${SHA512}  x`, "/d/B2SUMS").entries[0].algo, "blake2b");
});

Deno.test("BSD and OpenSSL tags", () => {
  const s = parseSums(
    `SHA256 (FreeBSD-14.2-RELEASE-amd64-disc1.iso) = ${SHA}\nSHA512 (b.img) = ${SHA512}\nSHA2-256(c.txt)= ${SHA2}\nBLAKE2b (d) = ${SHA512}\n`,
  );
  assertEquals(s.entries.map((e) => [e.name, e.algo]), [
    ["FreeBSD-14.2-RELEASE-amd64-disc1.iso", "sha256"],
    ["b.img", "sha512"],
    ["c.txt", "sha256"],
    ["d", "blake2b"],
  ]);
});

Deno.test("a hash alone, for x.iso.sha256", () => {
  assertEquals(parseSums(`${SHA.toUpperCase()}\n`, "/d/archlinux.iso.sha256").entries, [
    { name: "archlinux.iso", hash: SHA, algo: "sha256" },
  ]);
  assertEquals(parseSums(`${SHA}\n`, "/d/SHA256SUMS").entries, []);
});

const CLEARSIGNED = `-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

${SHA}  ubuntu-26.04-desktop-amd64.iso
- ${SHA2}  ubuntu-26.04-live-server-amd64.iso
-----BEGIN PGP SIGNATURE-----

iQIzBAEBCgAdFiEE843Jc2Fh
=abcd
-----END PGP SIGNATURE-----
`;

Deno.test("clearsigned sums", () => {
  assertEquals(clearsignedBody(CLEARSIGNED)?.split("\n").length, 2);
  const s = parseSums(CLEARSIGNED, "/d/SHA256SUMS");
  assertEquals(s.clearsigned, true);
  assertEquals(s.entries.map((e) => e.name), ["ubuntu-26.04-desktop-amd64.iso", "ubuntu-26.04-live-server-amd64.iso"]);
});

Deno.test("hashes copied from a web page", () => {
  assertEquals(copiedHash(`  ${SHA.toUpperCase()}\n`), { hash: SHA, algos: ["sha256"] });
  assertEquals(copiedHash(`sha256:${SHA}`), { hash: SHA, algos: ["sha256"] });
  assertEquals(copiedHash(`SHA512=${SHA}`), undefined);
  assertEquals(copiedHash(SHA512)?.algos, ["sha512", "blake2b"]);
  assertEquals(copiedHash(`${SHA}  debian.iso`), { hash: SHA, algos: ["sha256"], name: "debian.iso" });
  assertEquals(copiedHash(`SHA256 (x.iso) = ${SHA}`), { hash: SHA, algos: ["sha256"], name: "x.iso" });
  assertEquals(copiedHash(groupedHash(SHA))?.hash, SHA);
  assertEquals(copiedHash("file:///home/ada/a.iso"), undefined);
  assertEquals(copiedHash("hello world"), undefined);
  assertEquals(copiedHash("deadbeef"), undefined);
  assertEquals(sameHash(SHA.toUpperCase(), SHA), true);
  assertEquals(sameHash(SHA, SHA2), false);
  assertEquals(shortHash(SHA), "e3b0c442…7852b855");
  assertEquals(sumsLine(SHA, "a.iso"), `${SHA}  a.iso`);
  assertEquals(sumsLine(SHA, "a\\b"), `\\${SHA}  a\\\\b`);
});

const GOOD = `[GNUPG:] NEWSIG
[GNUPG:] KEY_CONSIDERED B329438B2FB94515F5B540882CD18FAC4456D33C 0
[GNUPG:] SIG_ID /4p1UqFNJH9Xb9j+IbaR+Ag2JXc 2026-10-29 1793260991
[GNUPG:] GOODSIG 2CD18FAC4456D33C Ada Lovelace <ada@example.com>
[GNUPG:] VALIDSIG B329438B2FB94515F5B540882CD18FAC4456D33C 2026-10-29 1793260991 0 4 0 22 10 00 B329438B2FB94515F5B540882CD18FAC4456D33C
[GNUPG:] TRUST_ULTIMATE 0 pgp
`;
const BAD = `[GNUPG:] NEWSIG
[GNUPG:] KEY_CONSIDERED B329438B2FB94515F5B540882CD18FAC4456D33C 0
[GNUPG:] BADSIG 2CD18FAC4456D33C Ada Lovelace <ada@example.com>
[GNUPG:] FAILURE gpg-exit 33554433
`;
const NO_KEY = `[GNUPG:] NEWSIG
[GNUPG:] ERRSIG 2CD18FAC4456D33C 22 10 00 1793260991 9 B329438B2FB94515F5B540882CD18FAC4456D33C
[GNUPG:] NO_PUBKEY 2CD18FAC4456D33C
[GNUPG:] FAILURE gpg-exit 33554433
`;

Deno.test("gpg --verify status", () => {
  const [good] = parseGpgStatus(GOOD);
  assertEquals(good.status, "good");
  assertEquals(good.signer, "Ada Lovelace <ada@example.com>");
  assertEquals(good.fingerprint, "B329438B2FB94515F5B540882CD18FAC4456D33C");
  assertEquals(good.trust, "ultimate");
  assertEquals(good.created?.getTime(), 1793260991000);
  assertEquals(sigVerdict(good), { text: "Good signature from Ada Lovelace <ada@example.com>", color: "green" });
  const [bad] = parseGpgStatus(BAD);
  assertEquals(bad.status, "bad");
  assertEquals(sigVerdict(bad).color, "red");
  const [missing] = parseGpgStatus(NO_KEY);
  assertEquals(missing.status, "no-key");
  assertEquals(missing.keyId, "2CD18FAC4456D33C");
  assertEquals(missing.fingerprint, "B329438B2FB94515F5B540882CD18FAC4456D33C");
  assertEquals(sigVerdict(missing).text, "Can't check: the public key 2CD18FAC4456D33C isn't in your keyring");
  // Two signatures, one of them by an expired key.
  const two = parseGpgStatus(
    GOOD + "[GNUPG:] NEWSIG\n[GNUPG:] EXPKEYSIG 1111222233334444 Old Key\n[GNUPG:] TRUST_UNDEFINED 0 pgp\n",
  );
  assertEquals(two.map((s) => [s.status, s.trust]), [["good", "ultimate"], ["expired-key", "undefined"]]);
  assertEquals(parseGpgStatus("gpg: no valid OpenPGP data found."), []);
  assertEquals(groupedFingerprint("b329438b2fb94515"), "B329 438B 2FB9 4515");
});

Deno.test("signature files", () => {
  assertEquals(signedFile("/d/x.iso.sig"), "/d/x.iso");
  assertEquals(signedFile("/d/x.tar.gz.asc"), "/d/x.tar.gz");
  assertEquals(signedFile("/d/x.iso"), undefined);
  const enc = (s: string) => new TextEncoder().encode(s);
  assertEquals(pgpKind(enc("-----BEGIN PGP SIGNATURE-----\n")), "signature");
  assertEquals(pgpKind(enc("-----BEGIN PGP MESSAGE-----\n")), "message");
  assertEquals(pgpKind(new Uint8Array([0x89, 0x02, 0x33])), "binary");
  assertEquals(pgpKind(enc("hello")), "other");
});
