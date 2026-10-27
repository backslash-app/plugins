import { assertEquals } from "@std/assert";
import { hostPorts } from "./commands/containers.ts";

Deno.test("published ports", () => {
  assertEquals(hostPorts("0.0.0.0:8080->80/tcp, :::8080->80/tcp, 0.0.0.0:5432->5432/tcp"), [
    { host: 8080, container: "80/tcp" },
    { host: 5432, container: "5432/tcp" },
  ]);
  assertEquals(hostPorts(""), []);
});
