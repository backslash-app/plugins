import { assertEquals } from "@std/assert";
import {
  asdfIsGo,
  asdfRuntimes,
  channel,
  command,
  compareVersions,
  isNewer,
  latestOf,
  nvmRuntimes,
  parseAsdfCurrent,
  parseAsdfLatestAll,
  parseFnmList,
  parseMiseLs,
  parseMiseOutdated,
  parseRustupCheck,
  parseRustupList,
  pyenvRuntimes,
  resolveNvmAlias,
  rustcVersion,
  sdkmanRuntimes,
  sortRuntimes,
  stableVersions,
  terminalScript,
  toolInfo,
} from "./lib.ts";

const HOME = "/home/ada";

Deno.test("versions", () => {
  assertEquals(compareVersions("3.10.1", "3.9.12") > 0, true);
  assertEquals(compareVersions("v22.11.0", "22.2.0") > 0, true);
  assertEquals(compareVersions("1.0.0", "1.0.0-rc.1") > 0, true);
  assertEquals(compareVersions("21.0.5-tem", "17.0.13-tem") > 0, true);
  assertEquals(
    stableVersions(["22.10.0", "22.12.0", "23.0.0-rc.1", "  3.13.0", "miniconda3-latest", "v20.18.0 (Iron)"]),
    [
      "22.12.0",
      "22.10.0",
      "v20.18.0",
      "3.13.0",
    ],
  );
  assertEquals([isNewer("22.12.0", "22.11.0"), isNewer("22.11.0", "22.11.0"), isNewer("1.2", "system")], [
    true,
    false,
    false,
  ]);
  assertEquals(latestOf("v20.18.0 (Iron)\nv22.11.0 (Jod)\n"), "v22.11.0");
});

Deno.test("mise", () => {
  // mise ls --json
  const json = JSON.stringify({
    node: [
      {
        version: "22.11.0",
        requested_version: "22",
        install_path: `${HOME}/.local/share/mise/installs/node/22.11.0`,
        source: { type: "mise.toml", path: `${HOME}/.config/mise/config.toml` },
        installed: true,
        active: true,
      },
      { version: "20.18.0", install_path: `${HOME}/.local/share/mise/installs/node/20.18.0`, installed: true },
    ],
    "aqua:astral-sh/uv": [{ version: "0.5.1", installed: false, active: true, requested_version: "latest" }],
  });
  const list = parseMiseLs(json, HOME);
  assertEquals(list.map((r) => [r.tool, r.version, r.current, r.installed, r.source ?? null]), [
    ["node", "22.11.0", true, true, "~/.config/mise/config.toml"],
    ["node", "20.18.0", false, true, null],
    ["aqua:astral-sh/uv", "0.5.1", true, false, null],
  ]);
  assertEquals(list[0].path, "~/.local/share/mise/installs/node/22.11.0");
  assertEquals(toolInfo(list[2]).name, "uv");
  assertEquals(
    parseMiseOutdated('{"node":{"name":"node","requested":"22","current":"22.11.0","latest":"22.12.0"}}'),
    { node: "22.12.0" },
  );
  assertEquals(parseMiseLs("", HOME), []);
});

Deno.test("asdf, old and new", () => {
  const list = "golang\n  1.22.0\n *1.23.2\nnodejs\n  22.11.0\nruby\n  No versions installed\n";
  const go = "Name            Version         Source                         Installed\n" +
    `golang          1.23.2          ${HOME}/.tool-versions          true\n` +
    'nodejs          ______          No version is set. Run "asdf <global|shell|local> nodejs <version>"\n';
  const old =
    `golang          1.23.2          ${HOME}/.tool-versions\nnodejs          22.11.0         ${HOME}/code/app/.tool-versions\n`;
  assertEquals(parseAsdfCurrent(go), { golang: { version: "1.23.2", source: `${HOME}/.tool-versions` } });
  assertEquals(parseAsdfCurrent(old).nodejs, { version: "22.11.0", source: `${HOME}/code/app/.tool-versions` });
  const runtimes = asdfRuntimes(list, go, HOME);
  assertEquals(runtimes.map((r) => [r.tool, r.version, r.current, r.source ?? null]), [
    ["golang", "1.22.0", false, null],
    ["golang", "1.23.2", true, "~/.tool-versions"],
    ["nodejs", "22.11.0", false, null],
  ]);
  assertEquals(parseAsdfLatestAll("golang  1.23.4  installed\nnodejs  23.3.0  missing\nbroken\n"), {
    golang: "1.23.4",
    nodejs: "23.3.0",
  });
  assertEquals([asdfIsGo("asdf version 0.18.0"), asdfIsGo("v0.14.1-f00f759"), asdfIsGo("asdf version v0.16.7")], [
    true,
    false,
    true,
  ]);
  assertEquals(command("asdf", "use", "golang", "1.23.4", { asdfGo: true }), "asdf set -u golang 1.23.4");
  assertEquals(command("asdf", "use", "golang", "1.23.4", { asdfGo: false }), "asdf global golang 1.23.4");
});

Deno.test("rustup", () => {
  const text =
    "stable-x86_64-unknown-linux-gnu (active, default)\nnightly-x86_64-unknown-linux-gnu\n1.75-x86_64-unknown-linux-gnu\n";
  assertEquals(parseRustupList(text), [
    { name: "stable-x86_64-unknown-linux-gnu", isDefault: true, active: true },
    { name: "nightly-x86_64-unknown-linux-gnu", isDefault: false, active: false },
    { name: "1.75-x86_64-unknown-linux-gnu", isDefault: false, active: false },
  ]);
  assertEquals(parseRustupList("stable-x86_64-unknown-linux-gnu (default)")[0].isDefault, true);
  assertEquals(rustcVersion("rustc 1.82.0 (f6e511eec 2024-10-15)"), "1.82.0");
  assertEquals(channel("nightly-aarch64-unknown-linux-gnu"), "nightly");
  assertEquals(
    parseRustupCheck(
      "stable-x86_64-unknown-linux-gnu - Update available : 1.81.0 (eeb90cda1 2024-09-04) -> 1.82.0 (f6e511eec 2024-10-15)\n" +
        "nightly-x86_64-unknown-linux-gnu - Up to date : 1.84.0-nightly (2024-11-01)\nrustup - Up to date : 1.27.1",
    ),
    { "stable-x86_64-unknown-linux-gnu": "1.82.0" },
  );
  assertEquals(
    command("rustup", "update", "stable-x86_64-unknown-linux-gnu", "stable-x86_64-unknown-linux-gnu"),
    [
      "rustup update stable-x86_64-unknown-linux-gnu",
    ][0],
  );
  assertEquals(toolInfo({ manager: "rustup", tool: "beta-x86_64-unknown-linux-gnu" }).name, "Rust beta");
});

Deno.test("Node: fnm and nvm", () => {
  const fnm = parseFnmList("* v18.20.4\n* v22.11.0 default, lts-latest\n* system\n");
  assertEquals(fnm.map((r) => [r.version, r.current, r.source ?? null]), [
    ["v18.20.4", false, null],
    ["v22.11.0", true, "default, lts-latest"],
  ]);
  const installed = ["v18.20.4", "v20.18.0", "v22.11.0", "v23.1.0"];
  assertEquals(
    ["22", "lts/*", "node", "v20.18.0", "19", ""].map((a) => resolveNvmAlias(a, installed)),
    ["v22.11.0", "v22.11.0", "v23.1.0", "v20.18.0", undefined, undefined],
  );
  const nvm = nvmRuntimes(installed, "lts/*\n");
  assertEquals(nvm.filter((r) => r.current).map((r) => [r.version, r.source]), [["v22.11.0", "default → lts/*"]]);
  assertEquals(
    command("nvm", "use", "node", "v20.18.0"),
    '. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm alias default v20.18.0',
  );
});

Deno.test("pyenv and SDKMAN!", () => {
  const py = pyenvRuntimes("3.11.9\n3.12.7\n", "3.12.7\n3.11.9\n");
  assertEquals(py.map((r) => r.current), [true, true]);
  assertEquals(command("pyenv", "uninstall", "python", "3.11.9"), "pyenv uninstall -f 3.11.9");
  assertEquals(command("pyenv", "update", "python", "3.11.9"), undefined);
  const sdk = sdkmanRuntimes({ java: { versions: ["17.0.13-tem", "21.0.5-tem"], current: "21.0.5-tem" } });
  assertEquals(sdk.map((r) => [r.version, r.current]), [["21.0.5-tem", true], ["17.0.13-tem", false]]);
  assertEquals(
    command("sdkman", "install", "java", "21.0.5-tem"),
    '. "${SDKMAN_DIR:-$HOME/.sdkman}/bin/sdkman-init.sh" && sdk install java 21.0.5-tem',
  );
});

Deno.test("commands and display", () => {
  assertEquals(
    ["install", "use", "uninstall", "update"].map((op) => command("mise", op as "install", "node", "22.12.0")),
    ["mise install node@22.12.0", "mise use --global node@22.12.0", "mise uninstall node@22.12.0", "mise upgrade node"],
  );
  assertEquals(command("mise", "install", "aqua:astral-sh/uv", "0.5.1"), "mise install aqua:astral-sh/uv@0.5.1");
  const script = terminalScript("Install Node.js 22.12.0", "mise install node@22.12.0").split("\n");
  assertEquals(script[2], "mise install node@22.12.0");
  assertEquals(script.at(-1), "printf 'Press Enter to close…'; read -r _");
  assertEquals(toolInfo({ manager: "mise", tool: "nodejs" }), { name: "Node.js", color: "green" });
  assertEquals(toolInfo({ manager: "asdf", tool: "terraform-ls" }).color, "gray");
  const sorted = sortRuntimes([
    ...pyenvRuntimes("3.11.9\n3.12.7\n3.13.0\n", "3.12.7"),
  ]);
  assertEquals(sorted.map((r) => r.version), ["3.12.7", "3.13.0", "3.11.9"]);
});
