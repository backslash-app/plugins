import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { evaluate, format } from "./lib.ts";

const calc = (s: string) => {
  const v = evaluate(s);
  return v === undefined ? undefined : format(v);
};

Deno.test("arithmetic", () => {
  assertEquals(calc("1 + 2 * 3"), "7");
  assertEquals(calc("(1 + 2) * 3"), "9");
  assertEquals(calc("2 ^ 3 ^ 2"), "512");
  assertEquals(calc("-2^2"), "-4");
  assertEquals(calc("10 % 4"), "2");
  assertEquals(calc("0.1 + 0.2"), "0.3");
  assertEquals(calc("3,5 * 2"), "7");
  assertEquals(calc("7 ÷ 2"), "3.5");
  assertEquals(calc("6 × 7"), "42");
  assertEquals(calc("-0 * 1"), "0");
});

Deno.test("functions, constants and implicit multiplication", () => {
  assertEquals(calc("sqrt(16) + 1"), "5");
  assertEquals(calc("2pi + 0"), "6.2831853072");
  assertEquals(calc("3(4+1)"), "15");
  assertEquals(calc("(2+3"), "5");
  assertEquals(calc("round(-2.5) + 0"), "-3");
  assertEquals(calc("log(1000) * 1"), "3");
  assertEquals(calc("SQRT(9)"), "3");
});

Deno.test("ignores what is not math", () => {
  for (const s of ["firefox", "42", "", "1 / 0", "foo(2)", "2 +", "rm -rf", "v1.2-beta", "1.2.3 + 1", "sqrt 4 + 1"]) {
    assertEquals(calc(s), undefined, s);
  }
});

Deno.test("manifest: an answer command", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    commands: { mode: string }[];
    permissions?: unknown;
  };
  assertEquals(m.commands.map((c) => c.mode), ["answer"]);
  assertEquals(m.permissions, undefined);
});
