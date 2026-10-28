import { assert, assertEquals } from "@std/assert";
import PACKAGES from "./testdata/packages.json" with { type: "json" };
import OPTIONS from "./testdata/options.json" with { type: "json" };
import { htmlToMarkdown } from "./html.ts";
import {
  declarationUrl,
  FALLBACK,
  hits,
  indexName,
  installCommands,
  mapOption,
  mapPackage,
  optionQuery,
  optionSnippet,
  optionUrl,
  packageQuery,
  packageUrl,
  parseBackend,
  pickChannel,
  platformSummary,
  scriptUrl,
  shortType,
  snippetValue,
  sourceUrl,
  total,
} from "./lib.ts";

const UNSTABLE = FALLBACK.channels[1];
const STABLE = FALLBACK.channels[0];

// Real responses of search.nixos.org (October 2026), trimmed.
const pkgs = hits(PACKAGES).map(mapPackage);
const byAttr = (a: string) => pkgs.find((p) => p.attr === a)!;
const opts = hits(OPTIONS).map(mapOption);
const byName = (n: string) => opts.find((o) => o.name === n)!;

Deno.test("backend discovery from the site's script", () => {
  assertEquals(
    scriptUrl(
      `<script defer="defer" src="/static/js/779.0ab060af.js"></script><script src="/static/js/index.b0e64e8e.js">`,
    ),
    "https://search.nixos.org/static/js/index.b0e64e8e.js",
  );
  const js =
    `c,elasticsearchMappingSchemaVersion:parseInt("53"),elasticsearchUrl:"/backend",elasticsearchUsername:"user1",elasticsearchPassword:"pw2",nixosChannels:JSON.parse('{"channels":[{"branch":"nixos-26.11","id":"26.11","jobset":"nixos/release-26.11","status":"stable"},{"branch":"nixos-unstable","id":"unstable","jobset":"nixos/unstable","status":"rolling"}],"default":"26.11"}'),theme:c`;
  const b = parseBackend(js)!;
  assertEquals(b.version, 53);
  assertEquals(b.username, "user1");
  assertEquals(b.channels.map((c) => c.id), ["26.11", "unstable"]);
  assertEquals(indexName(b, "unstable"), "latest-53-nixos-unstable");
  assertEquals(parseBackend("nothing here"), undefined);
});

Deno.test("channel preference", () => {
  const chans = FALLBACK.channels;
  assertEquals(pickChannel(chans, "unstable").id, "unstable");
  assertEquals(pickChannel(chans, "26.05").branch, "nixos-26.05");
  assertEquals(pickChannel(chans, "nixos-26.05").id, "26.05");
  assertEquals(pickChannel(chans, "stable").id, "26.05");
  assertEquals(pickChannel(chans, "24.11").id, "unstable");
  assertEquals(pickChannel(chans, undefined).id, "unstable");
});

Deno.test("queries", () => {
  const q = packageQuery("video editor", 10);
  assertEquals(q.size, 10);
  assertEquals(q.query.bool.filter, [{ term: { type: "package" } }]);
  const dis = q.query.bool.must[0].dis_max.queries;
  assertEquals(dis.length, 3);
  assertEquals(dis[1], { wildcard: { package_attr_name: { value: "*video*", case_insensitive: true } } });
  const o = optionQuery("nginx", "home-manager");
  assertEquals(o.query.bool.filter, [{ term: { type: "home-manager-option" } }]);
  const oq = o.query.bool.must[0].dis_max.queries as any[];
  assert(oq.some((x) => x.term?.option_name?.value === "services.nginx.enable"));
  const dotted = optionQuery("services.openssh", "nixos").query.bool.must[0].dis_max.queries as any[];
  assert(!dotted.some((x) => x.term?.option_name?.value?.endsWith(".enable")));
  assertEquals(total(PACKAGES), 3);
});

Deno.test("maps packages", () => {
  const rg = byAttr("ripgrep");
  assertEquals(rg.version, "15.2.0");
  assertEquals(rg.licenses.map((l) => l.spdx), ["Unlicense", "MIT"]);
  assert(rg.licenses.every((l) => l.free));
  assertEquals(rg.mainProgram, "rg");
  assertEquals(rg.homepage, "https://github.com/BurntSushi/ripgrep");
  assertEquals(rg.position, "pkgs/by-name/ri/ripgrep/package.nix:66");
  assertEquals(rg.set, undefined);
  assertEquals(rg.maintainers[0], { name: "Robin Gloster", github: "globin" });
  const code = byAttr("vscode");
  assertEquals(code.licenses, [{ name: "Unfree", free: false }]);
  assert(code.longDescription?.startsWith("Code editor developed by Microsoft."));
  assert(!code.longDescription?.includes("<p>"));
  const req = byAttr("python313Packages.requests");
  assertEquals(req.set, "python313Packages");
  assertEquals(req.outputs, ["dist", "out"]);
});

Deno.test("platforms", () => {
  assertEquals(platformSummary(["riscv64-linux", "x86_64-linux", "aarch64-darwin", "i686-linux"]), {
    main: ["x86_64-linux", "aarch64-darwin"],
    others: 2,
  });
  assertEquals(platformSummary([]), { main: [], others: 0 });
});

Deno.test("install commands", () => {
  const cmds = Object.fromEntries(installCommands(byAttr("ripgrep")));
  assertEquals(cmds["nix-shell"], "nix-shell -p ripgrep");
  assertEquals(cmds["nix run"], "nix run nixpkgs#ripgrep");
  assertEquals(cmds["NixOS configuration"], "environment.systemPackages = [ pkgs.ripgrep ];");
  assertEquals(cmds["nix-env"], "nix-env -iA nixpkgs.ripgrep");
  // A library has no program to run.
  assert(!installCommands(byAttr("python313Packages.requests")).some(([t]) => t === "nix run"));
});

Deno.test("links", () => {
  assertEquals(
    sourceUrl("pkgs/by-name/ri/ripgrep/package.nix:66", "nixos-unstable"),
    "https://github.com/NixOS/nixpkgs/blob/nixos-unstable/pkgs/by-name/ri/ripgrep/package.nix#L66",
  );
  assertEquals(sourceUrl("pkgs/top-level/all-packages.nix", "nixos-26.05").endsWith("all-packages.nix"), true);
  assertEquals(
    packageUrl("python313Packages.requests", UNSTABLE),
    "https://search.nixos.org/packages?channel=unstable&query=python313Packages.requests#show=python313Packages.requests",
  );
  const ssh = byName("services.openssh.enable");
  assertEquals(
    declarationUrl(ssh, STABLE),
    "https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/services/networking/ssh/sshd.nix",
  );
  const git = byName("programs.git.enable");
  assertEquals(
    declarationUrl(git, UNSTABLE),
    "https://github.com/nix-community/home-manager/blob/master/modules/programs/git.nix",
  );
  assertEquals(
    declarationUrl(git, STABLE),
    "https://github.com/nix-community/home-manager/blob/release-26.05/modules/programs/git.nix",
  );
  const dock = opts.find((o) => o.source === "darwin")!;
  assert(declarationUrl(dock, UNSTABLE)!.startsWith("https://github.com/nix-darwin/nix-darwin/blob/master/modules/"));
  assertEquals(
    optionUrl(git, UNSTABLE),
    "https://search.nixos.org/options?channel=unstable&source=home_manager&query=programs.git.enable",
  );
});

Deno.test("maps options", () => {
  const ssh = byName("services.openssh.enable");
  assertEquals(ssh.type, "boolean");
  assertEquals(ssh.default, "false");
  assertEquals(ssh.example, undefined);
  assertEquals(
    ssh.description,
    "Whether to enable the OpenSSH secure shell daemon, which allows secure remote logins.",
  );
  assertEquals(ssh.summary, ssh.description);
  const proxy = byName("virtualisation.libvirtd.sshProxy");
  assertEquals(
    proxy.description,
    "Whether to configure OpenSSH to use the [SSH Proxy](https://libvirt.org/ssh-proxy.html).",
  );
  assertEquals(byName("programs.git.enable").source, "home-manager");
});

Deno.test("option snippets", () => {
  assertEquals(optionSnippet(byName("services.openssh.enable")), "services.openssh.enable = true;");
  assertEquals(optionSnippet(byName("programs.ssh.package")), "programs.ssh.package = pkgs.openssh;");
  const base = { source: "nixos" as const, description: "", summary: "" };
  assertEquals(snippetValue({ ...base, name: "a", type: "list of string" }), "[ ]");
  assertEquals(snippetValue({ ...base, name: "a", type: "string", example: '"web-01"' }), '"web-01"');
  assertEquals(
    optionSnippet({ ...base, name: "x.settings", type: "attribute set", example: "{\n  a = 1;\n}" }),
    "x.settings = {\n    a = 1;\n  };",
  );
  assertEquals(
    shortType("string matching the pattern ^$|^[[:alnum:]]([[:alnum:]_-]{0,61}[[:alnum:]])?$", 30).length,
    30,
  );
});

Deno.test("option html descriptions", () => {
  const md = htmlToMarkdown(
    `<rendered-html><p>Whether to enable <code class="literal">sshd</code>.</p>\n<div class="note"><h3 class="title">Note</h3><p>See <a href="https://man.openbsd.org/sshd_config">sshd_config(5)</a>.</p></div><ul class="itemizedlist"><li class="listitem"><p><code class="literal">yes</code></p></li></ul></rendered-html>`,
  );
  assertEquals(
    md,
    "Whether to enable `sshd`.\n\n### Note\n\nSee [sshd_config(5)](https://man.openbsd.org/sshd_config).\n\n- `yes`",
  );
});
