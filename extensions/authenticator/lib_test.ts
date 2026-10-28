import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
  accountFrom,
  areaTools,
  base32Decode,
  base32Encode,
  buildOtpauth,
  detectSession,
  displayName,
  groupCode,
  hotp,
  installCommand,
  normalizeSecret,
  osFamily,
  parseExport,
  parseLinks,
  parseMigration,
  parseOtpauth,
  sameAccount,
  scanScript,
  seal,
  secondsLeft,
  sortAccounts,
  systemdRunArgs,
  tintFor,
  totp,
  unseal,
  vaultKey,
} from "./lib.ts";

const ascii = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("base32: RFC 4648 test vectors", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY======"],
    ["fo", "MZXQ===="],
    ["foo", "MZXW6==="],
    ["foob", "MZXW6YQ="],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI======"],
  ];
  for (const [plain, encoded] of vectors) {
    assertEquals(text(base32Decode(encoded)), plain);
    assertEquals(base32Encode(ascii(plain), true), encoded);
    assertEquals(base32Encode(ascii(plain)), encoded.replace(/=+$/, ""));
  }
});

Deno.test("base32: lenient input, strict alphabet", () => {
  assertEquals(text(base32Decode("mzxw 6ytb-oi")), "foobar");
  assertEquals(normalizeSecret("jbsw y3dp ehpk 3pxp"), "JBSWY3DPEHPK3PXP");
  assertThrows(() => base32Decode("MZXW1"), Error, "not a base32 character");
  assertThrows(() => normalizeSecret("  "), Error, "empty");
  assertThrows(() => normalizeSecret("MZXW"), Error, "too short");
});

Deno.test("HOTP: RFC 4226 appendix D", async () => {
  const key = ascii("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  for (let i = 0; i < expected.length; i++) assertEquals(await hotp(key, i), expected[i]);
});

Deno.test("TOTP: RFC 6238 appendix B, SHA-1, SHA-256 and SHA-512", async () => {
  const keys = {
    SHA1: ascii("12345678901234567890"),
    SHA256: ascii("12345678901234567890123456789012"),
    SHA512: ascii("1234567890123456789012345678901234567890123456789012345678901234"),
  };
  const table: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [t, sha1, sha256, sha512] of table) {
    assertEquals(await totp(keys.SHA1, t, { digits: 8, period: 30, algorithm: "SHA1" }), sha1, `SHA1 @${t}`);
    assertEquals(await totp(keys.SHA256, t, { digits: 8, period: 30, algorithm: "SHA256" }), sha256, `SHA256 @${t}`);
    assertEquals(await totp(keys.SHA512, t, { digits: 8, period: 30, algorithm: "SHA512" }), sha512, `SHA512 @${t}`);
  }
  // 6 digits are the last 6 of the 8.
  assertEquals(await totp(keys.SHA1, 59), "287082");
});

Deno.test("countdown and grouping", () => {
  assertEquals(secondsLeft(59, 30), 1);
  assertEquals(secondsLeft(60, 30), 30);
  assertEquals(secondsLeft(61.9, 30), 29);
  assertEquals(groupCode("123456"), "123 456");
  assertEquals(groupCode("12345678"), "1234 5678");
  assertEquals(groupCode("1234567"), "123 4567");
});

Deno.test("otpauth links", () => {
  const a = parseOtpauth(
    "otpauth://totp/ACME%20Co:john.doe@email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30",
  );
  assertEquals(a, {
    issuer: "ACME Co",
    account: "john.doe@email.com",
    secret: "HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ",
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });
  // The issuer parameter wins over the label prefix; defaults apply.
  const b = parseOtpauth("otpauth://totp/Old:ada?secret=jbswy3dpehpk3pxp&issuer=GitHub");
  assertEquals([b.issuer, b.account, b.secret, b.digits, b.period], ["GitHub", "ada", "JBSWY3DPEHPK3PXP", 6, 30]);
  const c = parseOtpauth("otpauth://totp/ada@proton.me?secret=JBSWY3DPEHPK3PXP&algorithm=sha256&digits=8&period=60");
  assertEquals([c.issuer, c.account, c.algorithm, c.digits, c.period], ["", "ada@proton.me", "SHA256", 8, 60]);
  assertThrows(() => parseOtpauth("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1"), Error, "HOTP");
  assertThrows(() => parseOtpauth("otpauth://totp/x?issuer=a"), Error, "no secret");
  assertThrows(() => parseOtpauth("https://example.com"), Error, "Not an otpauth");
  assertThrows(() => parseOtpauth("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5"), Error, "MD5");
  // Round trip.
  assertEquals(parseOtpauth(buildOtpauth(a)), a);
  assertEquals(parseOtpauth(buildOtpauth({ ...a, issuer: "" })).issuer, "");
});

Deno.test("form values", () => {
  const a = accountFrom({
    issuer: " GitHub ",
    account: "ada",
    secret: "jbsw y3dp ehpk 3pxp",
    digits: "8",
    period: "30",
  });
  assertEquals([a.issuer, a.secret, a.digits, a.algorithm], ["GitHub", "JBSWY3DPEHPK3PXP", 8, "SHA1"]);
  assertThrows(() => accountFrom({ secret: "JBSWY3DPEHPK3PXP" }), Error, "issuer or a name");
  assertThrows(() => accountFrom({ issuer: "x", secret: "JBSWY3DPEHPK3PXP", digits: "4" }), Error, "Digits");
  assertThrows(() => accountFrom({ issuer: "x", secret: "JBSWY3DPEHPK3PXP", period: "abc" }), Error, "Period");
});

// A tiny protobuf writer, to build Google Authenticator exports.
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
const bytesField = (
  field: number,
  data: Uint8Array | number[],
) => [...varint(field * 8 + 2), ...varint(data.length), ...data];
const intField = (field: number, n: number) => [...varint(field * 8), ...varint(n)];

Deno.test("Google Authenticator transfer QR codes", () => {
  const google = [
    ...bytesField(1, ascii("12345678901234567890")),
    ...bytesField(2, ascii("ada@gmail.com")),
    ...bytesField(3, ascii("Google")),
    ...intField(4, 1),
    ...intField(5, 1),
    ...intField(6, 2),
  ];
  const prefixed = [
    ...bytesField(1, ascii("abcdefghij")),
    ...bytesField(2, ascii("Dropbox:ada")),
    ...intField(4, 2),
    ...intField(5, 2),
    ...intField(6, 2),
  ];
  const counter = [...bytesField(1, ascii("abcdefghij")), ...bytesField(2, ascii("Old bank")), ...intField(6, 1)];
  const payload = new Uint8Array([
    ...bytesField(1, google),
    ...bytesField(1, prefixed),
    ...bytesField(1, counter),
    ...intField(2, 1),
    ...intField(3, 1),
  ]);
  const uri = `otpauth-migration://offline?data=${encodeURIComponent(btoa(String.fromCharCode(...payload)))}`;
  const r = parseMigration(uri);
  assertEquals(r.accounts, [
    {
      issuer: "Google",
      account: "ada@gmail.com",
      secret: base32Encode(ascii("12345678901234567890")),
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    },
    {
      issuer: "Dropbox",
      account: "ada",
      secret: base32Encode(ascii("abcdefghij")),
      digits: 8,
      period: 30,
      algorithm: "SHA256",
    },
  ]);
  assertEquals(r.skipped, ["Old bank (counter-based)"]);
  // Also accepted among links.
  assertEquals(parseLinks(`${uri}\notpauth://totp/X:y?secret=JBSWY3DPEHPK3PXP`).accounts.length, 3);
});

const AEGIS = JSON.stringify({
  version: 1,
  header: { slots: null, params: null },
  db: {
    version: 2,
    entries: [
      {
        type: "totp",
        uuid: "3ae6f1ad-2e65-4ed2-a953-1ec0dff2386d",
        name: "ada@example.com",
        issuer: "Mastodon",
        note: "",
        icon: null,
        info: { secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ", algo: "SHA1", digits: 6, period: 30 },
      },
      {
        type: "totp",
        uuid: "a",
        name: "ada",
        issuer: "Bitwarden",
        info: { secret: "JBSWY3DPEHPK3PXP", algo: "SHA256", digits: 8, period: 60 },
      },
      { type: "hotp", uuid: "b", name: "x", issuer: "Bank", info: { secret: "JBSWY3DPEHPK3PXP", counter: 3 } },
      { type: "steam", uuid: "c", name: "gaben", issuer: "Steam", info: { secret: "JBSWY3DPEHPK3PXP" } },
      { type: "totp", uuid: "d", name: "bad", issuer: "Broken", info: { secret: "!!!", algo: "SHA1" } },
    ],
  },
});

Deno.test("Aegis plain export", () => {
  const r = parseExport(AEGIS);
  assertEquals(r.accounts.map((a) => [a.issuer, a.account, a.algorithm, a.digits, a.period]), [
    ["Mastodon", "ada@example.com", "SHA1", 6, 30],
    ["Bitwarden", "ada", "SHA256", 8, 60],
  ]);
  assertEquals(r.skipped.length, 3);
  assertStringIncludes(r.skipped.join(), "Bank (hotp)");
  assertStringIncludes(r.skipped.join(), "Broken");
  const encrypted = JSON.stringify({ version: 1, header: { slots: [{ type: 1 }], params: {} }, db: "b64…" });
  assertThrows(() => parseExport(encrypted), Error, "encrypted");
});

Deno.test("2FAS export", () => {
  const twofas = JSON.stringify({
    services: [
      {
        name: "GitLab",
        secret: "JBSWY3DPEHPK3PXP",
        otp: {
          label: "ada",
          account: "ada",
          issuer: "GitLab",
          digits: 6,
          period: 30,
          algorithm: "SHA1",
          tokenType: "TOTP",
        },
        order: { position: 1 },
      },
      {
        name: "Discord",
        secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ",
        otp: { account: "ada#1234", digits: 6, period: 30, algorithm: "SHA1", tokenType: "TOTP" },
        order: { position: 0 },
      },
      { name: "Bank", secret: "JBSWY3DPEHPK3PXP", otp: { tokenType: "HOTP", counter: 2 }, order: { position: 2 } },
    ],
    schemaVersion: 4,
    appVersionCode: 5000000,
  });
  const r = parseExport(twofas);
  assertEquals(r.accounts.map((a) => [a.issuer, a.account]), [["Discord", "ada#1234"], ["GitLab", "ada"]]);
  assertEquals(r.skipped, ["Bank (HOTP)"]);
  assertThrows(
    () => parseExport(JSON.stringify({ services: [], servicesEncrypted: "abc", schemaVersion: 4 })),
    Error,
    "encrypted",
  );
  assertThrows(() => parseExport('{"hello": 1}'), Error, "Not an Aegis or 2FAS");
  assertThrows(() => parseExport("{oops"), Error, "valid JSON");
});

Deno.test("plain text of links", () => {
  const r = parseExport("otpauth://totp/A:a?secret=JBSWY3DPEHPK3PXP\n\nhttps://nope\n");
  assertEquals(r.accounts.length, 1);
  assertEquals(r.skipped.length, 1);
  assertThrows(() => parseLinks(""), Error, "No otpauth");
});

Deno.test("duplicates, names, colors, order", () => {
  const a = parseOtpauth("otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP");
  assert(sameAccount(a, { ...a, issuer: "github" }));
  assert(!sameAccount(a, { ...a, secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ" }));
  assertEquals(displayName(a), { title: "GitHub", subtitle: "ada" });
  assertEquals(displayName({ issuer: "", account: "ada@x" }), { title: "ada@x" });
  assertEquals(tintFor("GitHub"), tintFor("github"));
  assertEquals(
    sortAccounts([{ issuer: "proton", account: "b" }, { issuer: "", account: "Amazon" }, {
      issuer: "Proton",
      account: "a",
    }]),
    [{ issuer: "", account: "Amazon" }, { issuer: "Proton", account: "a" }, { issuer: "proton", account: "b" }],
  );
});

Deno.test("vault: encrypted with the passphrase, a wrong one fails", async () => {
  const salt = btoa("0123456789abcdef");
  const key = await vaultKey("correct horse", salt, 1000);
  const sealed = await seal(key, "JBSWY3DPEHPK3PXP");
  assert(!sealed.data.includes("JBSW"));
  assertEquals(await unseal(key, sealed), "JBSWY3DPEHPK3PXP");
  const wrong = await vaultKey("battery staple", salt, 1000);
  await assertRejects(() => unseal(wrong, sealed));
  // A fresh IV each time.
  assert((await seal(key, "x")).iv !== (await seal(key, "x")).iv);
});

Deno.test("scan script: the link goes to the keyring, the picture is removed", () => {
  const ring = scanScript({ tool: "grim", cache: "/home/ada/.cache/backslash/authenticator", keyring: true });
  const lines = ring.split("\n");
  assertEquals(lines[0], "umask 077");
  assertStringIncludes(
    ring,
    `geometry=$(slurp -d) || exit 0; grim -g "$geometry" '/home/ada/.cache/backslash/authenticator/scan.png'`,
  );
  assertStringIncludes(
    ring,
    `printf %s "$out" | secret-tool store --label='Backslash Authenticator: scanned account' 'application' 'backslash-authenticator' 'pending' "$id" && : > '/home/ada/.cache/backslash/authenticator/scans/'"$id.pending"`,
  );
  // The picture is deleted before anything else happens with the link.
  assert(
    lines.indexOf(`rm -f '/home/ada/.cache/backslash/authenticator/scan.png'`, 5) <
      lines.findIndex((l) => l.includes("secret-tool")),
  );
  assert(!ring.includes(".uri"));
  const file = scanScript({ tool: "maim", cache: "/c", keyring: false });
  assertStringIncludes(file, `printf '%s\\n' "$out" > '/c/scans/'"$id.uri"`);
  assertStringIncludes(file, "maim -s '/c/scan.png'");
});

Deno.test("background job and session", () => {
  const args = systemdRunArgs("u", "echo", { DISPLAY: ":0", WAYLAND_DISPLAY: undefined });
  assertEquals(args.slice(0, 3), ["--user", "--quiet", "--unit=u"]);
  assert(args.includes("--setenv=DISPLAY=:0"));
  assert(!args.some((a) => a.startsWith("--setenv=WAYLAND")));
  assertEquals(args.slice(-3), ["/bin/sh", "-c", "echo"]);
  assertEquals(areaTools(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "GNOME" })), [
    "gnome-screenshot",
  ]);
  assertEquals(areaTools(detectSession({ XDG_SESSION_TYPE: "x11" }))[0], "maim");
  assertEquals(osFamily("ID=ubuntu\nID_LIKE=debian"), "debian");
  assertEquals(installCommand(["secret-tool", "zbarimg"], "debian"), "sudo apt install libsecret-tools zbar-tools");
  assertEquals(installCommand(["secret-tool"], "arch"), "sudo pacman -S libsecret");
});
