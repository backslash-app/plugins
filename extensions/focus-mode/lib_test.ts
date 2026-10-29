import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  appendLog,
  BLOCK_BEGIN,
  BLOCK_END,
  BLOCK_SCRIPT,
  blockedIn,
  blockLines,
  countdown,
  detectDnd,
  dndCommand,
  dndQuery,
  encodeParams,
  endScript,
  hostsProblem,
  humanize,
  isDomain,
  minutesOf,
  parseServerInfo,
  parseSites,
  pkexecError,
  progress,
  removeBlock,
  shellQuote,
  slackError,
  slackStatus,
  statusToRestore,
  timerArgs,
  today,
  UNBLOCK_SCRIPT,
} from "./lib.ts";

Deno.test("durations", () => {
  assertEquals(minutesOf("50"), 50);
  assertEquals(minutesOf(undefined), 25);
  assertEquals(minutesOf("soon", 30), 30);
  assertEquals(minutesOf(9999), 480);
  assertEquals(humanize(1500), "25 min");
  assertEquals(humanize(5400), "1 h 30");
  assertEquals(humanize(3600), "1 h");
  assertEquals(humanize(42), "42 s");
  assertEquals(countdown(1499.6), "25:00");
  assertEquals(countdown(3723), "1:02:03");
  assertEquals(countdown(-5), "0:00");
  assertEquals(progress({ started: 0, ends: 100 }, 25), 0.25);
  assertEquals(progress({ started: 0, ends: 100 }, 500), 1);
});

Deno.test("today's sessions", () => {
  const now = new Date(2026, 9, 29, 15, 0);
  const log = [
    { started: new Date(2026, 9, 28, 10).getTime(), seconds: 1500, completed: true },
    { started: new Date(2026, 9, 29, 9).getTime(), seconds: 1500, completed: true },
    { started: new Date(2026, 9, 29, 11).getTime(), seconds: 600, completed: false },
  ];
  assertEquals(today(log, now), { count: 2, seconds: 2100 });
  assertEquals(appendLog(Array(200).fill(log[0]), log[1]).length, 200);
});

Deno.test("sites are reduced to domains", () => {
  assertEquals(
    parseSites(
      "https://www.YouTube.com/watch?v=1, reddit.com\nx.com x.com  localhost  not_a_domain  news.ycombinator.com.",
    ),
    ["youtube.com", "reddit.com", "x.com", "news.ycombinator.com"],
  );
  assert(isDomain("a.b.co"));
  assert(!isDomain("-bad.com"));
  assert(!isDomain("com"));
  assertEquals(blockLines(["x.com"]), ["0.0.0.0 x.com", "0.0.0.0 www.x.com", ":: x.com", ":: www.x.com"]);
});

const HOSTS = "127.0.0.1 localhost\n::1 localhost\n";
const WITH_BLOCK = `${HOSTS}${BLOCK_BEGIN}\n0.0.0.0 x.com\n0.0.0.0 www.x.com\n:: x.com\n${BLOCK_END}\n`;

Deno.test("our block in /etc/hosts", () => {
  assertEquals(blockedIn(WITH_BLOCK), ["x.com"]);
  assertEquals(blockedIn(HOSTS), []);
  assertEquals(removeBlock(WITH_BLOCK), HOSTS);
  assertEquals(hostsProblem(WITH_BLOCK), undefined);
  assertStringIncludes(hostsProblem(`${HOSTS}${BLOCK_BEGIN}\n0.0.0.0 x.com\n`)!, "without its end line");
});

/** Runs a root script on a copy of a hosts file, with systemctl, systemd-run and resolvectl stubbed. */
async function runScript(script: string, hosts: string, args: string[], stdin = ""): Promise<{
  code: number;
  hosts: string;
  calls: string;
}> {
  const dir = await Deno.makeTempDir();
  try {
    const file = `${dir}/hosts`;
    await Deno.writeTextFile(file, hosts);
    for (const tool of ["systemctl", "systemd-run", "resolvectl"]) {
      await Deno.writeTextFile(`${dir}/${tool}`, `#!/bin/sh\necho "${tool} $*" >> "${dir}/calls"\n`);
      await Deno.chmod(`${dir}/${tool}`, 0o755);
    }
    const patched = script.replaceAll("/etc/hosts.backslash-focus.bak", `${dir}/bak`).replaceAll("/etc/hosts", file);
    const child = new Deno.Command("/bin/sh", {
      args: ["-c", patched, "sh", ...args],
      env: { PATH: `${dir}:/usr/bin:/bin` },
      stdin: "piped",
      stdout: "null",
      stderr: "null",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdin));
    await w.close();
    const { code } = await child.status;
    return {
      code,
      hosts: await Deno.readTextFile(file),
      calls: await Deno.readTextFile(`${dir}/calls`).catch(() => ""),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("the root block script writes only block lines and schedules the unblock", async () => {
  const input = [...blockLines(["x.com"]), "1.2.3.4 evil.example", "0.0.0.0 bad;rm"].join("\n") + "\n";
  const r = await runScript(BLOCK_SCRIPT, "127.0.0.1 localhost", ["1500"], input);
  assertEquals(r.code, 0);
  assertEquals(
    r.hosts,
    `127.0.0.1 localhost\n${BLOCK_BEGIN}\n0.0.0.0 x.com\n0.0.0.0 www.x.com\n:: x.com\n:: www.x.com\n${BLOCK_END}\n`,
  );
  assertStringIncludes(r.calls, "systemd-run --quiet --collect --unit=backslash-focus-unblock --on-active=1500s");
  // Run again: the old block is replaced, not doubled.
  const again = await runScript(BLOCK_SCRIPT, r.hosts, ["60"], blockLines(["y.org"]).join("\n"));
  assertEquals(blockedIn(again.hosts), ["y.org"]);
  assertEquals(again.hosts.split(BLOCK_BEGIN).length, 2);
});

Deno.test("the root block script refuses bad input", async () => {
  assertEquals((await runScript(BLOCK_SCRIPT, HOSTS, ["25m"], "0.0.0.0 x.com\n")).code, 2);
  const nothing = await runScript(BLOCK_SCRIPT, HOSTS, ["60"], "1.2.3.4 x.com\n");
  assertEquals(nothing.code, 3);
  assertEquals(nothing.hosts, HOSTS);
});

Deno.test("the root unblock script removes only our block", async () => {
  const r = await runScript(UNBLOCK_SCRIPT, `${WITH_BLOCK}10.0.0.2 nas\n`, []);
  assertEquals(r.code, 0);
  assertEquals(r.hosts, `${HOSTS}10.0.0.2 nas\n`);
  assertStringIncludes(r.calls, "systemctl stop backslash-focus-unblock.timer");
});

Deno.test("pkexec errors", () => {
  assertEquals(pkexecError(126, ""), "The password prompt was dismissed");
  assertEquals(
    pkexecError(127, "Error executing command as another user: Not authorized"),
    "Not authorized to change /etc/hosts",
  );
  assertEquals(pkexecError(1, "boom"), undefined);
});

Deno.test("Do Not Disturb backends", () => {
  assertEquals(parseServerInfo("('mako', 'emersion', '1.9.0', '1.2')"), "mako");
  assertEquals(detectDnd("dunst", ""), "dunst");
  assertEquals(detectDnd(undefined, "ubuntu:GNOME"), "gnome");
  assertEquals(detectDnd("Plasma", "KDE"), "kde");
  assertEquals(detectDnd(undefined, "Hyprland"), undefined);
  assertEquals(dndCommand("dunst", true), ["dunstctl", "set-paused", "true"]);
  assertEquals(dndCommand("gnome", true), [
    "gsettings",
    "set",
    "org.gnome.desktop.notifications",
    "show-banners",
    "false",
  ]);
  assertEquals(dndCommand("kde", true), undefined);
  assertEquals(dndQuery("mako")!.on("default\ndo-not-disturb\n"), true);
  assertEquals(dndQuery("gnome")!.on("true"), false);
});

Deno.test("end of session script and timer", () => {
  const s = endScript({ dnd: "mako", minutes: 25 });
  assert(s.startsWith("makoctl mode -r do-not-disturb || makoctl set-mode default; notify-send"));
  assertStringIncludes(s, "'25 min of focus. Time for a break.'");
  assert(!endScript({ minutes: 50 }).includes("makoctl"));
  const args = timerArgs("backslash-focus-1", 1500, "true", { WAYLAND_DISPLAY: "wayland-1", DISPLAY: undefined });
  assertEquals(args.slice(0, 4), ["--user", "--quiet", "--unit=backslash-focus-1", "--on-active=1500s"]);
  assert(args.includes("--setenv=WAYLAND_DISPLAY=wayland-1"));
  assertEquals(args.slice(-3), ["/bin/sh", "-c", "true"]);
  assertEquals(shellQuote("it's"), `'it'\\''s'`);
});

Deno.test("Slack", () => {
  assertEquals(slackStatus(" Deep work ", "headphones", 1_700_000_000_000), {
    text: "Deep work",
    emoji: ":headphones:",
    expiration: 1_700_000_000,
  });
  assertEquals(slackStatus("", "::zap::", 0).emoji, ":zap:");
  assertEquals(slackStatus("", "", 0), { text: "Focusing", emoji: "", expiration: 0 });
  const prev = { text: "Lunch", emoji: ":pizza:", expiration: 2_000 };
  assertEquals(statusToRestore(prev, 1_000_000), prev);
  assertEquals(statusToRestore(prev, 3_000_000), { text: "", emoji: "", expiration: 0 });
  assertEquals(statusToRestore({ text: "Away", emoji: "", expiration: 0 }, 9e12).text, "Away");
  assertEquals(statusToRestore(undefined).text, "");
  assertEquals(encodeParams({ a: 1, b: { c: "d" }, e: undefined }).toString(), "a=1&b=%7B%22c%22%3A%22d%22%7D");
  assertStringIncludes(slackError("invalid_auth"), "rejected the token");
  assertEquals(slackError("missing_scope", "dnd:write"), "The Slack token lacks the dnd:write scope");
});
