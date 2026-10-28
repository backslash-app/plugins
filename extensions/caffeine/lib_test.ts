import { assert, assertEquals } from "@std/assert";
import { countdown, humanize, inhibitScript, parseDuration, parseInhibitors, subtitle, systemdRunArgs } from "./lib.ts";

Deno.test("durations", () => {
  const cases: [string, number | undefined][] = [
    ["15", 900],
    ["15m", 900],
    ["15 min", 900],
    ["15mn", 900],
    ["1h", 3600],
    ["1h30", 5400],
    ["1h 30m", 5400],
    ["2 heures", 7200],
    ["1,5h", 5400],
    ["2:30", 9000],
    ["90s", 90],
    ["later", undefined],
    ["0", undefined],
    ["", undefined],
  ];
  for (const [text, seconds] of cases) assertEquals(parseDuration(text), seconds, text);
});

Deno.test("formatting", () => {
  assertEquals([humanize(900), humanize(5400), humanize(7200), humanize(45), humanize(1381)], [
    "15 min",
    "1 h 30",
    "2 h",
    "1 min",
    "24 min",
  ]);
  assertEquals([countdown(1499), countdown(3723), countdown(-1)], ["24:59", "1:02:03", "0:00"]);
  const now = 1_000_000;
  assertEquals(subtitle({ started: now, until: now + 23 * 60_000 }, now), "Awake for 23 min");
  assertEquals(subtitle({ started: now, until: now + 22.5 * 60_000 }, now), "Awake for 23 min");
  assertEquals(subtitle({ started: now, until: null }, now), "Awake until turned off");
  assertEquals(subtitle(undefined), null);
});

Deno.test("the unit holds an inhibitor for as long as sleep runs", () => {
  const args = systemdRunArgs(1800, "GNOME");
  assertEquals(args.slice(0, 6), [
    "--user",
    "--quiet",
    "--unit=backslash-caffeine",
    "--description=Backslash: Caffeine (30 min)",
    "--collect",
    "--setenv=XDG_CURRENT_DESKTOP=GNOME",
  ]);
  assertEquals(args.slice(6, 8), ["/bin/sh", "-c"]);
  const script = args[8];
  assert(script.startsWith("set -- systemd-inhibit --what=idle:sleep --who=Backslash"));
  assert(script.includes("--mode=block sleep 1800"));
  assert(script.includes("gnome-session-inhibit --inhibit idle:suspend"));
  assert(script.endsWith(`exec "$@"`));
  assert(inhibitScript(undefined).includes("sleep infinity"));
  assert(inhibitScript(60, "it's").includes(`--why='it'\\''s'`));
  assertEquals(systemdRunArgs(undefined)[3], "--description=Backslash: Caffeine");
});

Deno.test("other inhibitors", () => {
  const out = [
    "ModemManager    0  root  1043  ModemManager    sleep                   ModemManager needs to reset devices  delay",
    "Firefox         1000 ada 4242  firefox         idle                    Playing video                         block",
    "Backslash       1000 ada 5000  systemd-inhibit idle:sleep              Caffeine: keeping the computer awake  block",
    "GNOME Shell     1000 ada 2100  gnome-shell     handle-power-key        GNOME handling keypresses             block",
  ].join("\n");
  assertEquals(parseInhibitors(out), [{ who: "Firefox", what: "idle", why: "Playing video" }]);
});

Deno.test("the unit script is valid sh", async () => {
  for (const seconds of [900, undefined]) {
    const { success, stderr } = await new Deno.Command("sh", {
      args: ["-n", "-c", inhibitScript(seconds)],
      stderr: "piped",
    })
      .output();
    assert(success, new TextDecoder().decode(stderr));
  }
});
