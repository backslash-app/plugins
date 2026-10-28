import { assertEquals } from "@std/assert";
import { byPort, isLocal, parseSs } from "./lib.ts";

const SS = `LISTEN 0      511        127.0.0.1:3000       0.0.0.0:*    users:(("node",pid=4242,fd=20))
LISTEN 0      4096         0.0.0.0:22         0.0.0.0:*
LISTEN 0      511            [::1]:3000          [::]:*    users:(("node",pid=4242,fd=21))
LISTEN 0      128                *:8080             *:*    users:(("java",pid=7,fd=3),("java",pid=8,fd=3))
LISTEN 0      4096 [fe80::1%wlan0]:5353          [::]:*`;

Deno.test("ss output", () => {
  const l = parseSs(SS);
  assertEquals(l.map((x) => [x.port, x.address, x.pids.map((p) => p.pid)]), [
    [3000, "127.0.0.1", [4242]],
    [22, "0.0.0.0", []],
    [3000, "::1", [4242]],
    [8080, "0.0.0.0", [7, 8]],
    [5353, "fe80::1", []],
  ]);
  assertEquals([isLocal("::1"), isLocal("0.0.0.0")], [true, false]);
  assertEquals([...byPort(l).keys()], [22, 3000, 5353, 8080]);
});
