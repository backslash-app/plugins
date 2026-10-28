import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  addEntry,
  addressKind,
  BACKUP_PATH,
  blockNames,
  checkBeforeWrite,
  editEntry,
  entries,
  type Entry,
  entryProblem,
  findHost,
  formatEntry,
  HOSTS_PATH,
  isBlock,
  isHostname,
  isIPv4,
  isIPv6,
  isProtected,
  parseHosts,
  parseLine,
  pkexecError,
  removeLine,
  RESTORE_SCRIPT,
  serialize,
  setEnabled,
  splitHostnames,
  WRITE_SCRIPT,
} from "./lib.ts";

const FIXTURES = ["debian", "fedora", "crlf", "custom"];
const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));
const byHost = (text: string, host: string) => {
  const file = parseHosts(text);
  const found = entries(file).find((x) => x.entry.hosts.includes(host));
  assert(found, `no entry for ${host}`);
  return { file, ...found };
};

Deno.test("every fixture reads back byte for byte", async () => {
  for (const name of FIXTURES) {
    const text = await fixture(name);
    assertEquals(serialize(parseHosts(text)), text, name);
  }
  for (const text of ["", "\n", "\n\n", "127.0.0.1 localhost", "  # x  \r\n\t\n", "a\r\nb\nc\r\n"]) {
    assertEquals(serialize(parseHosts(text)), text, JSON.stringify(text));
  }
});

Deno.test("each change touches one line, the rest stays byte for byte", async () => {
  for (const name of FIXTURES) {
    const text = await fixture(name);
    const file = parseHosts(text);
    for (const x of entries(file)) {
      const toggled = serialize(setEnabled(file, x.index, x.entry.raw, !x.entry.enabled));
      const before = text.split("\n");
      const after = toggled.split("\n");
      assertEquals(after.length, before.length, name);
      assertEquals(after.filter((l, i) => l !== before[i]).length, 1, `${name}: ${x.entry.raw}`);
      // And back again gives the original line when it was enabled.
      const back = parseHosts(toggled);
      const again = serialize(setEnabled(back, x.index, back.lines[x.index].raw, x.entry.enabled));
      if (x.entry.enabled) assertEquals(again, text, `${name}: ${x.entry.raw}`);
      const removed = serialize(removeLine(file, x.index, x.entry.raw)).split("\n");
      assertEquals(removed, before.filter((_, i) => i !== x.index));
    }
  }
});

Deno.test("Debian's default file", async () => {
  const file = parseHosts(await fixture("debian"));
  const list = entries(file);
  assertEquals(list.map((x) => x.entry.ip), [
    "127.0.0.1",
    "127.0.1.1",
    "::1",
    "fe00::0",
    "ff00::0",
    "ff02::1",
    "ff02::2",
  ]);
  assert(list.every((x) => x.entry.enabled));
  assertEquals(list[2].entry.hosts, ["ip6-localhost", "ip6-loopback"]);
  assertEquals(list[2].section, "The following lines are desirable for IPv6 capable hosts");
  assert(list.every((x) => isProtected(x.entry)));
  assertEquals(file.lines[3].kind, "comment");
  assertEquals(file.eol, "\n");
});

Deno.test("Fedora's commented examples are disabled entries", async () => {
  const list = entries(parseHosts(await fixture("fedora")));
  assertEquals(list.map((x) => [x.entry.ip, x.entry.enabled]), [
    ["127.0.0.1", true],
    ["::1", true],
    ["192.168.1.10", false],
    ["192.168.1.13", false],
  ]);
  assertEquals(list[2].entry.hosts, ["foo.example.org", "foo"]);
  assertEquals(list[2].section, "See hosts(5) for proper format and other examples:");
  // Prose isn't mistaken for an entry.
  assertEquals(parseLine("# For historical reasons, localhost precedes localhost.localdomain:").kind, "comment");
  assertEquals(parseLine("# 192.168.1.1 is my router, see below!").kind, "comment");
});

Deno.test("CRLF, tabs, indentation and inline comments", async () => {
  const text = await fixture("crlf");
  const file = parseHosts(text);
  assertEquals(file.eol, "\r\n");
  const list = entries(file);
  const nas = list.find((x) => x.entry.hosts[0] === "nas")!;
  assertEquals(nas.entry.hosts, ["nas", "nas.lan"]);
  assertEquals(nas.entry.comment, "Synology");
  assertEquals(nas.section, "--- Home lab ---");
  const printer = list.find((x) => x.entry.hosts[0] === "printer.lan")!;
  assertEquals(printer.entry.ip, "192.168.1.20");
  const pi = list.find((x) => x.entry.hosts[0] === "pi.lan")!;
  assertEquals(pi.entry.enabled, false);
  const jenkins = list.find((x) => x.entry.hosts[0] === "jenkins.corp.example.com")!;
  assertEquals([jenkins.entry.enabled, jenkins.entry.comment, jenkins.section], [false, "retired", "old"]);
  // Enabling "#192.168.1.30 pi.lan" removes only the "#".
  const on = setEnabled(file, pi.index, pi.entry.raw, true);
  assertEquals(on.lines[pi.index].raw, "192.168.1.30 pi.lan\r");
  // Disabling keeps the indentation behind "# ".
  const off = setEnabled(file, printer.index, printer.entry.raw, false);
  assertEquals(off.lines[printer.index].raw, "#   192.168.1.20    printer.lan\r");
  // A new line takes the file's CRLF.
  const added = serialize(addEntry(file, "192.168.1.40", ["tv.lan"]));
  assertEquals(added, `${text}192.168.1.40\ttv.lan\r\n`);
});

Deno.test("odd lines are kept and reported", async () => {
  const text = await fixture("custom");
  const file = parseHosts(text);
  const invalid = file.lines.filter((l) => l.kind === "invalid");
  assertEquals(invalid.map((l) => l.raw), ["not-an-ip something", "192.168.1.1"]);
  assertEquals(invalid.map((l) => l.kind === "invalid" && l.reason), [
    "“not-an-ip” is not an IP address",
    "An address without a host name",
  ]);
  const blocks = entries(file).filter((x) => isBlock(x.entry));
  assertEquals(blocks.map((x) => x.entry.hosts[0]), [
    "ads.example.com",
    "tracker.example.net",
    "blocked6.example.com",
    "last.example.org",
  ]);
  assertEquals(blocks[0].section, "Ad servers");
  // No newline at the end: the last line gets one before the new entry.
  const added = serialize(addEntry(file, "0.0.0.0", ["new.example.com"]));
  assertEquals(added, `${text}\n0.0.0.0\tnew.example.com\n`);
  assertEquals(serialize(parseHosts(added)), added);
});

Deno.test("adding to an empty or missing file", () => {
  assertEquals(serialize(addEntry(parseHosts(""), "127.0.0.1", ["localhost"])), "127.0.0.1\tlocalhost\n");
  assertEquals(serialize(addEntry(parseHosts("\n"), "::1", ["a.test"], "note")), "\n::1\ta.test\t# note\n");
});

Deno.test("editing an entry", async () => {
  const { file, index, entry } = byHost(await fixture("crlf"), "nas");
  const edited = editEntry(file, index, entry.raw, "192.168.1.11", ["nas", "nas.home"], "Synology DS920+");
  assertEquals(edited.lines[index].raw, "192.168.1.11\tnas nas.home\t# Synology DS920+\r");
  const jenkins = byHost(await fixture("crlf"), "jenkins.corp.example.com");
  const disabled = editEntry(jenkins.file, jenkins.index, jenkins.entry.raw, "10.0.0.7", ["ci.corp.example.com"]);
  assertEquals((disabled.lines[jenkins.index] as Entry).enabled, false);
  assertEquals(disabled.lines[jenkins.index].raw, "# 10.0.0.7\tci.corp.example.com\r");
  assertThrows(() => editEntry(file, index, entry.raw, "300.1.1.1", ["nas"]), Error, "not an IP address");
  // The line moved or changed since the list was shown.
  assertThrows(() => editEntry(file, index, "192.168.1.10 nas", "192.168.1.11", ["nas"]), Error, "changed");
  assertThrows(() => setEnabled(file, 0, file.lines[1].raw, false), Error, "changed");
});

Deno.test("addresses and names", () => {
  assert(isIPv4("192.168.1.10"));
  assert(!isIPv4("192.168.1.256"));
  assert(!isIPv4("01.2.3.4"));
  assert(!isIPv4("1.2.3"));
  for (
    const ip of [
      "::1",
      "::",
      "fe80::1%eth0",
      "2001:db8::8a2e:370:7334",
      "ff02::2",
      "::ffff:192.0.2.1",
      "1:2:3:4:5:6:7:8",
    ]
  ) {
    assert(isIPv6(ip), ip);
  }
  for (const ip of ["1:2:3:4:5:6:7:8:9", "2001::db8::1", "gggg::1", "12345::1", "localhost"]) assert(!isIPv6(ip), ip);
  assert(isHostname("nas.lan"));
  assert(isHostname("_dmarc.example.com"));
  assert(isHostname("example.com."));
  assert(!isHostname("-bad.example"));
  assert(!isHostname("a..b"));
  assert(!isHostname("1.2.3.4"));
  assert(!isHostname("x".repeat(64) + ".com"));
  assertEquals(splitHostnames(" https://www.Example.com/path?q=1, nas.lan  nas.lan\tpi "), [
    "www.example.com",
    "nas.lan",
    "pi",
  ]);
  assertEquals(entryProblem("10.0.0.1", []), "Give at least one host name");
  assertEquals(entryProblem("10.0.0.1", ["ok.lan", "bad host"]), "“bad host” is not a valid host name");
  assertEquals(entryProblem("10.0.0.1", ["ok.lan"]), undefined);
  assertEquals(addressKind("0.0.0.0"), "Blocked");
  assertEquals(addressKind("127.0.1.1"), "Loopback");
  assertEquals(addressKind("172.20.0.3"), "Local network");
  assertEquals(addressKind("100.101.102.103"), "Local network");
  assertEquals(addressKind("fd12::3"), "IPv6 local");
  assertEquals(addressKind("93.184.216.34"), "Internet");
  assertEquals(formatEntry("1.2.3.4", ["a", "b"], "  c "), "1.2.3.4\ta b\t# c");
});

Deno.test("blocking names and finding hosts", async () => {
  assertEquals(blockNames("https://ads.example.com/x", true), ["ads.example.com", "www.ads.example.com"]);
  assertEquals(blockNames("www.example.com", true), ["www.example.com"]);
  assertEquals(blockNames("example.com", false), ["example.com"]);
  assertEquals(blockNames("  ", true), []);
  const file = parseHosts(await fixture("custom"));
  assertEquals(findHost(file, "ADS.example.com").map((x) => x.entry.ip), ["0.0.0.0"]);
  assertEquals(findHost(parseHosts(await fixture("fedora")), "foo"), []); // disabled
});

Deno.test("checks before writing", async () => {
  const debian = await fixture("debian");
  assertEquals(checkBeforeWrite(debian, debian + "1.2.3.4 a.test\n"), undefined);
  const file = parseHosts(debian);
  const local = entries(file)[0];
  const noLocalhost = serialize(setEnabled(file, local.index, local.entry.raw, false));
  assertEquals(checkBeforeWrite(debian, noLocalhost), "The change would remove localhost from the hosts file");
  assertEquals(checkBeforeWrite(debian, ""), "The change would remove localhost from the hosts file");
  assertEquals(checkBeforeWrite("# x\n", ""), "The change would empty the hosts file");
  assertEquals(checkBeforeWrite("", "a\0b"), "The new hosts file contains a NUL character");
  // Protected entries: localhost, the machine's name, IPv6 names.
  assert(isProtected(parseLine("127.0.1.1 ada-laptop") as Entry));
  assert(!isProtected(parseLine("192.168.1.10 nas") as Entry));
});

Deno.test("what runs as root", () => {
  assertEquals(WRITE_SCRIPT, `cp -p ${HOSTS_PATH} ${BACKUP_PATH} && tee ${HOSTS_PATH} > /dev/null`);
  assert(RESTORE_SCRIPT.includes(`tee ${HOSTS_PATH} < ${BACKUP_PATH}`));
  assertEquals(pkexecError(126, ""), "Authentication was cancelled");
  assertEquals(
    pkexecError(127, "Error executing command as another user: Not authorized"),
    "Not authorized to change the hosts file",
  );
  assertEquals(pkexecError(0, ""), undefined);
});

Deno.test("writing through a real file, as the extension does", async () => {
  // The same steps as system.ts, on a copy: parse, change, check, write with tee from stdin, read back.
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/hosts`;
    const before = await fixture("crlf");
    await Deno.writeTextFile(path, before);
    const { file, index, entry } = byHost(await Deno.readTextFile(path), "printer.lan");
    const after = serialize(setEnabled(file, index, entry.raw, false));
    assertEquals(checkBeforeWrite(before, after), undefined);
    const child = new Deno.Command("/bin/sh", {
      args: ["-c", `cp -p ${path} ${path}.bak && tee ${path} > /dev/null`],
      stdin: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(after));
    await w.close();
    assertEquals((await child.status).code, 0);
    assertEquals(await Deno.readTextFile(path), after);
    assertEquals(await Deno.readTextFile(`${path}.bak`), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the manifest allows what the code reads and runs", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { read: string[]; run: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.read.sort(), [BACKUP_PATH, HOSTS_PATH].sort());
  assertEquals(manifest.permissions.run, ["pkexec"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
