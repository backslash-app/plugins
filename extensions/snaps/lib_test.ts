import { assert, assertEquals } from "@std/assert";
import {
  endpoint,
  formatBytes,
  groupSnaps,
  interfaceTitle,
  isHeld,
  isLocal,
  isSensitive,
  kindOf,
  parseConnections,
  parseInfo,
  parseList,
  parsePublisher,
  parseRefreshList,
  parseSize,
  pkexecError,
  removeOldCommands,
  revNumber,
  rootScript,
  snapError,
} from "./lib.ts";

// `snap list --all` (snapd 2.65, Ubuntu 24.04), as printed without a terminal.
const LIST = `Name                       Version                     Rev    Tracking         Publisher      Notes
bare                       1.0                         5      latest/stable    canonical**    base
core22                     20240823                    1612   latest/stable    canonical**    base,disabled
core22                     20240904                    1621   latest/stable    canonical**    base
firefox                    131.0.3-1                   5134   latest/stable/…  mozilla✓       -
firefox                    130.0.1-1                   4955   latest/stable/…  mozilla✓       disabled
firefox                    129.0.2-1                   4848   latest/stable/…  mozilla✓       disabled
gnome-42-2204              0+git.510a601-sdk0+git.f4d3dd7  176    latest/stable    canonical**    -
hello-world                6.4                         29     latest/stable    canonical✓     held
code                       e170252f                    174    latest/stable    vscode✓        classic
my-local-tool              0.1                         x1     -                -              -
snapd                      2.65.3                      21759  latest/stable    canonical**    snapd
pc-kernel                  6.8.0-45.45                 2067   24/stable        canonical**    kernel
`;

Deno.test("snap list --all", () => {
  const revs = parseList(LIST);
  assertEquals(revs.length, 12);
  assertEquals(revs[3], {
    name: "firefox",
    version: "131.0.3-1",
    rev: "5134",
    tracking: "latest/stable/…",
    publisher: "mozilla",
    verified: "verified",
    notes: [],
    disabled: false,
  });
  assertEquals(revs[1].notes, ["base", "disabled"]);
  assertEquals(revs[1].disabled, true);
  assertEquals(revs[9].tracking, "");
  assertEquals(revs[9].publisher, "");
  assertEquals(parseList("No snaps are installed yet. Try 'snap install hello-world'."), []);
});

Deno.test("publishers", () => {
  assertEquals(parsePublisher("canonical**"), ["canonical", "verified"]);
  assertEquals(parsePublisher("mozilla✓"), ["mozilla", "verified"]);
  assertEquals(parsePublisher("kde✪"), ["kde", "starred"]);
  assertEquals(parsePublisher("jdoe"), ["jdoe", undefined]);
  assertEquals(parsePublisher("-"), ["", undefined]);
});

Deno.test("grouped by snap, the active revision and older ones", () => {
  const snaps = groupSnaps(parseList(LIST));
  assertEquals(snaps.map((s) => s.name), [
    "bare",
    "code",
    "core22",
    "firefox",
    "gnome-42-2204",
    "hello-world",
    "my-local-tool",
    "pc-kernel",
    "snapd",
  ]);
  const firefox = snaps.find((s) => s.name === "firefox")!;
  assertEquals(firefox.current.rev, "5134");
  assertEquals(firefox.old.map((r) => r.rev), ["4955", "4848"]);
  assertEquals(firefox.kind, "app");
  assertEquals(snaps.find((s) => s.name === "core22")!.kind, "base");
  assertEquals(snaps.find((s) => s.name === "snapd")!.kind, "snapd");
  assertEquals(snaps.find((s) => s.name === "pc-kernel")!.kind, "kernel");
  assertEquals(kindOf({ ...firefox.current, notes: ["core"] }), "base");
  const local = snaps.find((s) => s.name === "my-local-tool")!;
  assert(isLocal(local.current));
  assert(revNumber("x2") > revNumber("99999"));
  assertEquals(
    removeOldCommands(snaps),
    [["remove", "core22", "--revision=1612"], ["remove", "firefox", "--revision=4955"], [
      "remove",
      "firefox",
      "--revision=4848",
    ]],
  );
});

// `snap info firefox hello-world` (trimmed), and a local snap.
const INFO = `name:      firefox
summary:   Mozilla Firefox web browser
publisher: Mozilla✓
store-url: https://snapcraft.io/firefox
contact:   https://support.mozilla.org/kb/
license:   unset
description: |
  Firefox is a powerful, extensible web browser with support for modern web
  application technologies.

  It is fast and private.
commands:
  - firefox
  - firefox.geckodriver
snap-id:      3wdHCAVyZEmYsCMFDE9qt92UV8rC8Wdk
tracking:     latest/stable/ubuntu-24.04
refresh-date: 3 days ago, at 10:21 CEST
channels:
  latest/stable:    131.0.3-1  2024-10-15 (5134) 286MB -
  latest/candidate: 132.0-1    2024-10-24 (5160) 287MB -
  latest/beta:      ↑
  latest/edge:      133.0a1    2024-10-30 (5170) 296MB -
  esr/stable:       128.4.0esr-1 2024-10-29 (5150) 280MB -
installed:          131.0.3-1             (5134) 286MB -
---
name:      hello-world
summary:   The 'hello-world' of snaps
publisher: Canonical**
store-url: https://snapcraft.io/hello-world
license:   MIT
description: |
  This is a simple hello world example.
commands:
  - hello-world.env
  - hello-world.evil
  - hello-world
services:
  hello-world.daemon: simple, enabled, active
tracking:     latest/stable
refresh-date: today at 09:00 CEST, held
hold:         forever
channels:
  latest/stable:    6.4 2019-04-17 (29) 20kB -
installed:          6.4            (29) 20kB -
---
name:    my-local-tool
summary: A tool built here
publisher: –
license: unset
description: |
  Mine.
installed: 0.1 (x1) 4kB -
`;

Deno.test("snap info, several snaps", () => {
  const infos = parseInfo(INFO);
  assertEquals(infos.map((i) => i.name), ["firefox", "hello-world", "my-local-tool"]);
  const [ff, hello, local] = infos;
  assertEquals(ff.summary, "Mozilla Firefox web browser");
  assertEquals(ff.publisher, "Mozilla");
  assertEquals(ff.license, undefined);
  assertEquals(
    ff.description,
    "Firefox is a powerful, extensible web browser with support for modern web\napplication technologies.\n\nIt is fast and private.",
  );
  assertEquals(ff.commands, ["firefox", "firefox.geckodriver"]);
  assertEquals(ff.tracking, "latest/stable/ubuntu-24.04");
  assertEquals(ff.refreshDate, "3 days ago, at 10:21 CEST");
  assertEquals(ff.installedSize, 286_000_000);
  assertEquals(ff.channels.map((c) => c.name), ["latest/stable", "latest/candidate", "latest/edge", "esr/stable"]);
  assertEquals(ff.channels[1], {
    name: "latest/candidate",
    version: "132.0-1",
    date: "2024-10-24",
    rev: "5160",
    size: 287_000_000,
  });
  assertEquals(hello.summary, "The 'hello-world' of snaps");
  assertEquals(hello.services, ["hello-world.daemon"]);
  assertEquals(hello.license, "MIT");
  assertEquals(hello.hold, "forever");
  const helloRev = parseList(LIST).find((r) => r.name === "hello-world")!;
  assert(isHeld(hello, helloRev));
  assert(isHeld(undefined, helloRev));
  assert(!isHeld(ff, parseList(LIST)[3]));
  assertEquals(local.installedSize, 4000);
  assertEquals(local.channels, []);
});

Deno.test("sizes", () => {
  assertEquals(parseSize("286MB"), 286_000_000);
  assertEquals(parseSize("20kB"), 20_000);
  assertEquals(parseSize("1.2GB"), 1_200_000_000);
  assertEquals(parseSize("512B"), 512);
  assertEquals(parseSize("-"), undefined);
  assertEquals(formatBytes(286_000_000), "286 MB");
  assertEquals(formatBytes(undefined), "—");
});

Deno.test("snap refresh --list", () => {
  const ups = parseRefreshList(`Name     Version   Rev   Size   Publisher   Notes
firefox  132.0-1   5160  287MB  mozilla✓    -
core22   20241001  1663  77MB   canonical** base
`);
  assertEquals(ups, [
    { name: "firefox", version: "132.0-1", rev: "5160", size: 287_000_000 },
    { name: "core22", version: "20241001", rev: "1663", size: 77_000_000 },
  ]);
  assertEquals(parseRefreshList("All snaps up to date."), []);
});

Deno.test("snap connections", () => {
  const cs = parseConnections(
    `Interface                 Plug                          Slot                            Notes
audio-playback            firefox:audio-playback        :audio-playback                 -
camera                    firefox:camera                -                               -
content[gnome-42-2204]    firefox:gnome-42-2204         gnome-42-2204:gnome-42-2204     -
home                      firefox:home                  :home                           manual
removable-media           firefox:removable-media       -                               -
dbus                      -                             firefox:dbus-daemon             -
`,
  );
  assertEquals(cs.length, 6);
  assertEquals(cs[0].connected, true);
  assertEquals(cs[1].connected, false);
  assertEquals(cs[1].slot, "");
  assertEquals(cs[3].notes, ["manual"]);
  assert(isSensitive(cs[3]));
  assert(!isSensitive(cs[0]));
  assertEquals(cs[5].plug, "");
  assertEquals(endpoint(cs[1], "firefox"), "firefox:camera");
  assertEquals(endpoint(cs[5], "firefox"), "firefox:dbus-daemon");
  assertEquals(interfaceTitle("audio-playback"), "Audio playback");
  assertEquals(interfaceTitle("content[gnome-42-2204]"), "Content: gnome-42-2204");
  assertEquals(parseConnections('error: snap "nope" not found'), []);
});

Deno.test("root scripts and errors", () => {
  const script = rootScript([["refresh", "firefox"], ["remove", "core22", "--revision=1612"]]);
  assert(script.includes("snap refresh firefox || failed=1"));
  assert(script.includes("snap remove core22 --revision=1612 || failed=1"));
  assert(script.endsWith("exit $failed"));
  assert(rootScript([["connect", "it's:odd"]]).includes(`snap connect 'it'\\''s:odd'`));
  assertEquals(pkexecError(126, ""), "Authentication was cancelled");
  assertEquals(
    snapError(`error: cannot refresh "firefox": snap "firefox" has running apps (firefox), pid 4242`),
    "Close firefox first: it is running",
  );
  assertEquals(snapError("error: cannot communicate with server: connection refused"), "snapd isn't running");
  assertEquals(snapError(`error: snap "nope" is not installed`), `Snap "nope" is not installed`);
});
