import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import {
  areaCommand,
  areaTools,
  capturePackages,
  detectSession,
  fileKey,
  installCommand,
  mergeHistory,
  osFamily,
  parsePayload,
  parseWifi,
  picturesDir,
  saveName,
  scaleFor,
  scanEntry,
  scanScript,
  systemdRunArgs,
  wifiPayload,
} from "./lib.ts";

Deno.test("Wi-Fi payloads round-trip, with escaping", () => {
  const w = { ssid: 'Café; "Wi:Fi"', password: "p\\a;ss,word", security: "WPA", hidden: true };
  const text = wifiPayload(w);
  assertEquals(text, 'WIFI:T:WPA;S:Café\\; \\"Wi\\:Fi\\";P:p\\\\a\\;ss\\,word;H:true;;');
  assertEquals(parseWifi(text), w);
  assertEquals(wifiPayload({ ssid: "Open", security: "WPA" }), "WIFI:T:nopass;S:Open;;");
  assertEquals(parseWifi("WIFI:S:Home;T:WPA;P:secret;;"), { ssid: "Home", password: "secret", security: "WPA" });
  assertEquals(parseWifi("WIFI:T:WPA;;"), undefined);
});

Deno.test("what a code holds", () => {
  const wifi = parsePayload("WIFI:T:WPA;S:Home;P:hunter2;;");
  assertEquals([wifi.kind, wifi.title, wifi.secret], ["wifi", "Home", true]);
  assertEquals(wifi.fields.find((f) => f.label === "Password"), { label: "Password", value: "hunter2", secret: true });

  const otp = parsePayload("otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub");
  assertEquals([otp.kind, otp.title, otp.secret], ["otp", "GitHub:ada", true]);
  assertEquals(otp.fields.map((f) => f.label), ["Issuer", "Type", "Secret"]);

  const url = parsePayload("https://example.com/menu?table=4");
  assertEquals([url.kind, url.open, url.fields[0].value], ["url", "https://example.com/menu?table=4", "example.com"]);
  assertEquals(parsePayload("www.example.com/x").open, "https://www.example.com/x");

  const mail = parsePayload("mailto:ada@example.com?subject=Hello%20there");
  assertEquals([mail.kind, mail.fields[1].value], ["email", "Hello there"]);
  assertEquals(parsePayload("MATMSG:TO:ada@example.com;SUB:Hi;BODY:x;;").open, "mailto:ada@example.com");
  assertEquals(parsePayload("tel:+33 1 23 45 67 89").kind, "phone");
  assertEquals(parsePayload("SMSTO:+15551234:Running late").fields[1].value, "Running late");
  const geo = parsePayload("geo:48.8584,2.2945");
  assertEquals([geo.kind, geo.title], ["geo", "48.8584, 2.2945"]);
  assertMatch(geo.open!, /openstreetmap\.org\/\?mlat=48\.8584&mlon=2\.2945/);

  const card = parsePayload(
    "BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nFN:Ada Lovelace\nTEL;TYPE=cell:+44 20 1234\nEMAIL:ada@example.com\nEND:VCARD",
  );
  assertEquals(card.title, "Ada Lovelace");
  assertEquals(card.fields.map((f) => f.label), ["Name", "Phone", "Email"]);
  assertEquals(parsePayload("MECARD:N:Turing,Alan;TEL:0123;;").title, "Alan Turing");
  assertEquals(parsePayload("BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261101T090000Z\nEND:VEVENT").title, "Launch");
  const text = parsePayload("Hello\nworld");
  assertEquals([text.kind, text.title], ["text", "Hello"]);
});

Deno.test("history", () => {
  const h = mergeHistory(
    [{ kind: "generated", text: "a", at: 1 }, { kind: "scanned", text: "b", at: 2 }],
    [{ kind: "generated", text: "a", at: 5 }, { kind: "scanned", text: "a", at: 3 }],
  );
  assertEquals(h.map((e) => [e.kind, e.text, e.at]), [["generated", "a", 5], ["scanned", "a", 3], ["scanned", "b", 2]]);
  assertEquals(
    mergeHistory([], Array.from({ length: 80 }, (_, i) => ({ kind: "generated" as const, text: `${i}`, at: i })), 50)
      .length,
    50,
  );
  assertEquals(scanEntry("1730000000123456789.txt", "https://x.org\n"), {
    kind: "scanned",
    text: "https://x.org",
    at: 1730000000123,
  });
  assertEquals(scanEntry("1730000000.txt", "x")?.at, 1730000000000);
  assertEquals(scanEntry("notes.txt", "x"), undefined);
  assertEquals(scanEntry("1730000000.txt", "  \n"), undefined);
});

Deno.test("files", () => {
  assertEquals(fileKey("hello", "M"), fileKey("hello", "M"));
  assertNotEquals(fileKey("hello", "M"), fileKey("hello", "H"));
  assertMatch(fileKey("x", "L"), /^[0-9a-f]{16}$/);
  assertEquals(
    saveName("https://example.com/a?b", new Date(2026, 9, 28, 14, 5, 9)),
    "QR example com a b 2026-10-28 14.05.09.png",
  );
  assertEquals(
    saveName("WIFI:T:WPA;S:Home;;", new Date(2026, 0, 2, 3, 4, 5), "svg"),
    "QR T WPA S Home 2026-01-02 03.04.05.svg",
  );
  assertEquals(scaleFor(21), 21);
  assertEquals(scaleFor(177), 4);
  assertEquals(picturesDir('XDG_PICTURES_DIR="$HOME/Images"\n', "/home/ada"), "/home/ada/Images");
  assertEquals(picturesDir("", "/home/ada"), "/home/ada/Pictures");
});

Deno.test("capture tools and the scan script", () => {
  const sway = detectSession({ XDG_SESSION_TYPE: "wayland", SWAYSOCK: "/run/sway.sock" });
  assertEquals(areaTools(sway)[0], "grim");
  assertEquals(areaTools(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "GNOME" })), [
    "gnome-screenshot",
  ]);
  assertEquals(areaTools(detectSession({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }))[0], "maim");
  assertEquals(capturePackages(sway), ["grim", "slurp"]);
  assertEquals(areaCommand("spectacle", "/tmp/a b.png"), "spectacle -b -n -r -o '/tmp/a b.png'");

  const s = scanScript({ tool: "grim", cache: "/home/ada/.cache/backslash/qr", wayland: true, openLinks: true });
  assert(s.includes(`geometry=$(slurp -d) || exit 0; grim -g "$geometry" '/home/ada/.cache/backslash/qr/scan.png'`));
  assert(s.includes("zbarimg --raw -q '/home/ada/.cache/backslash/qr/scan.png'"));
  assert(s.includes(`printf '%s\\n' "$out" > '/home/ada/.cache/backslash/qr/scans/'"$id.txt"`));
  assert(s.includes("WIFI:*P:*|otpauth*) note="), "secrets are not copied");
  assert(s.includes("wl-copy"));
  assert(s.includes("xdg-open"));
  assert(!scanScript({ tool: "maim", cache: "/c", wayland: false }).includes("xdg-open"));

  const args = systemdRunArgs("backslash-qr-scan-1", "true", { DISPLAY: ":0", WAYLAND_DISPLAY: undefined });
  assertEquals(args.slice(0, 3), ["--user", "--quiet", "--unit=backslash-qr-scan-1"]);
  assert(args.includes("--setenv=DISPLAY=:0") && !args.some((a) => a.startsWith("--setenv=WAYLAND")));
  assertEquals(args.slice(-3), ["/bin/sh", "-c", "true"]);
});

Deno.test("install hints", () => {
  assertEquals(osFamily("ID=arch\n"), "arch");
  assertEquals(installCommand(["zbarimg"], "debian"), "sudo apt install zbar-tools");
  assertEquals(installCommand(["zbarimg", "grim", "slurp"], "fedora"), "sudo dnf install zbar grim slurp");
});
