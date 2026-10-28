import { assertEquals } from "@std/assert";
import {
  attachCommand,
  invalidName,
  killCommand,
  newSessionCommand,
  parseTmuxSessions,
  parseZellijSessions,
  renameCommand,
  short,
  sortSessions,
  zellijDuration,
} from "./lib.ts";
import { terminalArgs } from "./terminal.ts";

const TMUX = [
  "work|:|3|:|1|:|1761638400|:|1761645600|:|/home/me/code/api|:|",
  "notes|:|1|:|0|:|1761552000|:|1761555600|:|/home/me|:|",
  "pair|:|2|:|2|:|1761640000|:|1761649000|:|/srv|:|team",
].join("\n");

const WINDOWS = [
  "work|:|0|:|editor|:|1|:|2|:|nvim|:|/home/me/code/api",
  "work|:|1|:|server|:|0|:|1|:|node|:|/home/me/code/api",
  "work|:|2|:|zsh|:|0|:|1|:|zsh|:|/home/me",
  "notes|:|1|:|vim|:|1|:|1|:|vim|:|/home/me",
].join("\n");

Deno.test("tmux sessions and their windows", () => {
  const [work, notes, pair] = parseTmuxSessions(TMUX, WINDOWS);
  assertEquals(work.name, "work");
  assertEquals(work.windows, 3);
  assertEquals(work.attached, 1);
  assertEquals(work.created?.toISOString(), "2025-10-28T08:00:00.000Z");
  assertEquals(work.path, "/home/me/code/api");
  assertEquals(work.group, undefined);
  assertEquals(work.windowList.map((w) => [w.index, w.name, w.active, w.panes, w.command]), [
    [0, "editor", true, 2, "nvim"],
    [1, "server", false, 1, "node"],
    [2, "zsh", false, 1, "zsh"],
  ]);
  assertEquals(notes.attached, 0);
  assertEquals(pair.group, "team");
  assertEquals(pair.windowList, []);
  assertEquals(parseTmuxSessions(""), []);
});

Deno.test("zellij sessions", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const out = [
    "cool-panda [Created 2h 3m 10s ago] (current)",
    "old-one [Created 3days ago] (EXITED - attach to resurrect)",
    "fresh [Created 45s ago] ",
  ].join("\n");
  const [cool, old, fresh] = parseZellijSessions(out, now);
  assertEquals(cool.name, "cool-panda");
  assertEquals(cool.current, true);
  assertEquals(cool.created?.toISOString(), "2026-10-28T09:56:50.000Z");
  assertEquals(old.exited, true);
  assertEquals(old.created?.toISOString(), "2026-10-25T12:00:00.000Z");
  assertEquals(fresh.current, false);
  assertEquals(parseZellijSessions("No active zellij sessions found."), []);
  assertEquals(zellijDuration("1day 4h"), 100800);
});

Deno.test("commands", () => {
  const [work] = parseTmuxSessions(TMUX, WINDOWS);
  const [z, exited] = parseZellijSessions("a [Created 1s ago] \nb [Created 1s ago] (EXITED - attach to resurrect)");
  assertEquals(attachCommand(work), ["tmux", "attach-session", "-t", "=work"]);
  assertEquals(attachCommand(work, 2), ["tmux", "attach-session", "-t", "=work:2"]);
  assertEquals(attachCommand(z), ["zellij", "attach", "a"]);
  assertEquals(killCommand(work), ["tmux", "kill-session", "-t", "=work"]);
  assertEquals(killCommand(z), ["zellij", "kill-session", "a"]);
  assertEquals(killCommand(exited), ["zellij", "delete-session", "b"]);
  assertEquals(renameCommand(work, "job"), ["tmux", "rename-session", "-t", "=work", "job"]);
  assertEquals(renameCommand(z, "c"), ["zellij", "--session", "a", "action", "rename-session", "c"]);
  assertEquals(newSessionCommand("tmux", "x", true, "/srv"), ["tmux", "new-session", "-d", "-s", "x", "-c", "/srv"]);
  assertEquals(newSessionCommand("tmux", "x", false), ["tmux", "new-session", "-s", "x"]);
  assertEquals(newSessionCommand("zellij", "x", true), ["zellij", "attach", "--create-background", "x"]);
  assertEquals(terminalArgs("konsole", attachCommand(work)), ["-e", "tmux", "attach-session", "-t", "=work"]);
});

Deno.test("names", () => {
  assertEquals(invalidName("work"), undefined);
  assertEquals(invalidName(""), "Give the session a name");
  assertEquals(invalidName("a.b"), "Session names can't contain “.” or “:”");
  assertEquals(invalidName("my work"), "Session names can't contain spaces");
  assertEquals(invalidName("work", ["work"]), "A session named “work” already exists");
});

Deno.test("attached first, then by activity, exited last", () => {
  const sessions = [
    ...parseTmuxSessions(TMUX, WINDOWS),
    ...parseZellijSessions("z [Created 1s ago] (EXITED - attach to resurrect)\ny [Created 10m ago] "),
  ];
  assertEquals(sortSessions(sessions).map((s) => s.name), ["pair", "work", "y", "notes", "z"]);
  const now = new Date("2026-10-28T12:00:00Z");
  assertEquals(short(new Date("2026-10-28T09:00:00Z"), now), "3h");
  assertEquals(short(new Date("2026-10-20T12:00:00Z"), now), "8d");
});
