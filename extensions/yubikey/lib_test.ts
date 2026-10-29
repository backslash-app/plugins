import { assertEquals, assertThrows } from "@std/assert";
import {
  cleanSecret,
  explainYkman,
  field,
  groupCode,
  installCommand,
  oath,
  osFamily,
  parseCardStatus,
  parseCodes,
  parseInfo,
  parseList,
  parseOtpauth,
  parseReport,
  parseSingleCode,
  secondsLeft,
  slotTitle,
  splitId,
  triesLeft,
} from "./lib.ts";

Deno.test("ykman list", () => {
  assertEquals(
    parseList("YubiKey 5 NFC (5.4.3) [OTP+FIDO+CCID] Serial: 12345678\nYubiKey 4 (4.3.7) [OTP+FIDO+CCID]\n"),
    [
      { name: "YubiKey 5 NFC", firmware: "5.4.3", interfaces: ["OTP", "FIDO", "CCID"], serial: "12345678" },
      { name: "YubiKey 4", firmware: "4.3.7", interfaces: ["OTP", "FIDO", "CCID"], serial: undefined },
    ],
  );
  assertEquals(parseList(""), []);
});

const INFO = `Device type: YubiKey 5 NFC
Serial number: 12345678
Firmware version: 5.4.3
Form factor: Keychain (USB-A)
Enabled USB interfaces: OTP, FIDO, CCID
NFC transport is enabled

Applications	USB     	NFC
Yubico OTP  	Enabled 	Enabled
FIDO U2F    	Enabled 	Enabled
FIDO2       	Enabled 	Enabled
OATH        	Enabled 	Enabled
PIV         	Enabled 	Disabled
OpenPGP     	Disabled	Enabled
YubiHSM Auth	Enabled 	Enabled
`;

Deno.test("ykman info: fields, notes and applications", () => {
  const info = parseInfo(INFO);
  assertEquals(field(info.fields, "serial number"), "12345678");
  assertEquals(field(info.fields, "Form factor"), "Keychain (USB-A)");
  assertEquals(info.notes, ["NFC transport is enabled"]);
  assertEquals(info.applications.length, 7);
  assertEquals(info.applications[5], { name: "OpenPGP", usb: "Disabled", nfc: "Enabled" });
  assertEquals(info.applications[6].name, "YubiHSM Auth");
  const spaces = parseInfo(
    "Device type: YubiKey 5C\n\nApplications\nOATH          Enabled\nPIV           Not available\n",
  );
  assertEquals(spaces.applications, [{ name: "OATH", usb: "Enabled", nfc: undefined }, {
    name: "PIV",
    usb: "Not available",
    nfc: undefined,
  }]);
});

Deno.test("oath codes: plain, touch, HOTP and Steam", () => {
  const accounts = parseCodes(`GitHub:ada                    123456
Google:ada@example.com        987654
Steam:ada                     [Requires Touch]
Bank                          [HOTP Account]
60/AWS:root                   12345678
Valve:steam                   5N2KD
`);
  assertEquals(accounts.map((a) => [a.issuer, a.name, a.code, a.touch, a.hotp]), [
    ["GitHub", "ada", "123456", false, false],
    ["Google", "ada@example.com", "987654", false, false],
    ["Steam", "ada", undefined, true, false],
    [undefined, "Bank", undefined, false, true],
    ["AWS", "root", "12345678", false, false],
    ["Valve", "steam", "5N2KD", false, false],
  ]);
  assertEquals(accounts[4].id, "60/AWS:root");
  assertEquals(splitId("Microsoft:ada:work"), { issuer: "Microsoft", name: "ada:work" });
  assertEquals(parseSingleCode("Touch your YubiKey...\n482913\n"), "482913");
  assertEquals(parseSingleCode(""), undefined);
  assertEquals(groupCode("123456"), "123 456");
  assertEquals(groupCode("12345678"), "1234 5678");
  assertEquals(groupCode("5N2KD"), "5N2KD");
  assertEquals(secondsLeft(Date.parse("2026-10-29T12:00:10Z")), 20);
});

Deno.test("otpauth links", () => {
  const a = parseOtpauth("otpauth://totp/GitHub:ada?secret=jbsw%20y3dp%20ehpk3pxp&issuer=GitHub&digits=8&period=60");
  assertEquals(a, {
    type: "totp",
    issuer: "GitHub",
    name: "ada",
    secret: "JBSWY3DPEHPK3PXP",
    digits: 8,
    period: 60,
    algorithm: "SHA1",
  });
  const b = parseOtpauth(
    "otpauth://hotp/Example%3Aalice%40example.com?secret=JBSWY3DPEHPK3PXP&counter=0&algorithm=sha256",
  );
  assertEquals([b.type, b.issuer, b.name, b.algorithm], ["hotp", "Example", "alice@example.com", "SHA256"]);
  assertEquals(parseOtpauth("otpauth://totp/OnlyName?secret=JBSWY3DP").issuer, undefined);
  assertThrows(() => parseOtpauth("https://example.com"), Error, "Not an otpauth");
  assertThrows(() => parseOtpauth("otpauth://totp/x?secret=not*base32"), Error, "base32");
  assertThrows(() => parseOtpauth("otpauth://totp/x"), Error, "no secret");
  assertThrows(() => parseOtpauth("otpauth://motp/x?secret=AAAA"), Error, "Unsupported");
  assertEquals(cleanSecret("jbsw y3dp-ehpk 3pxp"), "JBSWY3DPEHPK3PXP");
  assertThrows(() => cleanSecret("hello!"));
});

Deno.test("oath command lines", () => {
  assertEquals(oath.codes("123", "pw"), ["--device", "123", "oath", "accounts", "code", "-p", "pw"]);
  assertEquals(oath.codes(undefined), ["oath", "accounts", "code"]);
  assertEquals(oath.code("123", "GitHub:ada"), ["--device", "123", "oath", "accounts", "code", "-s", "GitHub:ada"]);
  assertEquals(oath.uri(undefined, "otpauth://totp/x?secret=A", true), [
    "oath",
    "accounts",
    "uri",
    "-t",
    "-f",
    "otpauth://totp/x?secret=A",
  ]);
  assertEquals(
    oath.add(
      "1",
      { type: "totp", issuer: "GitHub", name: "ada", secret: "JBSW", digits: 6, period: 30, algorithm: "SHA1" },
      false,
    ),
    [
      "--device",
      "1",
      "oath",
      "accounts",
      "add",
      "-o",
      "TOTP",
      "-d",
      "6",
      "-a",
      "SHA1",
      "-P",
      "30",
      "-i",
      "GitHub",
      "-f",
      "ada",
      "JBSW",
    ],
  );
  assertEquals(oath.rename(undefined, "a", "b:c"), ["oath", "accounts", "rename", "-f", "a", "b:c"]);
  assertEquals(oath.delete("9", "GitHub:ada"), ["--device", "9", "oath", "accounts", "delete", "-f", "GitHub:ada"]);
});

Deno.test("piv info: fields, warnings and slots", () => {
  const r = parseReport(`PIV version:              5.4.3
PIN tries remaining:      3/3
PUK tries remaining:      2/3
Management key algorithm: TDES
WARNING: Using default PIN!
WARNING: Using default Management key!
CHUID: No data available
CCC:   No data available
Slot 9A (AUTHENTICATION):
  Private key type: ECCP256
  Public key type:  ECCP256
  Subject DN:       CN=ada
  Issuer DN:        CN=ada
  Serial:           0x1234
  Fingerprint:      ab12cd34
  Not before:       2026-01-01T00:00:00+00:00
  Not after:        2027-01-01T00:00:00+00:00
Slot 9C (SIGNATURE):
  Algorithm:   RSA2048
  Subject DN:  CN=signer
`);
  assertEquals(field(r.fields, "PIN tries remaining"), "3/3");
  assertEquals(triesLeft(field(r.fields, "PUK tries remaining")), 2);
  assertEquals(r.warnings, ["Using default PIN!", "Using default Management key!"]);
  assertEquals(r.sections.map((s) => slotTitle(s.title)), ["9A · Authentication", "9C · Signature"]);
  assertEquals(field(r.sections[0].fields, "Subject DN"), "CN=ada");
  assertEquals(field(r.sections[1].fields, "Algorithm"), "RSA2048");
});

Deno.test("fido and openpgp info", () => {
  const fido = parseReport(
    "AAGUID: cb69481e-8ff7-4039-93ec-0a2729a154a8\nPIN: 8 attempt(s) remaining\nMinimum PIN length: 4\n",
  );
  assertEquals(triesLeft(field(fido.fields, "PIN")), 8);
  assertEquals(triesLeft("Not set"), undefined);
  const pgp = parseReport(`OpenPGP version:            3.4
Application version:        5.4.3
PIN tries remaining:        3
Reset code tries remaining: 0
Admin PIN tries remaining:  3
Require PIN for signature:  Once
Touch policies:
  Signature key:      On
  Encryption key:     Off
  Authentication key: Cached
`);
  assertEquals(field(pgp.fields, "OpenPGP version"), "3.4");
  assertEquals(pgp.sections[0].title, "Touch policies");
  assertEquals(pgp.sections[0].fields[2], ["Authentication key", "Cached"]);
});

Deno.test("gpg --card-status", () => {
  const fields = parseCardStatus(`Reader ...........: Yubico YubiKey OTP FIDO CCID 00 00
Application ID ...: D2760001240103040006123456780000
Version ..........: 3.4
Manufacturer .....: Yubico
Serial number ....: 12345678
Name of cardholder: Ada Lovelace
Signature key ....: 1234 5678 9ABC DEF0 1234  5678 9ABC DEF0 1234 5678
      created ....: 2026-01-01 10:00:00
Encryption key....: [none]
General key info..: pub  ed25519/9ABCDEF012345678 2026-01-01 Ada Lovelace <ada@example.com>
sec>  ed25519/9ABCDEF012345678  created: 2026-01-01  expires: never
`);
  assertEquals(fields.find(([k]) => k === "Name of cardholder")?.[1], "Ada Lovelace");
  assertEquals(fields.find(([k]) => k === "Signature key")?.[1], "1234 5678 9ABC DEF0 1234  5678 9ABC DEF0 1234 5678");
  assertEquals(fields.find(([k]) => k === "Encryption key")?.[1], "[none]");
});

Deno.test("errors and install command", () => {
  assertEquals(explainYkman("Error: No YubiKey detected!"), "No YubiKey plugged in");
  assertEquals(
    explainYkman("Error: Authentication to the YubiKey failed. Wrong password?"),
    "Wrong OATH password: check it in Settings → Extensions → YubiKey",
  );
  assertEquals(
    explainYkman("Enter the password: \nAborted!"),
    "These OATH accounts are protected by a password: set it in Settings → Extensions → YubiKey",
  );
  assertEquals(explainYkman("Error: Touch account timed out!"), "The YubiKey wasn't touched in time");
  assertEquals(explainYkman("Error: Something odd"), "Something odd");
  assertEquals(
    installCommand(osFamily("ID=arch\n")),
    "sudo pacman -S yubikey-manager pcsclite && sudo systemctl enable --now pcscd.socket",
  );
});
