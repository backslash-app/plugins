import { assertEquals } from "@std/assert";
import {
  chmodSymbolic,
  commonModes,
  entries,
  httpClass,
  modeEntry,
  octal,
  parseMode,
  permissionWords,
  search,
  specialBits,
  symbolic,
} from "./lib.ts";
import { EXIT_CODES, HTTP_STATUS, KEYS, SIGNALS } from "./data.ts";

const titles = (query: string, table?: string) =>
  search(table ? entries().filter((e) => e.table === table) : entries(), query).map((e) => e.title);

Deno.test("tables are complete and ids are unique", () => {
  const all = entries();
  assertEquals(new Set(all.map((e) => e.id)).size, all.length);
  assertEquals(all.filter((e) => e.table === "ascii").length, 128);
  assertEquals(all.filter((e) => e.table === "keys").length, KEYS.length);
  assertEquals(KEYS.filter((k) => k[2].startsWith("Key")).length, 26);
  assertEquals(HTTP_STATUS.length > 55 && SIGNALS.length > 30 && EXIT_CODES.length > 25, true);
});

Deno.test("search ranks exact keys first", () => {
  assertEquals(titles("404")[0], "404 Not Found");
  assertEquals(titles("png", "mime"), ["image/png"]);
  assertEquals(titles(".webp")[0], "image/webp");
  assertEquals(titles("5432")[0], "5432 · PostgreSQL");
  assertEquals(titles("sigterm").slice(0, 2), ["15 · SIGTERM", "143 · SIGTERM"]);
  assertEquals(titles("term", "signals")[0], "15 · SIGTERM");
  assertEquals(titles("nbsp")[0], "(no-break space)  &nbsp;");
  assertEquals(titles("&eacute;")[0], "é  &eacute;");
  assertEquals(titles("keya")[0], "A");
  assertEquals(titles("KEY_ESC")[0], "Escape");
  assertEquals(titles("137", "exit"), ["137 · SIGKILL"]);
  assertEquals(titles("esc", "ascii")[0], "ESC · Escape");
  assertEquals(titles("too many")[0], "429 Too Many Requests");
  assertEquals(titles("postgres mongo"), []);
  assertEquals(titles("").length, entries().length);
});

Deno.test("entries carry the right facts", () => {
  const a = entries().find((e) => e.id === "ascii:65")!;
  assertEquals(a.facts, [
    ["Decimal", "65"],
    ["Hex", "0x41"],
    ["Octal", "0o101"],
    ["Binary", "01000001"],
    ["HTML", "&#65;"],
  ]);
  const tab = entries().find((e) => e.id === "ascii:9")!;
  assertEquals(tab.title, "HT · Horizontal tab");
  assertEquals(tab.facts.slice(-2), [["Escape", "\\t"], ["Keyboard", "Ctrl+I"]]);
  const f12 = entries().find((e) => e.id === "key:F12")!;
  assertEquals(f12.facts.slice(2), [["keyCode (legacy)", "123"], ["Linux evdev", "KEY_F12 (88)"], [
    "X11 keycode",
    "96",
  ]]);
  const kp0 = entries().find((e) => e.id === "key:Numpad0")!;
  assertEquals(kp0.facts[3], ["Linux evdev", "KEY_KP0 (82)"]);
  const kill = entries().find((e) => e.id === "signal:9")!;
  assertEquals(kill.copies[1], ["Copy kill Command", "kill -KILL <pid>"]);
  const euro = entries().find((e) => e.id === "entity:euro")!;
  assertEquals(euro.copies, [["Copy Entity", "&euro;"], ["Copy Character", "€"], ["Copy Numeric Entity", "&#8364;"]]);
  assertEquals([
    httpClass(101).name,
    httpClass(204).tint,
    httpClass(308).name,
    httpClass(429).tint,
    httpClass(503).tint,
  ], [
    "Informational",
    "green",
    "Redirection",
    "orange",
    "red",
  ]);
});

Deno.test("chmod: parsing every notation", () => {
  assertEquals(parseMode("755"), 0o755);
  assertEquals(parseMode("0644"), 0o644);
  assertEquals(parseMode("0o600"), 0o600);
  assertEquals(parseMode("4755"), 0o4755);
  assertEquals(parseMode("rwxr-x---"), 0o750);
  assertEquals(parseMode("-rw-r--r--"), 0o644);
  assertEquals(parseMode("drwxrwxrwt"), 0o1777);
  assertEquals(parseMode("rwsr-xr-x"), 0o4755);
  assertEquals(parseMode("rwSr--r--"), 0o4644);
  assertEquals(parseMode("u=rwx,g=rx,o="), 0o750);
  assertEquals(parseMode("a=r"), 0o444);
  assertEquals(parseMode("u=rw,go=r"), 0o644);
  assertEquals(parseMode("u=rwx,g=rwxs,o=rx"), 0o2775);
  assertEquals(parseMode("=rw,o-w"), 0o664);
  assertEquals([parseMode("888"), parseMode("75"), parseMode("rwx"), parseMode("hello"), parseMode("u-x")], [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

Deno.test("chmod: formatting", () => {
  assertEquals([octal(0o755), octal(0o4755), octal(0o7)], ["755", "4755", "007"]);
  assertEquals([
    symbolic(0o755),
    symbolic(0o4755),
    symbolic(0o4644),
    symbolic(0o1777),
    symbolic(0o1776),
    symbolic(0o2750),
  ], [
    "rwxr-xr-x",
    "rwsr-xr-x",
    "rwSr--r--",
    "rwxrwxrwt",
    "rwxrwxrwT",
    "rwxr-s---",
  ]);
  assertEquals([chmodSymbolic(0o750), chmodSymbolic(0o2775), chmodSymbolic(0o1777)], [
    "u=rwx,g=rx,o=",
    "u=rwx,g=rwxs,o=rx",
    "u=rwx,g=rwx,o=rwxt",
  ]);
  assertEquals([permissionWords(0o750, "u"), permissionWords(0o750, "g"), permissionWords(0o750, "o")], [
    "read, write, execute",
    "read, execute",
    "nothing",
  ]);
  assertEquals(specialBits(0o7755), ["setuid", "setgid", "sticky"]);
  const e = modeEntry(0o644);
  assertEquals([e.title, e.tint], ["644 · rw-r--r--", "green"]);
  assertEquals(e.facts.find((f) => f[0] === "umask giving it"), ["umask giving it", "133"]);
  assertEquals(modeEntry(0o777).tint, "red");
  // Every symbolic form reads back as the same mode.
  for (const m of commonModes()) {
    const mode = parseInt(m.keys[0], 8);
    assertEquals([parseMode(symbolic(mode)), parseMode(chmodSymbolic(mode))], [mode, mode], m.title);
  }
});
