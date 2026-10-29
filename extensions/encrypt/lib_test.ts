import { assertEquals, assertThrows } from "@std/assert";
import {
  ageDecryptArgs,
  ageEncryptArgs,
  ageStanzas,
  armoredKind,
  asText,
  decryptedPath,
  decryptError,
  encryptedPath,
  gpgEncryptArgs,
  identityKind,
  parseEncTo,
  parseFileList,
  parseGpgKeys,
  parsePublicKeys,
  parseRecipients,
  parseSshKey,
  recipientsOf,
  recipientTitle,
  schemeOf,
  splitUid,
  usableKeys,
} from "./lib.ts";

const AGE = "age16rwca6gq34ec58es5hwr22kd06w70wssluv6y7wpnxfcmcmgu4nsvnfh7x";
const SSH = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHsKLqeplhpW+uObz5dvMgjz1OxfM/XXUB+VHtZ6isGN";
const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("copied files", () => {
  assertEquals(parseFileList("copy\nfile:///home/ada/Documents/Imp%C3%B4ts%202026.pdf"), [
    "/home/ada/Documents/Impôts 2026.pdf",
  ]);
});

Deno.test("recipients from the preference", () => {
  const { recipients, invalid } = parseRecipients(
    `${AGE} # Alice\nBob: ${SSH} bob@laptop\n\n# a comment\nnot-a-key, ${AGE}\nssh-dss AAAAB3Nza bad`,
  );
  assertEquals(recipients.map((r) => [r.kind, r.label]), [["age", "Alice"], ["ssh", "Bob"]]);
  assertEquals(recipients[1].key, SSH);
  assertEquals(invalid, ["not-a-key", "ssh-dss AAAAB3Nza bad"]);
  assertEquals(recipientTitle({ key: AGE, kind: "age", source: "" }), "age16rwca6gq…vnfh7x");
  assertEquals(parseRecipients(`${AGE},${AGE}`).recipients.length, 1);
});

Deno.test("SSH public keys", () => {
  assertEquals(parseSshKey(`${SSH} ada@desk\n`, "~/.ssh/id_ed25519.pub"), {
    key: SSH,
    kind: "ssh",
    label: "ada@desk",
    source: "~/.ssh/id_ed25519.pub",
  });
  assertEquals(parseSshKey("ecdsa-sha2-nistp256 AAAAE2VjZHNh ada@x"), undefined);
  assertEquals(parseSshKey("sk-ssh-ed25519@openssh.com AAAAGnNr ada@x"), undefined);
});

Deno.test("identities", () => {
  assertEquals(
    identityKind(
      "# created: 2026-10-29\n# public key: age1…\nAGE-SECRET-KEY-107QRCUTK0CLP3WNMPD0CFF2YEMEQ6HMXXKZ25T0DYYL0VEED83DSPAZPLH\n",
    ),
    "age",
  );
  assertEquals(identityKind("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n"), "ssh");
  assertEquals(identityKind("hello"), "other");
  assertEquals(parsePublicKeys(`${AGE}\n\n`), [AGE]);
});

const HEADER =
  "age-encryption.org/v1\n-> X25519 CbrUQR9CjO6vd3aOlA5aisdPMAlkDjME/+5TvA2YyTw\nULfK401b6j45QFeVKg1GPGyY\n" +
  "-> ssh-ed25519 Ry4NZw Zm9v\nYmFy\n--- 7xuH0TG2X5Dbg3Sg\nåØbinary";

Deno.test("what an age file is for", () => {
  assertEquals(ageStanzas(enc(HEADER)), ["X25519", "ssh-ed25519"]);
  assertEquals(schemeOf(enc(HEADER)), "age");
  const scrypt = "age-encryption.org/v1\n-> scrypt 1Dv3Q0w3zZ3f 18\nabcd\n--- mac\n";
  assertEquals(schemeOf(enc(scrypt)), "age-passphrase");
  // Armored: the header is base64 inside the armor.
  const b64 = btoa(HEADER.slice(0, HEADER.indexOf("---") + 3)).match(/.{1,64}/g)!.join("\n");
  const armored = `-----BEGIN AGE ENCRYPTED FILE-----\n${b64}\n-----END AGE ENCRYPTED FILE-----\n`;
  assertEquals(ageStanzas(enc(armored)), ["X25519", "ssh-ed25519"]);
  assertEquals(armoredKind(armored), "age");
  assertEquals(schemeOf(enc("hello")), "unknown");
});

Deno.test("what a gpg file is", () => {
  assertEquals(schemeOf(enc("-----BEGIN PGP MESSAGE-----\n\nhQEMA...\n")), "gpg-armored");
  // Old-format packet tag 1 (public-key encrypted session key): 0x84 / 0x85.
  assertEquals(schemeOf(new Uint8Array([0x85, 0x01, 0x0c])), "gpg");
  // New-format tag 3 (symmetric): 0xc3.
  assertEquals(schemeOf(new Uint8Array([0xc3, 0x0d])), "gpg");
  // A signature (tag 2) isn't encrypted.
  assertEquals(schemeOf(new Uint8Array([0x89, 0x02])), "unknown");
  assertEquals(armoredKind("-----BEGIN PGP MESSAGE-----\nabc\n-----END PGP MESSAGE-----"), "gpg");
  assertEquals(armoredKind("just text"), undefined);
});

const COLONS = `tru::1:1793260991:1856332991:3:1:5
pub:u:255:22:2CD18FAC4456D33C:1793260991:1856332991::u:::scESC:::::ed25519:::0:
fpr:::::::::B329438B2FB94515F5B540882CD18FAC4456D33C:
uid:u::::1793260991::2EBD48EFBB417D7955BBA1B137F4D1B4DA422F9B::Ada Lovelace <ada@example.com>::::::::::0:
uid:r::::1793260991::AAAA::Old Name <old@example.com>::::::::::0:
sub:u:255:18:DB94B4370E1AC1A4:1793260991:1856332991:::::e:::::cv25519::
fpr:::::::::1D11E94E677722298F184976DB94B4370E1AC1A4:
pub:e:255:22:1111222233334444:1600000000:1700000000::-:::sc:::::ed25519:::0:
fpr:::::::::AAAABBBBCCCCDDDDEEEEFFFF1111222233334444:
uid:e::::1600000000::BBBB::Expired Key \\x3a test <exp@example.com>::::::::::0:
pub:f:3072:1:5555666677778888:1700000000:::f:::scSC:::::::0:
fpr:::::::::9999888877776666555544443333222211110000:
uid:f::::1700000000::CCCC::Sign Only <sign@example.com>::::::::::0:
`;

Deno.test("gpg --list-keys --with-colons", () => {
  const keys = parseGpgKeys(COLONS);
  assertEquals(keys.length, 3);
  assertEquals(keys[0].fingerprint, "B329438B2FB94515F5B540882CD18FAC4456D33C");
  assertEquals(keys[0].uids, ["Ada Lovelace <ada@example.com>"]);
  assertEquals(keys[0].subkeys, ["DB94B4370E1AC1A4"]);
  assertEquals(keys[0].canEncrypt, true);
  assertEquals(keys[0].expires?.getTime(), 1856332991000);
  assertEquals(keys[1].expired, true);
  assertEquals(keys[1].uids, ["Expired Key : test <exp@example.com>"]);
  assertEquals(keys[2].canEncrypt, false);
  assertEquals(usableKeys(keys).map((k) => k.keyId), ["2CD18FAC4456D33C"]);
  assertEquals(splitUid("Ada Lovelace (work) <ada@example.com>"), { name: "Ada Lovelace", email: "ada@example.com" });
  assertEquals(splitUid("<bot@example.com>"), { name: "bot@example.com", email: "bot@example.com" });
  assertEquals(splitUid("Just a name"), { name: "Just a name" });
  // ENC_TO names the subkey: it is found through the primary key.
  const ids = parseEncTo("[GNUPG:] ENC_TO DB94B4370E1AC1A4 18 0\n[GNUPG:] ENC_TO 0123456789ABCDEF 1 0\n");
  assertEquals(ids, ["DB94B4370E1AC1A4", "0123456789ABCDEF"]);
  assertEquals(recipientsOf(ids, keys).map((r) => r.key?.keyId), ["2CD18FAC4456D33C", undefined]);
});

Deno.test("output names never overwrite", () => {
  const disk = new Set(["/d/report.pdf", "/d/report.pdf.age", "/d/secret"]);
  const exists = (p: string) => disk.has(p);
  assertEquals(encryptedPath("/d/report.pdf", "age", exists), "/d/report.pdf-2.age");
  assertEquals(encryptedPath("/d/report.pdf", "gpg", exists), "/d/report.pdf.gpg");
  assertEquals(decryptedPath("/d/report.pdf.age", exists), "/d/report-2.pdf");
  assertEquals(decryptedPath("/d/notes.txt.gpg", exists), "/d/notes.txt");
  assertEquals(decryptedPath("/d/secret.asc", exists), "/d/secret-2");
  assertEquals(decryptedPath("/d/.age", exists), "/d/decrypted");
});

Deno.test("command lines", () => {
  assertEquals(ageEncryptArgs([AGE, SSH], { input: "/d/a", output: "/d/a.age" }), [
    "-e",
    "-r",
    AGE,
    "-r",
    SSH,
    "-o",
    "/d/a.age",
    "--",
    "/d/a",
  ]);
  assertEquals(ageEncryptArgs([AGE], { armor: true }), ["-e", "-a", "-r", AGE]);
  assertThrows(() => ageEncryptArgs([], {}), Error, "at least one");
  assertEquals(ageDecryptArgs(["/k1", "/k2"], { input: "/d/a.age", output: "/d/a" }), [
    "-d",
    "-i",
    "/k1",
    "-i",
    "/k2",
    "-o",
    "/d/a",
    "--",
    "/d/a.age",
  ]);
  const g = gpgEncryptArgs(["FPR1"], { input: "/d/a", output: "/d/a.gpg", self: "ME" });
  assertEquals(g.slice(0, 5), ["--batch", "--no-tty", "--trust-model", "always", "--encrypt"]);
  assertEquals(g.slice(5), ["--recipient", "FPR1", "--encrypt-to", "ME", "--output", "/d/a.gpg", "--", "/d/a"]);
  assertEquals(gpgEncryptArgs(["ME"], { self: "ME", armor: true }).includes("--encrypt-to"), false);
});

Deno.test("errors people understand", () => {
  assertEquals(
    decryptError(
      "age exited with 1: age: error: no identity matched any of the recipients\nage: report unexpected or unhelpful errors at https://filippo.io/age/report",
    ),
    "None of your age identities can open it",
  );
  assertEquals(decryptError("gpg: decryption failed: No secret key"), "Your keyring has no key that can open it");
  assertEquals(
    decryptError("gpg: public key decryption failed: Inappropriate ioctl for device"),
    "No passphrase prompt could open: decrypt it in a terminal",
  );
  assertEquals(decryptError("age: error: header: weird"), "header: weird");
});

Deno.test("text or binary", () => {
  assertEquals(asText(enc("hunter2\n")), "hunter2\n");
  assertEquals(asText(new Uint8Array([0x00, 0x01])), undefined);
  assertEquals(asText(new Uint8Array([0xff, 0xfe, 0x41])), undefined);
});
