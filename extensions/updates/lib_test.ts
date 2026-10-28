import { assert, assertEquals } from "@std/assert";
import {
  parseApt,
  parseCheckupdates,
  parseDnf,
  parseDnfSecurity,
  parseFlatpak,
  parseFwupd,
  parseRpmVersions,
  parseSnap,
  parseZypper,
  plural,
  rpmName,
  shellQuote,
  TERMINAL_ARGS,
  terminalOrder,
  terminalScript,
  updateAllCommand,
  updateOneCommand,
} from "./lib.ts";

Deno.test("apt list --upgradable, security from the suite", () => {
  const updates = parseApt(`Listing...
libbrotli1/noble-updates,noble-security 1.1.0-2ubuntu0.1 amd64 [upgradable from: 1.1.0-2build2]
firefox-esr/stable-security 128.4.0esr-1~deb12u1 amd64 [upgradable from: 128.3.1esr-1~deb12u1]
code/stable 1.95.0-1730153583 amd64 [upgradable from: 1.94.2-1728494015]
`);
  assertEquals(updates.length, 3);
  assertEquals(updates[0], {
    manager: "apt",
    name: "libbrotli1",
    to: "1.1.0-2ubuntu0.1",
    arch: "amd64",
    from: "1.1.0-2build2",
    source: "noble-updates",
    security: true,
  });
  assertEquals(updates[1].security, true);
  assertEquals(updates[2].security, false);
  assertEquals(parseApt("Listing... Done\n"), []);
});

Deno.test("dnf check-update with a wrapped line and obsoletes", () => {
  const updates = parseDnf(`
Last metadata expiration check: 0:12:01 ago on Mon 28 Oct 2026 09:00:00.

firefox.x86_64                          132.0-1.fc41                 updates
kernel-core.x86_64                      6.11.5-300.fc41              updates
texlive-collection-latexrecommended.noarch
                                        11:svn65512-71.fc41          updates
Obsoleting Packages
grub2-tools-efi.x86_64                  1:2.12-10.fc41               updates
`);
  assertEquals(updates.map((u) => [u.name, u.arch, u.to]), [
    ["firefox", "x86_64", "132.0-1.fc41"],
    ["kernel-core", "x86_64", "6.11.5-300.fc41"],
    ["texlive-collection-latexrecommended", "noarch", "11:svn65512-71.fc41"],
  ]);
});

Deno.test("dnf security advisories (dnf 4 and 5) and rpm versions", () => {
  assertEquals(rpmName("openssl-libs-1:3.2.2-3.fc41.x86_64"), "openssl-libs");
  const names = parseDnfSecurity(`FEDORA-2026-1a2b3c Important/Sec. openssl-libs-1:3.2.2-3.fc41.x86_64
FEDORA-2026-4d5e6f security  Moderate firefox-132.0-1.fc41.x86_64 2026-10-27 12:00:00
`);
  assertEquals([...names], ["openssl-libs", "firefox"]);
  const versions = parseRpmVersions(`kernel-core.x86_64 6.11.3-300.fc41
kernel-core.x86_64 6.11.4-301.fc41
firefox.x86_64 131.0.3-1.fc41
package texlive is not installed
`);
  assertEquals(versions.get("kernel-core.x86_64"), "6.11.4-301.fc41");
  assertEquals(versions.get("firefox.x86_64"), "131.0.3-1.fc41");
  assertEquals(versions.size, 2);
});

Deno.test("checkupdates", () => {
  assertEquals(parseCheckupdates("linux 6.11.4.arch1-1 -> 6.11.5.arch1-1\nmesa 1:24.2.4-1 -> 1:24.2.5-1\n"), [
    { manager: "pacman", name: "linux", from: "6.11.4.arch1-1", to: "6.11.5.arch1-1", security: false },
    { manager: "pacman", name: "mesa", from: "1:24.2.4-1", to: "1:24.2.5-1", security: false },
  ]);
});

Deno.test("zypper list-updates table", () => {
  const updates = parseZypper(
    `S | Repository                | Name          | Current Version | Available Version | Arch
--+---------------------------+---------------+-----------------+-------------------+-------
v | Main Update Repository    | MozillaFirefox | 131.0-1.1      | 132.0-1.1         | x86_64
v | repo-oss                  | vim           | 9.1.0750-1.1    | 9.1.0790-1.1      | x86_64
`,
  );
  assertEquals(updates.length, 2);
  assertEquals(updates[0], {
    manager: "zypper",
    name: "MozillaFirefox",
    from: "131.0-1.1",
    to: "132.0-1.1",
    source: "Main Update Repository",
    arch: "x86_64",
    security: false,
  });
});

Deno.test("flatpak updates with installed versions", () => {
  const updates = parseFlatpak(
    "org.mozilla.firefox\tFirefox\t132.0\tstable\tflathub\norg.gnome.Platform\tGNOME Application Platform version 47\t\t47\tflathub\n",
    "org.mozilla.firefox\t131.0.3\tstable\norg.gnome.Platform\t\t47\n",
  );
  assertEquals(updates[0].label, "Firefox");
  assertEquals(updates[0].from, "131.0.3");
  assertEquals(updates[0].to, "132.0");
  assertEquals(updates[0].source, "flathub");
  assertEquals(updates[1].to, "47");
  assertEquals(updates[1].summary, "Runtime shared by Flatpak apps");
});

Deno.test("snap refresh --list", () => {
  const updates = parseSnap(
    `Name     Version   Rev   Size   Publisher     Notes
firefox  132.0-1   5187  280MB  mozilla✓      -
core22   20241001  1663  77MB   canonical✓    base
`,
    `Name     Version   Rev    Tracking         Publisher   Notes
core22   20240823  1621   latest/stable    canonical✓  base
firefox  131.0.3-1 5134   latest/stable/…  mozilla✓    -
`,
  );
  assertEquals(updates.map((u) => [u.name, u.from, u.to, u.source, u.size]), [
    ["firefox", "131.0.3-1", "132.0-1", "mozilla", 280e6],
    ["core22", "20240823", "20241001", "canonical", 77e6],
  ]);
  assertEquals(parseSnap("All snaps up to date.\n"), []);
});

Deno.test("fwupd get-updates --json", () => {
  const updates = parseFwupd(JSON.stringify({
    Devices: [{
      Name: "System Firmware",
      DeviceId: "a45df35ac0e948ee180fe216a5f703f32dda163f",
      Version: "0.1.25",
      Vendor: "LENOVO",
      Releases: [{
        Version: "0.1.27",
        Summary: "Lenovo ThinkPad X1 Carbon Gen 9 System Firmware",
        Description: "<p>Fixes:</p><ul><li>Security fix for CVE-2026-1234</li></ul>",
        Urgency: "high",
        Size: 19345678,
      }],
    }],
  }));
  assertEquals(updates[0].from, "0.1.25");
  assertEquals(updates[0].to, "0.1.27");
  assertEquals(updates[0].security, true);
  assert(updates[0].summary?.includes("- Security fix for CVE-2026-1234"));
  assertEquals(parseFwupd(""), []);
});

Deno.test("update commands", () => {
  assertEquals(updateAllCommand("apt"), "sudo apt update && sudo apt upgrade");
  assertEquals(updateAllCommand("zypper", true), "sudo zypper dist-upgrade");
  assertEquals(updateOneCommand({ manager: "pacman", name: "linux", to: "1", security: false }), undefined);
  assertEquals(
    updateOneCommand({
      manager: "flatpak",
      name: "org.mozilla.firefox",
      id: "org.mozilla.firefox",
      to: "1",
      security: false,
    }),
    "flatpak update org.mozilla.firefox",
  );
  assertEquals(shellQuote("it's"), `'it'\\''s'`);
  assertEquals(plural(1), "1 update");
  assertEquals(plural(12), "12 updates");
});

Deno.test("terminal script is valid sh and terminals are ordered by desktop", async () => {
  const script = terminalScript([
    { title: "APT", command: "sudo apt update && sudo apt upgrade" },
    { title: "Flatpak", command: "flatpak update" },
  ]);
  const check = await new Deno.Command("sh", { args: ["-n", "-c", script] }).output();
  assertEquals(check.code, 0);
  assertEquals(terminalOrder("KDE")[0], "konsole");
  assertEquals(terminalOrder("ubuntu:GNOME").slice(0, 3), ["ptyxis", "kgx", "gnome-terminal"]);
  assertEquals(terminalOrder("sway")[0], "x-terminal-emulator");
  assertEquals(new Set(terminalOrder("")).size, terminalOrder("").length);
  for (const t of terminalOrder("")) assert(TERMINAL_ARGS[t], t);
  assertEquals(TERMINAL_ARGS["gnome-terminal"](["sh", "-c", "x"]), ["--", "sh", "-c", "x"]);
});
