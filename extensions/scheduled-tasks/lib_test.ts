import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  cronCommand,
  cronLogLines,
  explainCalendar,
  explainCron,
  explainMonotonic,
  nextRun,
  parseCron,
  parseCrontab,
  parseField,
  parseShow,
  parseTimerList,
  parseUnitFiles,
  previousRun,
  relative,
  serviceOf,
  terminalScript,
  timerSchedule,
  toggleEntry,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const DEBIAN_TEMPLATE = `# Edit this file to introduce tasks to be run by cron.
#
# For example, you can run a backup of all your user accounts
# at 5 a.m every week with:
# 0 5 * * 1 tar -zcf /var/backups/home.tgz /home/
#
# m h  dom mon dow   command
`;

const USER_CRONTAB = `# My jobs
# m h  dom mon dow   command
MAILTO="me@example.com"
SHELL=/bin/bash

# Nightly backup of the photos
30 2 * * * restic backup ~/Pictures --quiet
*/15 * * * * ~/bin/check-mail.sh
# 0 9 * * 1-5 notify-send "Standup in 5 minutes"
@reboot sleep 30 && ~/bin/start-agents
0 0 1 * * echo "month" | mail -s report me%body line%second
not a cron line
`;

const SYSTEM_CRONTAB = `SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Example of job definition:
# .---------------- minute (0 - 59)
# *  *  *  *  * user-name command to be executed
17 *	* * *	root	cd / && run-parts --report /etc/cron.hourly
25 6	* * *	root	test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }
47 6	* * 7	root	test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.weekly; }
`;

Deno.test("cron fields: lists, ranges, steps and names", () => {
  const minute = { min: 0, max: 59 };
  assertEquals(parseField("*/15", minute), [0, 15, 30, 45]);
  assertEquals(parseField("1,5-7,50-59/5", minute), [1, 5, 6, 7, 50, 55]);
  assertEquals(parseField("mon-fri", { min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] }), [
    1,
    2,
    3,
    4,
    5,
  ]);
  assertThrows(() => parseField("61", minute));
  assertThrows(() => parseField("5-1", minute));
  assertEquals(parseCron("0 0 * * 7").weekdays, [0]);
  assertEquals(parseCron("@daily").fields, ["0", "0", "*", "*", "*"]);
  assert(parseCron("@reboot").reboot);
  assertThrows(() => parseCron("* * *"));
});

Deno.test("cron in words", () => {
  assertEquals(explainCron("* * * * *"), "Every minute");
  assertEquals(explainCron("*/15 * * * *"), "Every 15 minutes");
  assertEquals(explainCron("0 * * * *"), "Every hour");
  assertEquals(explainCron("17 * * * *"), "At minute 17 of every hour");
  assertEquals(explainCron("30 5 * * 1-5"), "At 05:30 on Monday to Friday");
  assertEquals(explainCron("0 9,17 * * *"), "At 09:00 and 17:00");
  assertEquals(explainCron("0 0 1 * *"), "At 00:00 on day 1 of the month");
  assertEquals(explainCron("0 0 1,15 * *"), "At 00:00 on days 1 and 15 of the month");
  assertEquals(explainCron("0 */2 * * *"), "Every 2 hours");
  assertEquals(explainCron("15 14 1 1 *"), "At 14:15 on day 1, in January");
  assertEquals(explainCron("0 12 * * sun"), "At 12:00 on Sunday");
  assertEquals(explainCron("0 3 1 * mon"), "At 03:00 on day 1 of the month or on Monday");
  assertEquals(explainCron("@weekly"), "At 00:00 on Sunday");
  assertEquals(explainCron("@reboot"), "At startup");
});

Deno.test("next and previous cron runs", () => {
  const now = new Date(2026, 9, 28, 10, 7, 30); // Wednesday 28 October 2026, 10:07:30
  assertEquals(nextRun(parseCron("*/15 * * * *"), now), new Date(2026, 9, 28, 10, 15));
  assertEquals(nextRun(parseCron("30 5 * * 1-5"), now), new Date(2026, 9, 29, 5, 30));
  assertEquals(nextRun(parseCron("0 0 1 * *"), now), new Date(2026, 10, 1, 0, 0));
  assertEquals(nextRun(parseCron("0 0 29 2 *"), now), new Date(2028, 1, 29, 0, 0));
  // Both day fields restricted: either matches (the 1st, or a Monday).
  assertEquals(nextRun(parseCron("0 3 1 * mon"), now), new Date(2026, 10, 1, 3, 0));
  assertEquals(nextRun(parseCron("@reboot"), now), undefined);
  assertEquals(previousRun(parseCron("*/15 * * * *"), now), new Date(2026, 9, 28, 10, 0));
  assertEquals(previousRun(parseCron("30 2 * * *"), now), new Date(2026, 9, 28, 2, 30));
  assertEquals(previousRun(parseCron("0 9 * * 1-5"), new Date(2026, 9, 25, 12, 0)), new Date(2026, 9, 23, 9, 0));
});

Deno.test("user crontab: jobs, commented-out jobs, notes and variables", () => {
  const { entries, env } = parseCrontab(USER_CRONTAB);
  assertEquals(env, { MAILTO: "me@example.com", SHELL: "/bin/bash" });
  assertEquals(entries.map((e) => [e.schedule, e.enabled, e.note ?? null]), [
    ["30 2 * * *", true, "Nightly backup of the photos"],
    ["*/15 * * * *", true, null],
    ["0 9 * * 1-5", false, null],
    ["@reboot", true, null],
    ["0 0 1 * *", true, null],
  ]);
  assertEquals(entries[0].command, "restic backup ~/Pictures --quiet");
  assertEquals(entries[2].command, `notify-send "Standup in 5 minutes"`);
  assertEquals(entries[3].command, "sleep 30 && ~/bin/start-agents");
  assertEquals(entries[0].line, 6);
  // The example job of Debian's template is not a disabled job.
  assertEquals(parseCrontab(DEBIAN_TEMPLATE + "0 1 * * * true\n").entries.map((e) => e.command), ["true"]);
});

Deno.test("system crontab has a user field", () => {
  const { entries, env } = parseCrontab(SYSTEM_CRONTAB, true);
  assertEquals(env.SHELL, "/bin/sh");
  assertEquals(entries.length, 3);
  assertEquals(entries[0].user, "root");
  assertEquals(entries[0].command, "cd / && run-parts --report /etc/cron.hourly");
  assertEquals(entries[2].schedule, "47 6 * * 7");
  // The ASCII art of the header is not taken for a job or a note.
  assertEquals(entries[0].note, undefined);
});

Deno.test("commenting a job out and back in", () => {
  const { entries } = parseCrontab(USER_CRONTAB);
  const off = toggleEntry(USER_CRONTAB, entries[1], false);
  assert(off.includes("\n# */15 * * * * ~/bin/check-mail.sh\n"));
  const again = parseCrontab(off).entries[1];
  assertEquals(again.enabled, false);
  assertEquals(toggleEntry(off, again, true), USER_CRONTAB);
  const on = toggleEntry(USER_CRONTAB, entries[2], true);
  assert(on.includes(`\n0 9 * * 1-5 notify-send "Standup in 5 minutes"\n`));
  // The file changed meanwhile: refuse.
  assertThrows(() => toggleEntry(USER_CRONTAB.replace("*/15", "*/20"), entries[1], false));
});

Deno.test("percent signs: stdin of the job", () => {
  assertEquals(cronCommand("date +\\%Y-\\%m-\\%d >> log"), { command: "date +%Y-%m-%d >> log" });
  assertEquals(cronCommand("mail -s hi me%line one%line two"), {
    command: "mail -s hi me",
    stdin: "line one\nline two",
  });
  const argv = terminalScript("echo hi", "root", "me");
  assertEquals(argv.slice(0, 5), ["sudo", "-u", "root", "sh", "-c"]);
  assert(argv[5].startsWith("echo hi\ncode=$?"));
  assertEquals(terminalScript("echo hi", "me", "me").slice(0, 2), ["sh", "-c"]);
  assert(terminalScript("cat%a b").at(-1)!.startsWith("printf '%s\\n' 'a b' | { cat; }"));
});

Deno.test("systemctl list-timers JSON", () => {
  const json = JSON.stringify([
    {
      next: 1761696000000000,
      left: 1761696000000000,
      last: 1761609600123456,
      passed: 1761609600123456,
      unit: "logrotate.timer",
      activates: "logrotate.service",
    },
    { next: null, left: null, last: 0, passed: null, unit: "fstrim.timer", activates: "fstrim.service" },
    { next: 0, left: 0, last: null, passed: null, unit: "backup.timer", activates: "-" },
  ]);
  assertEquals(parseTimerList(json), [
    { unit: "logrotate.timer", activates: "logrotate.service", next: 1761696000000, last: 1761609600123 },
    { unit: "fstrim.timer", activates: "fstrim.service", next: undefined, last: undefined },
    { unit: "backup.timer", activates: undefined, next: undefined, last: undefined },
  ]);
  assertEquals(
    parseUnitFiles(JSON.stringify([
      { unit_file: "fstrim.timer", state: "enabled", preset: "enabled" },
      { unit_file: "/usr/lib/systemd/system/plocate-updatedb.timer", state: "disabled", preset: "enabled" },
    ])),
    { "fstrim.timer": "enabled", "plocate-updatedb.timer": "disabled" },
  );
});

Deno.test("systemctl show blocks", () => {
  const out = `Id=logrotate.timer
Description=Daily rotation of log files
Unit=logrotate.service
UnitFileState=enabled
ActiveState=active
Persistent=yes
FragmentPath=/usr/lib/systemd/system/logrotate.timer
TimersCalendar={ OnCalendar=*-*-* 00:00:00 ; next_elapse=Thu 2026-10-29 00:00:00 CET }

Id=backup.timer
Unit=backup.service
UnitFileState=disabled
ActiveState=inactive
Persistent=no
TimersMonotonic={ OnBootUSec=15min ; next_elapse=0 }
TimersMonotonic={ OnUnitActiveUSec=1d ; next_elapse=0 }
TimersCalendar=`;
  const [a, b] = parseShow(out);
  assertEquals(a.calendar, ["*-*-* 00:00:00"]);
  assertEquals(a.persistent, true);
  assertEquals(a.description, "Daily rotation of log files");
  assertEquals(b.monotonic, [{ base: "OnBoot", value: "15min" }, { base: "OnUnitActive", value: "1d" }]);
  assertEquals(b.unitFileState, "disabled");
  assertEquals(timerSchedule(a), "Every day at 00:00");
  assertEquals(timerSchedule(b), "15 minutes after boot; 1 day after the last run started");
  assertEquals(serviceOf("backup.timer"), "backup.service");
  assertEquals(serviceOf("x.timer", "y.service"), "y.service");
});

Deno.test("OnCalendar in words", () => {
  assertEquals(explainCalendar("daily"), "Every day at midnight");
  assertEquals(explainCalendar("weekly"), "Every Monday at midnight");
  assertEquals(explainCalendar("Mon..Fri *-*-* 06:30:00"), "Monday to Friday at 06:30");
  assertEquals(explainCalendar("*-*-* 04:00:00"), "Every day at 04:00");
  assertEquals(explainCalendar("*:0/15"), "Every 15 minutes");
  assertEquals(explainCalendar("*-*-01 03:00:00"), "On the 1st of every month at 03:00");
  assertEquals(explainCalendar("Sat,Sun 10:00"), "Saturday and Sunday at 10:00");
  assertEquals(explainCalendar("*-*-* 06,18:00:00"), "Every day at 06:00 and 18:00");
  assertEquals(explainCalendar("*-*-* 02:00:00 Europe/Paris"), "Every day at 02:00 (Europe/Paris)");
  assertEquals(explainMonotonic("OnBoot", "1h 30min"), "1 hour 30 minutes after boot");
});

Deno.test("relative times and cron log lines", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(relative(now + 3 * 3_600_000, now), "in 3 h");
  assertEquals(relative(now - 5 * 60_000, now), "5 min ago");
  assertEquals(relative(now + 2 * 86_400_000, now), "in 2 d");
  const journal = `2026-10-28T02:30:01+0100 host CRON[1234]: (me) CMD (restic backup ~/Pictures --quiet)
2026-10-28T02:45:01+0100 host CRON[1240]: (me) CMD (~/bin/check-mail.sh)
2026-10-28T03:00:01+0100 host CRON[1250]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)`;
  assertEquals(cronLogLines(journal, "restic backup ~/Pictures --quiet").length, 1);
});

Deno.test("terminals match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
  };
  assertEquals(manifest.permissions.run.slice(3), TERMINALS);
});
