import { assertEquals } from "@std/assert";
import { countdown, humanize, parseDuration, shellQuote, timerArgs } from "./lib.ts";

Deno.test("durations", () => {
  const cases: [string, number | undefined][] = [
    ["25", 1500],
    ["25m", 1500],
    ["25 min", 1500],
    ["1h30", 5400],
    ["1h 30m", 5400],
    ["90s", 90],
    ["2 heures", 7200],
    ["10:00", 600],
    ["1:30:00", 5400],
    ["1,5h", 5400],
    ["soon", undefined],
    ["0", undefined],
    ["", undefined],
  ];
  for (const [text, seconds] of cases) assertEquals(parseDuration(text), seconds, text);
});

Deno.test("formatting", () => {
  assertEquals([humanize(1500), humanize(5400), humanize(45), humanize(95)], [
    "25 min",
    "1 h 30",
    "45 s",
    "1 min 35 s",
  ]);
  assertEquals([countdown(1499), countdown(3723), countdown(-3)], ["24:59", "1:02:03", "0:00"]);
});

Deno.test("timer command is quoted", () => {
  assertEquals(shellQuote("it's"), `'it'\\''s'`);
  const args = timerArgs("backslash-timer-1", 300, "Tea's ready");
  assertEquals(args.slice(0, 3), ["--user", "--unit=backslash-timer-1", "--on-active=300s"]);
  assertEquals(
    args.at(-1)!.startsWith(`notify-send -a Backslash -u critical -i alarm-symbolic '⏰ Tea'\\''s ready'`),
    true,
  );
});
