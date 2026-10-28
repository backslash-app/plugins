import { assertEquals } from "@std/assert";
import {
  address,
  ago,
  extraKnownHosts,
  type Host,
  matches,
  parseBlocks,
  parseKnownHosts,
  resolveHosts,
  type Resolver,
  sftpUrl,
  sortHosts,
  splitLine,
  sshCommand,
} from "./lib.ts";
import { shellLine, terminalArgs } from "./terminal.ts";

const CONFIG = `# Personal servers
Include config.d/*

Host bastion
    HostName bastion.example.com
    User admin
    IdentityFile ~/.ssh/id_ed25519

Host web-1 web-2
  HostName %h.internal.example.com
  ProxyJump bastion
  LocalForward 8080 localhost:80

Host db
  HostName=10.0.0.5
  Port 2222
  User "postgres admin"
  IdentityFile ~/.ssh/db_key
  IdentityFile ~/.ssh/fallback

Match host *.corp exec "true"
  User corp

Host *.example.com !legacy.example.com
  ForwardAgent yes

Host *
  User me
  ServerAliveInterval 30
`;

const FILES: Record<string, string> = {
  "config.d/*": "Host homelab\n  HostName 192.168.1.10\n  Port 22\n",
};
const resolver: Resolver = (pattern) =>
  FILES[pattern] ? [{ file: `/home/me/.ssh/${pattern}`, text: FILES[pattern] }] : [];

Deno.test("config lines", () => {
  assertEquals(splitLine("  HostName example.com"), ["HostName", "example.com"]);
  assertEquals(splitLine("Port=2222"), ["Port", "2222"]);
  assertEquals(splitLine('User "a b"'), ["User", "a b"]);
  assertEquals(splitLine("# comment"), undefined);
  assertEquals(splitLine(""), undefined);
});

Deno.test("patterns", () => {
  assertEquals(matches(["*.example.com", "!legacy.example.com"], "web.example.com"), true);
  assertEquals(matches(["*.example.com", "!legacy.example.com"], "legacy.example.com"), false);
  assertEquals(matches(["web-?"], "web-1"), true);
  assertEquals(matches(["*"], "anything"), true);
  assertEquals(matches(["db"], "db2"), false);
});

Deno.test("hosts of a config, with includes, wildcards skipped", () => {
  const hosts = resolveHosts(parseBlocks(CONFIG, "/home/me/.ssh/config", resolver));
  assertEquals(hosts.map((h) => h.alias), ["homelab", "bastion", "web-1", "web-2", "db"]);
  const [homelab, bastion, web1, , db] = hosts;
  assertEquals(homelab.hostName, "192.168.1.10");
  assertEquals(homelab.file, "/home/me/.ssh/config.d/*");
  assertEquals(bastion.user, "admin");
  assertEquals(bastion.identityFiles, ["~/.ssh/id_ed25519"]);
  assertEquals(bastion.line, 4);
  assertEquals(web1.hostName, "web-1.internal.example.com");
  assertEquals(web1.proxyJump, "bastion");
  // From `Host *`, as the block does not set one.
  assertEquals(web1.user, "me");
  assertEquals(web1.options, [["LocalForward", "8080 localhost:80"], ["ServerAliveInterval", "30"]]);
  assertEquals(db.port, "2222");
  assertEquals(db.user, "postgres admin");
  assertEquals(db.identityFiles, ["~/.ssh/db_key", "~/.ssh/fallback"]);
  assertEquals(db.raw[0], "Host db");
  // `Host *.example.com` applies to the bastion by its alias? No: patterns match the alias.
  assertEquals(bastion.options.some(([k]) => k === "ForwardAgent"), false);
});

Deno.test("include loops stop", () => {
  const loop: Resolver = () => [{ file: "/x", text: "Include x\nHost a\n" }];
  const hosts = resolveHosts(parseBlocks("Include x", "/c", loop));
  assertEquals(hosts.map((h) => h.alias), ["a"]);
});

const KNOWN = `github.com,140.82.121.4 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT
|1|JfKTdBh7rNbXkVAQCRp4OQoPfmI=|USECr3SWf1JUPsms5AqfD5QfxkM= ssh-rsa AAAAB3NzaC1yc2E
[git.example.org]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA
@cert-authority *.example.com ssh-rsa AAAAB3NzaC1yc2E
192.168.1.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB
*.wild.net ssh-rsa AAAA
bastion.example.com ssh-ed25519 AAAA
`;

Deno.test("known_hosts", () => {
  const known = parseKnownHosts(KNOWN);
  assertEquals(known.map((h) => [h.alias, h.port]), [
    ["github.com", undefined],
    ["git.example.org", "2222"],
    ["192.168.1.10", undefined],
    ["bastion.example.com", undefined],
  ]);
  assertEquals(known[0].keyTypes, ["ssh-ed25519", "ecdsa-sha2-nistp256"]);
  assertEquals(known[0].addresses, ["140.82.121.4"]);
  const config = resolveHosts(parseBlocks(CONFIG, "/c", resolver));
  // The homelab and the bastion are already in the config, by HostName.
  assertEquals(extraKnownHosts(config, known).map((h) => h.alias), ["github.com", "git.example.org"]);
});

Deno.test("commands and URLs", () => {
  const [, bastion, , , db] = resolveHosts(parseBlocks(CONFIG, "/c", resolver));
  const [, gitea] = parseKnownHosts(KNOWN);
  assertEquals(sshCommand(db), ["ssh", "db"]);
  assertEquals(sshCommand(gitea), ["ssh", "-p", "2222", "git.example.org"]);
  assertEquals(sftpUrl(db), "sftp://db/");
  assertEquals(sftpUrl(gitea), "sftp://git.example.org:2222/");
  assertEquals(address(db), "postgres admin@10.0.0.5:2222");
  assertEquals(address(bastion), "admin@bastion.example.com");
});

Deno.test("recent first, then the config order, then known hosts", () => {
  const h = (alias: string, source: Host["source"] = "config"): Host => ({
    alias,
    identityFiles: [],
    options: [],
    raw: [],
    source,
  });
  const sorted = sortHosts([h("b"), h("a"), h("zz", "known_hosts"), h("c"), h("aa", "known_hosts")], { c: 10, zz: 20 });
  assertEquals(sorted.map((x) => x.alias), ["zz", "c", "b", "a", "aa"]);
  const now = Date.UTC(2026, 9, 28, 12);
  assertEquals(ago(now - 3 * 3600_000, now), "3h ago");
  assertEquals(ago(now - 20_000, now), "just now");
});

Deno.test("terminal command lines", () => {
  assertEquals(terminalArgs("kitty", ["ssh", "db"]), ["ssh", "db"]);
  assertEquals(terminalArgs("gnome-terminal", ["ssh", "db"]), ["--", "ssh", "db"]);
  assertEquals(terminalArgs("wezterm", ["ssh", "db"]), ["start", "--", "ssh", "db"]);
  assertEquals(terminalArgs("alacritty", ["ssh", "db"]), ["-e", "ssh", "db"]);
  assertEquals(terminalArgs("tilix", ["ssh", "my host"]), ["-e", "ssh 'my host'"]);
  assertEquals(shellLine(["ssh", "-p", "22", "it's"]), "ssh -p 22 'it'\\''s'");
});
