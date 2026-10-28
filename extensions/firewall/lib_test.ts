import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  describeRich,
  firewalldAddArgs,
  firewalldScript,
  installHint,
  parseUfwAdded,
  parseUfwConfig,
  parseUfwNumbered,
  parseUfwScript,
  parseUfwVerbose,
  parseZones,
  pkexecError,
  richRules,
  ruleCommand,
  ruleSentence,
  shellLine,
  sortZones,
  UFW_MARK,
  ufwAddArgs,
  ufwAddCommands,
  ufwDeleteArgs,
  validatePort,
  validateSource,
} from "./lib.ts";

const VERBOSE = `Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere                   # SSH
80,443/tcp (Nginx Full)    ALLOW IN    Anywhere
22/tcp (v6)                ALLOW IN    Anywhere (v6)              # SSH
`;

const NUMBERED = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     LIMIT IN    Anywhere                   # SSH
[ 2] 80,443/tcp (Nginx Full)    ALLOW IN    Anywhere
[ 3] 3000                       DENY IN     192.168.1.0/24             # dev server
[ 4] Anywhere                   ALLOW IN    10.8.0.0/24
[ 5] 53                         ALLOW OUT   Anywhere                   (out)
[ 6] Anywhere on wg0            ALLOW IN    Anywhere
[ 7] 22/tcp (v6)                LIMIT IN    Anywhere (v6)              # SSH
[10] 8080/tcp                   REJECT IN   Anywhere
`;

const ADDED = `Added user rules (see 'ufw status' for running firewall):
ufw limit 22/tcp comment 'SSH'
ufw allow 80,443/tcp
ufw deny from 192.168.1.0/24 to any port 3000 comment 'dev server'
ufw allow proto udp from any to any port 51820
`;

// `firewall-cmd --list-all-zones` on Fedora Workstation (trimmed to three zones).
const ZONES = `block
  target: %%REJECT%%
  icmp-block-inversion: no
  interfaces: 
  sources: 
  services: 
  ports: 
  protocols: 
  forward: yes
  masquerade: no
  forward-ports: 
  source-ports: 
  icmp-blocks: 
  rich rules: 

FedoraWorkstation (default, active)
  target: default
  icmp-block-inversion: no
  interfaces: wlp2s0
  sources: 
  services: dhcpv6-client mdns samba-client ssh
  ports: 1025-65535/udp 1025-65535/tcp
  protocols: 
  forward: yes
  masquerade: no
  forward-ports: 
  source-ports: 
  icmp-blocks: 
  rich rules: 
	rule family="ipv4" source address="192.168.1.0/24" port port="8080" protocol="tcp" accept
	rule family="ipv4" source address="10.0.0.5" drop

public
  target: default
  icmp-block-inversion: no
  interfaces: 
  sources: 192.168.50.0/24
  services: dhcpv6-client ssh
  ports: 
  protocols: 
  forward: yes
  masquerade: yes
  forward-ports: 
	port=80:proto=tcp:toport=8080:toaddr=
  source-ports: 
  icmp-blocks: echo-request
  rich rules: 
`;

Deno.test("ufw configuration files", () => {
  const conf = parseUfwConfig(
    "# /etc/ufw/ufw.conf\nENABLED=yes\nLOGLEVEL=low\n",
    'IPV6=yes\nDEFAULT_INPUT_POLICY="DROP"\nDEFAULT_OUTPUT_POLICY="ACCEPT"\nDEFAULT_FORWARD_POLICY="REJECT"\n',
  );
  assertEquals(conf, { enabled: true, logLevel: "low", incoming: "deny", outgoing: "allow", routed: "reject" });
  assertEquals(parseUfwConfig("ENABLED=no", "").enabled, false);
});

Deno.test("ufw status verbose", () => {
  assertEquals(parseUfwVerbose(VERBOSE), {
    active: true,
    logging: "on (low)",
    incoming: "deny",
    outgoing: "allow",
    routed: "disabled",
    newProfiles: "skip",
  });
  assertEquals(parseUfwVerbose("Status: inactive\n").active, false);
});

Deno.test("ufw status numbered", () => {
  const rules = parseUfwNumbered(NUMBERED);
  assertEquals(rules.length, 8);
  assertEquals(rules[0], {
    number: 1,
    to: "22/tcp",
    action: "LIMIT",
    direction: "IN",
    from: "Anywhere",
    v6: false,
    comment: "SSH",
    log: undefined,
  });
  assertEquals(rules[1].to, "80,443/tcp (Nginx Full)");
  assertEquals(rules[2].from, "192.168.1.0/24");
  assertEquals(rules[4].direction, "OUT");
  assertEquals(rules[4].from, "Anywhere");
  assertEquals(rules[5].to, "Anywhere on wg0");
  assertEquals(rules[6].v6, true);
  assertEquals(rules[6].to, "22/tcp");
  assertEquals(rules[7].number, 10);
  assertEquals(rules[7].action, "REJECT");
  // Plain `ufw status verbose` has no numbers.
  assertEquals(parseUfwNumbered(VERBOSE).map((r) => r.number), [undefined, undefined, undefined]);
});

Deno.test("ufw show added (inactive firewall)", () => {
  const rules = parseUfwAdded(ADDED);
  assertEquals(rules.map((r) => [r.action, r.to, r.from, r.comment]), [
    ["LIMIT", "22/tcp", "Anywhere", "SSH"],
    ["ALLOW", "80,443/tcp", "Anywhere", undefined],
    ["DENY", "3000", "192.168.1.0/24", "dev server"],
    ["ALLOW", "51820/udp", "Anywhere", undefined],
  ]);
  assertEquals(ufwDeleteArgs(rules[2]), [
    "--force",
    "delete",
    "deny",
    "from",
    "192.168.1.0/24",
    "to",
    "any",
    "port",
    "3000",
  ]);
  assertEquals(ruleCommand(rules[0]), "sudo ufw limit 22/tcp comment 'SSH'");
});

Deno.test("the root script's outputs", () => {
  const active = parseUfwScript([VERBOSE, NUMBERED, ADDED].join(`${UFW_MARK}\n`));
  assertEquals(active.status.active, true);
  assertEquals(active.rules.length, 8);
  const inactive = parseUfwScript(["Status: inactive\n", "Status: inactive\n", ADDED].join(`${UFW_MARK}\n`));
  assertEquals(inactive.status.active, false);
  assertEquals(inactive.rules.length, 4);
  assertEquals(inactive.rules[0].number, undefined);
});

Deno.test("ufw rules as text", () => {
  const [ssh, , dev] = parseUfwNumbered(NUMBERED);
  assertEquals(ruleSentence(ssh), "Limit in from anywhere");
  assertEquals(ruleSentence(dev), "Deny in from 192.168.1.0/24");
  assertEquals(ruleCommand(dev), "sudo ufw deny from 192.168.1.0/24 to any port 3000");
  assertEquals(ruleCommand(ssh), "sudo ufw limit 22/tcp");
  assertEquals(ufwDeleteArgs(dev), ["--force", "delete", "3"]);
});

Deno.test("new ufw rules", () => {
  assertEquals(ufwAddArgs({ action: "allow", port: "22", protocol: "tcp", from: "" }), ["allow", "22/tcp"]);
  assertEquals(ufwAddArgs({ action: "allow", port: "ssh", protocol: "any", from: "anywhere" }), ["allow", "ssh"]);
  assertEquals(
    ufwAddArgs({ action: "deny", port: "3000", protocol: "tcp", from: "192.168.1.0/24", comment: "dev" }),
    ["deny", "proto", "tcp", "from", "192.168.1.0/24", "to", "any", "port", "3000", "comment", "dev"],
  );
  assertEquals(
    ufwAddArgs({ action: "allow", port: "8000-8100", protocol: "udp", from: "" }),
    ["allow", "proto", "udp", "from", "any", "to", "any", "port", "8000:8100"],
  );
  // ufw wants a protocol for ranges: both.
  assertEquals(ufwAddCommands({ action: "allow", port: "60000:61000", protocol: "any", from: "" }).length, 2);
  assertEquals(
    shellLine([
      "ufw",
      ...ufwAddArgs({ action: "allow", port: "80", protocol: "tcp", from: "", comment: "web server" }),
    ]),
    "ufw allow 80/tcp comment 'web server'",
  );
});

Deno.test("input checks", () => {
  assertEquals(validatePort("22"), undefined);
  assertEquals(validatePort("80,443"), undefined);
  assertEquals(validatePort("8000-8100"), undefined);
  assertEquals(validatePort("ssh"), undefined);
  assert(validatePort("70000"));
  assert(validatePort("100-50"));
  assert(validatePort(""));
  assertEquals(validateSource(""), undefined);
  assertEquals(validateSource("192.168.1.0/24"), undefined);
  assertEquals(validateSource("fd00::/8"), undefined);
  assert(validateSource("300.1.1.1"));
  assert(validateSource("my laptop"));
});

Deno.test("firewalld zones", () => {
  const zones = parseZones(ZONES);
  assertEquals(zones.map((z) => z.name), ["block", "FedoraWorkstation", "public"]);
  const fw = zones[1];
  assertEquals(fw.default, true);
  assertEquals(fw.active, true);
  assertEquals(fw.interfaces, ["wlp2s0"]);
  assertEquals(fw.services, ["dhcpv6-client", "mdns", "samba-client", "ssh"]);
  assertEquals(fw.ports, ["1025-65535/udp", "1025-65535/tcp"]);
  assertEquals(fw.richRules.length, 2);
  assertEquals(zones[0].target, "%%REJECT%%");
  assertEquals(zones[2].sources, ["192.168.50.0/24"]);
  assertEquals(zones[2].masquerade, true);
  assertEquals(zones[2].icmpBlocks, ["echo-request"]);
  assertEquals(zones[2].richRules, []);
  assertEquals(sortZones(zones).map((z) => z.name), ["FedoraWorkstation", "block", "public"]);
  assertEquals(describeRich(fw.richRules[0]), {
    action: "Allow",
    port: "8080/tcp",
    service: undefined,
    from: "192.168.1.0/24",
  });
  assertEquals(describeRich(fw.richRules[1]).action, "Drop");
});

Deno.test("new firewalld rules", () => {
  assertEquals(firewalldAddArgs({ action: "allow", port: "8080", protocol: "tcp", from: "" }), ["--add-port=8080/tcp"]);
  assertEquals(firewalldAddArgs({ action: "allow", port: "https", protocol: "tcp", from: "" }), [
    "--add-service=https",
  ]);
  assertEquals(firewalldAddArgs({ action: "allow", port: "6000:6010", protocol: "any", from: "" }), [
    "--add-port=6000-6010/tcp",
    "--add-port=6000-6010/udp",
  ]);
  assertEquals(richRules({ action: "allow", port: "22", protocol: "tcp", from: "192.168.1.0/24" }), [
    'rule family="ipv4" source address="192.168.1.0/24" port port="22" protocol="tcp" accept',
  ]);
  assertEquals(richRules({ action: "deny", port: "25", protocol: "tcp", from: "" }), [
    'rule port port="25" protocol="tcp" drop',
  ]);
  assertEquals(
    firewalldScript("public", ["--add-port=8080/tcp"]),
    "firewall-cmd --zone=public --add-port=8080/tcp && firewall-cmd --permanent --zone=public --add-port=8080/tcp",
  );
  assert(
    firewalldScript("public", firewalldAddArgs({ action: "reject", port: "22", protocol: "tcp", from: "10.0.0.5" }))
      .includes(`'--add-rich-rule=rule family="ipv4" source address="10.0.0.5" port port="22" protocol="tcp" reject'`),
  );
});

Deno.test("install hints and pkexec", () => {
  assertEquals(installHint("ID=fedora").tool, "firewalld");
  assertEquals(installHint("ID=ubuntu\nID_LIKE=debian").command, "sudo apt install ufw && sudo ufw enable");
  assertEquals(installHint('ID="opensuse-tumbleweed"').tool, "firewalld");
  assertEquals(installHint("ID=arch").tool, "ufw");
  assertEquals(pkexecError(126, ""), "Authentication was cancelled");
  assertEquals(pkexecError(127, "Error executing command as another user: Not authorized"), "Not authorized");
  assertEquals(pkexecError(1, "ERROR: Could not find a profile matching 'foo'"), undefined);
  assertThrows(() => ufwDeleteArgs({ to: "x", action: "ALLOW", direction: "IN", from: "Anywhere", v6: false }));
});
