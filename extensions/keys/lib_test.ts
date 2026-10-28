import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  agentState,
  capabilityWords,
  freeKeyName,
  groupFingerprint,
  keyBits,
  keygenArgs,
  keyHealth,
  keyType,
  parseAgentList,
  parseCertificate,
  parseFingerprintLine,
  parseGpgColons,
  parsePublicKey,
  privateKeyNames,
  sha256Fingerprint,
  splitUid,
  validKeyName,
  whenWords,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const ED25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPI2RmCuPAdtD9HthuUEjjKQoMMnyCUgeYEenld3afWe ada@laptop\n";
const RSA =
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCEZ6bx4oH6lq8UAZbGyFvtbPZWqwwXSZEnFTNNlmZjt53VzZiUWcHoPtKMfZvUHan975KGgabkx4AB5uOMYlvFTfsjavAfEjlkg/t+8RUjfgFIoQItVorZDFEqqoENCJ6Kl/2to0jTyXQYfRT8UIi/VgQtU/xOhDA8q9NmMfFwwtLnCa9YmokCEJwj7/3lmau8Z92+Cx/bjRfVb2R2FCCUfQ7zVVmJjsqzk1SMgi3Z83RFNU90swU8FPaFOYkKZtQ3XuguO1RXj5EQOT68GgEIcApcBzhVyS4oEGKWKTVO6VShrjSGpJ6G8hxjLwXCqV2ZYeXn1G99WFHttDJmvvUjFdI7Hun7svIm5j06ud/TFbjPk7yjZyRSRTGS5rP+Us1k2ZL3VMZpG3JtsLVjRFn8mgGq/mXIGd6Ncr+jIWPFLF+OvcZ+G6WHItGyXq6BHvkVtegIyMOrd1zWXeoI5W/nLG0b/kZhe6q/ae1jqUKUgllz/F5g+U8vSzRO6xcu3Zk= work key";

// gpg 2.4: --list-secret-keys --with-colons --fixed-list-mode (an Ed25519 key with an
// encryption subkey, and an RSA key that expired).
const GPG_SECRET = `sec:u:255:22:36093707DAC5A381:1793222855:1856294855::u:::scESC:::+::ed25519:::0:
fpr:::::::::F91FA9F180CE36F427CB4D1336093707DAC5A381:
grp:::::::::9FD8162BC29FD22B190F79AF96160F2DFA50F5BC:
uid:u::::1793222855::25B13987862EACE75FF36BB1519F10E5B0E5355E::Ada Lovelace (work) <ada@example.com>::::::::::0:
uid:r::::1793222855::25B13987862EACE75FF36BB1519F10E5B0E5355F::Ada \\x3a old <ada@old.example>::::::::::0:
ssb:u:255:18:6967DB979D77AC1C:1793222855:1824758855:::::e:::+::cv25519::
fpr:::::::::BF926650F04C6A0384F388DF6967DB979D77AC1C:
grp:::::::::BD35F65600955ED79A77959FC8C0F90328A7C608:
sec:e:2048:1:75553654FAD3479C:1793222855:1793222856::u:::sc:::#:::23::0:
fpr:::::::::DC485930E7EAF24F0DBC031875553654FAD3479C:
grp:::::::::01C64274C6CC1DD25715F9461A2708BC40EF1FF7:
uid:e::::1793222855::5626D54278E39514CD5BEEE0F156438F0AC8F715::Old Key <old@example.com>::::::::::0:
`;

Deno.test("public key files", () => {
  const k = parsePublicKey(ED25519)!;
  assertEquals(k.algorithm, "ssh-ed25519");
  assertEquals(k.comment, "ada@laptop");
  assertEquals(parsePublicKey(`no-pty,command="x" ${ED25519}`)?.algorithm, "ssh-ed25519");
  assertEquals(parsePublicKey("not a key"), undefined);
  assertEquals(
    parsePublicKey("sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIA== yubikey")?.algorithm,
    "sk-ssh-ed25519@openssh.com",
  );
});

Deno.test("type, bits and SHA256 fingerprint computed like ssh-keygen", async () => {
  const ed = parsePublicKey(ED25519)!, rsa = parsePublicKey(RSA)!;
  assertEquals([keyType(ed.algorithm), keyBits(ed)], ["ED25519", 256]);
  assertEquals([keyType(rsa.algorithm), keyBits(rsa)], ["RSA", 3072]);
  assertEquals(keyType("ecdsa-sha2-nistp256"), "ECDSA");
  assertEquals(keyBits({ algorithm: "ecdsa-sha2-nistp384", blob: "", comment: "" }), 384);
  assertEquals(keyType("sk-ssh-ed25519@openssh.com"), "ED25519-SK");
  assertEquals(keyType("ssh-ed25519-cert-v01@openssh.com"), "ED25519-CERT");
  assertEquals(await sha256Fingerprint(ed.blob), "SHA256:xQ/lUuR/ZbYqf9z0Z5PvUkvdkyh4Ot/awvhAjb9i2tA");
  assertEquals(await sha256Fingerprint(rsa.blob), "SHA256:apefGeE9RKWE2aBZldkQCg3nzrhasmo94p6sWN9fPKc");
});

Deno.test("ssh-keygen -l and ssh-add -l lines", () => {
  assertEquals(parseFingerprintLine("256 SHA256:xQ/lUuR/ZbYqf9z0Z5PvUkvdkyh4Ot/awvhAjb9i2tA ada@laptop (ED25519)"), {
    bits: 256,
    fingerprint: "SHA256:xQ/lUuR/ZbYqf9z0Z5PvUkvdkyh4Ot/awvhAjb9i2tA",
    comment: "ada@laptop",
    type: "ED25519",
  });
  assertEquals(parseFingerprintLine("3072 SHA256:apef no comment (RSA)")?.comment, "");
  assertEquals(
    parseAgentList(
      "256 SHA256:xQ/lUuR/ZbYqf9z0Z5PvUkvdkyh4Ot/awvhAjb9i2tA ada@laptop (ED25519)\n3072 SHA256:apef work key (RSA)",
    ).map((k) => k.comment),
    ["ada@laptop", "work key"],
  );
  assertEquals(agentState("ssh-add exited with 1: The agent has no identities."), "empty");
  assertEquals(agentState("Could not open a connection to your authentication agent."), "no-agent");
  assertEquals(agentState("Error connecting to agent: No such file or directory"), "no-agent");
});

Deno.test("certificates", () => {
  const out = `/home/ada/.ssh/id_ed25519-cert.pub:
        Type: ssh-ed25519-cert-v01@openssh.com user certificate
        Public key: ED25519-CERT SHA256:xQ/lUuR/ZbYqf9z0Z5PvUkvdkyh4Ot/awvhAjb9i2tA
        Signing CA: ED25519 SHA256:abc (using ssh-ed25519)
        Key ID: "ada@corp"
        Serial: 0
        Valid: from 2026-10-01T09:00:00 to 2026-10-02T09:00:00
        Principals: 
                ada
                deploy
        Critical Options: (none)
        Extensions: 
                permit-pty
`;
  const c = parseCertificate(out);
  assertEquals(c.keyId, "ada@corp");
  assertEquals(c.principals, ["ada", "deploy"]);
  assertEquals(c.validTo, new Date(2026, 9, 2, 9, 0, 0).getTime());
  assertEquals(keyHealth({ validity: "", expires: c.validTo }, new Date(2026, 9, 28).getTime()), "expired");
  assertEquals(parseCertificate("        Valid: forever\n").validTo, undefined);
});

Deno.test("private keys are found by name only", () => {
  assertEquals(
    privateKeyNames([
      "config",
      "known_hosts",
      "known_hosts.old",
      "id_ed25519",
      "id_ed25519.pub",
      "id_ed25519-cert.pub",
      "id_rsa_old",
      "work",
      "work.pub",
      "authorized_keys",
    ]),
    ["id_ed25519", "id_rsa_old", "work"],
  );
});

Deno.test("new key names and ssh-keygen arguments", () => {
  assertEquals(freeKeyName(["id_ed25519", "id_ed25519.pub", "id_ed25519_2.pub"]), "id_ed25519_3");
  assertEquals(freeKeyName(["config"]), "id_ed25519");
  assertEquals(validKeyName("id_ed25519_work"), undefined);
  assert(validKeyName("../evil"));
  assert(validKeyName("config"));
  assert(validKeyName("key.pub"));
  assert(validKeyName(""));
  assertEquals(keygenArgs("/home/ada/.ssh/k", "ada@laptop", ""), [
    "-t",
    "ed25519",
    "-a",
    "100",
    "-f",
    "/home/ada/.ssh/k",
    "-N",
    "",
    "-C",
    "ada@laptop",
    "-q",
  ]);
});

Deno.test("GnuPG colon listing", () => {
  const [ada, old] = parseGpgColons(GPG_SECRET);
  assertEquals(ada.fingerprint, "F91FA9F180CE36F427CB4D1336093707DAC5A381");
  assertEquals(ada.algorithm, "ed25519");
  assertEquals(ada.secret, true);
  assertEquals(ada.created, 1793222855000);
  assertEquals(ada.expires, 1856294855000);
  assertEquals(ada.uids.map((u) => [u.name, u.email, u.validity]), [
    ["Ada Lovelace", "ada@example.com", "u"],
    ["Ada : old", "ada@old.example", "r"],
  ]);
  assertEquals(ada.subkeys.length, 1);
  assertEquals(ada.subkeys[0].fingerprint, "BF926650F04C6A0384F388DF6967DB979D77AC1C");
  assertEquals(capabilityWords(ada.capabilities), ["sign", "certify", "encrypt"]);
  assertEquals(capabilityWords(ada.subkeys[0].capabilities), ["encrypt"]);
  assertEquals(old.algorithm, "RSA 2048");
  assertEquals(old.card, "#");
  assertEquals(capabilityWords(old.capabilities), ["sign", "certify"]);
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(keyHealth(old, now), "expired");
  assertEquals(keyHealth(ada, now), "ok");
  assertEquals(keyHealth(ada, 1856294855000 - 5 * 86_400_000), "expiring");
  assertEquals(keyHealth({ validity: "r" }, now), "revoked");
});

Deno.test("identities, dates and fingerprints", () => {
  assertEquals(splitUid("Ada Lovelace <ada@example.com>"), { name: "Ada Lovelace", email: "ada@example.com" });
  assertEquals(splitUid("ada@example.com"), { name: "ada@example.com", email: "ada@example.com" });
  assertEquals(splitUid("Just a name"), { name: "Just a name" });
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(whenWords(now + 10 * 86_400_000, now), "in 10 days");
  assertEquals(whenWords(now - 400 * 86_400_000, now), "13 months ago");
  assertEquals(whenWords(undefined, now), "never");
  assertEquals(groupFingerprint("F91FA9F180CE36F4"), "F91F A9F1 80CE 36F4");
});

Deno.test("terminals match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
  };
  assertEquals(manifest.permissions.run.slice(4), TERMINALS);
});
