import { assert, assertEquals } from "@std/assert";
import {
  ago,
  bytes,
  deviceIcon,
  exitNodeArgs,
  exitNodeInUse,
  expandPaths,
  explainError,
  installCommand,
  osFamily,
  parsePing,
  parseStatus,
  sshArgv,
  statusLine,
  subtitle,
  taildropArgs,
  until,
} from "./lib.ts";
import { shellLine, terminalArgs } from "./terminal.ts";

const NOW = new Date("2026-10-28T13:00:00Z");

// `tailscale status --json` (1.76) on a small personal tailnet.
const STATUS = JSON.stringify({
  "Version": "1.76.6-t1a2b3c4d-gabcdef",
  "TUN": true,
  "BackendState": "Running",
  "HaveNodeKey": true,
  "AuthURL": "",
  "TailscaleIPs": [
    "100.101.12.7",
    "fd7a:115c:a1e0::4d01:c07",
  ],
  "Self": {
    "ID": "nSelf123CNTRL",
    "PublicKey": "nodekey:aaa",
    "HostName": "steven-laptop",
    "DNSName": "laptop.tail4c2a1.ts.net.",
    "OS": "linux",
    "UserID": 9001,
    "TailscaleIPs": [
      "100.101.12.7",
      "fd7a:115c:a1e0::4d01:c07",
    ],
    "Relay": "par",
    "RxBytes": 0,
    "TxBytes": 0,
    "Created": "2025-02-01T10:00:00Z",
    "LastSeen": "0001-01-01T00:00:00Z",
    "Online": true,
    "ExitNode": false,
    "ExitNodeOption": false,
    "Active": false,
    "KeyExpiry": "2027-03-20T10:00:00Z",
  },
  "Health": [],
  "MagicDNSSuffix": "tail4c2a1.ts.net",
  "CurrentTailnet": {
    "Name": "steven@example.com",
    "MagicDNSSuffix": "tail4c2a1.ts.net",
    "MagicDNSEnabled": true,
  },
  "Peer": {
    "nodekey:bbb": {
      "ID": "nNas456CNTRL",
      "PublicKey": "nodekey:bbb",
      "HostName": "nas",
      "DNSName": "nas.tail4c2a1.ts.net.",
      "OS": "linux",
      "UserID": 9001,
      "TailscaleIPs": [
        "100.88.4.20",
        "fd7a:115c:a1e0::1",
      ],
      "Tags": [
        "tag:server",
        "tag:storage",
      ],
      "Relay": "par",
      "CurAddr": "192.168.1.20:41641",
      "RxBytes": 1543210,
      "TxBytes": 98765,
      "LastSeen": "2026-10-28T12:40:00Z",
      "Online": true,
      "ExitNode": false,
      "ExitNodeOption": true,
      "Active": true,
      "sshHostKeys": [
        "ssh-ed25519 AAAA",
      ],
      "KeyExpiry": "0001-01-01T00:00:00Z",
    },
    "nodekey:ccc": {
      "ID": "nPhone789CNTRL",
      "HostName": "Pixel 8",
      "DNSName": "pixel-8.tail4c2a1.ts.net.",
      "OS": "android",
      "UserID": 9001,
      "TailscaleIPs": [
        "100.77.1.3",
      ],
      "Relay": "fra",
      "LastSeen": "2026-10-27T19:02:00Z",
      "Online": false,
      "ExitNode": false,
      "ExitNodeOption": false,
      "KeyExpiry": "2026-11-02T10:00:00Z",
    },
    "nodekey:ddd": {
      "ID": "nVps000CNTRL",
      "HostName": "vps-fra1",
      "DNSName": "vps-fra1.tail4c2a1.ts.net.",
      "OS": "linux",
      "UserID": 9002,
      "TailscaleIPs": [
        "100.64.0.9",
      ],
      "Tags": [
        "tag:exit",
      ],
      "Relay": "fra",
      "Online": true,
      "ExitNode": false,
      "ExitNodeOption": true,
      "RxBytes": 20480,
      "TxBytes": 4096,
    },
    "nodekey:eee": {
      "ID": "nMac111CNTRL",
      "HostName": "Annes-MacBook-Air",
      "DNSName": "annes-macbook-air.tail4c2a1.ts.net.",
      "OS": "macOS",
      "UserID": 9003,
      "TailscaleIPs": [
        "100.70.2.2",
      ],
      "Relay": "lhr",
      "Online": true,
      "ExitNode": false,
      "ExitNodeOption": false,
    },
  },
  "User": {
    "9001": {
      "ID": 9001,
      "LoginName": "steven@example.com",
      "DisplayName": "Steven Persia",
    },
    "9002": {
      "ID": 9002,
      "LoginName": "tagged-devices",
      "DisplayName": "Tagged Devices",
    },
    "9003": {
      "ID": 9003,
      "LoginName": "anne@example.com",
      "DisplayName": "Anne Martin",
    },
  },
});

Deno.test("parses the tailnet", () => {
  const s = parseStatus(STATUS);
  assertEquals(s.state, "Running");
  assertEquals(s.version, "1.76.6");
  assertEquals(s.tailnet, "steven@example.com");
  assertEquals(s.self?.name, "laptop");
  assertEquals(s.self?.dnsName, "laptop.tail4c2a1.ts.net");
  assertEquals(s.self?.ipv4, "100.101.12.7");
  assertEquals(s.self?.ipv6, "fd7a:115c:a1e0::4d01:c07");
  assertEquals(s.self?.lastSeen, undefined);
  // Online first, then by name.
  assertEquals(s.peers.map((p) => p.name), ["annes-macbook-air", "nas", "vps-fra1", "pixel-8"]);
  const nas = s.peers.find((p) => p.name === "nas")!;
  assertEquals(nas.tags, ["tag:server", "tag:storage"]);
  assertEquals(nas.owner, undefined, "tagged devices have no owner");
  assertEquals(nas.connection, { kind: "direct", address: "192.168.1.20:41641" });
  assertEquals(nas.tailscaleSsh, true);
  assertEquals(nas.keyExpiry, undefined);
  assertEquals(nas.exitNodeOption, true);
  const mac = s.peers.find((p) => p.name === "annes-macbook-air")!;
  assertEquals(mac.owner, "Anne Martin");
  assertEquals(mac.connection, undefined, "idle peers have no connection");
  const phone = s.peers.find((p) => p.os === "android")!;
  assertEquals(phone.online, false);
  assertEquals(ago(phone.lastSeen, NOW), "17h ago");
  assertEquals(until(phone.keyExpiry, NOW), "in 4 days");
  assertEquals(deviceIcon(phone), "bs-apps");
  assertEquals(deviceIcon(nas), "bs-server");
  assertEquals(deviceIcon(mac), "bs-monitor");
});

Deno.test("exit node in use, status lines", () => {
  const raw = JSON.parse(STATUS);
  assertEquals(subtitle(parseStatus(STATUS)), "Connected · 3 online");
  assertEquals(statusLine(parseStatus(STATUS)), "steven@example.com · Connected as laptop · 3 of 4 online");
  raw.Peer["nodekey:ddd"].ExitNode = true;
  const s = parseStatus(JSON.stringify(raw));
  assertEquals(exitNodeInUse(s)?.name, "vps-fra1");
  assertEquals(s.peers[0].name, "vps-fra1");
  assertEquals(deviceIcon(s.peers[0]), "bs-globe");
  assertEquals(subtitle(s), "Connected via vps-fra1");
  assertEquals(statusLine(s), "steven@example.com · Connected as laptop · exit node vps-fra1 · 3 of 4 online");
  raw.BackendState = "Stopped";
  assertEquals(subtitle(parseStatus(JSON.stringify(raw))), "Disconnected");
  raw.BackendState = "NeedsLogin";
  assertEquals(statusLine(parseStatus(JSON.stringify(raw))), "steven@example.com · Signed out · exit node vps-fra1");
});

Deno.test("commands", () => {
  const s = parseStatus(STATUS);
  const nas = s.peers.find((p) => p.name === "nas")!;
  const mac = s.peers.find((p) => p.name === "annes-macbook-air")!;
  assertEquals(sshArgv(nas), ["tailscale", "ssh", "nas.tail4c2a1.ts.net"]);
  assertEquals(sshArgv(mac, "anne"), ["ssh", "anne@annes-macbook-air.tail4c2a1.ts.net"]);
  assertEquals(exitNodeArgs(nas), ["set", "--exit-node=100.88.4.20"]);
  assertEquals(exitNodeArgs(), ["set", "--exit-node="]);
  assertEquals(taildropArgs(["/tmp/a.pdf"], nas), ["file", "cp", "/tmp/a.pdf", "100.88.4.20:"]);
  assertEquals(expandPaths("~/a b.pdf\n  'file:///tmp/x%20y.png' \n\n~", "/home/me"), [
    "/home/me/a b.pdf",
    "/tmp/x y.png",
    "/home/me",
  ]);
});

Deno.test("ping and errors", () => {
  assertEquals(parsePing("pong from nas (100.88.4.20) via 192.168.1.20:41641 in 3ms"), {
    ms: 3,
    via: "192.168.1.20:41641",
    direct: true,
  });
  assertEquals(parsePing("pong from vps (100.64.0.9) via DERP(fra) in 32ms\ndirect connection not established"), {
    ms: 32,
    via: "relay fra",
    direct: false,
  });
  assertEquals(parsePing("timeout waiting for ping reply"), undefined);
  assert(
    explainError("tailscale exited with 1: Access denied: prefs write access denied").includes("--operator=$USER"),
  );
  assert(explainError("failed to connect to local tailscaled; it doesn't appear to be running").includes("systemctl"));
  assertEquals(
    explainError("tailscale exited with 1: open /x: no such file or directory"),
    "open /x: no such file or directory",
  );
});

Deno.test("formatting and install hints", () => {
  assertEquals(bytes(512), "512 B");
  assertEquals(bytes(1543210), "1.5 MB");
  assertEquals(osFamily("ID=fedora\nVERSION_ID=41"), "fedora");
  assertEquals(osFamily('ID=pop\nID_LIKE="ubuntu debian"'), "debian");
  assertEquals(installCommand("arch"), "sudo pacman -S tailscale");
  assertEquals(installCommand(undefined), "curl -fsSL https://tailscale.com/install.sh | sh");
});

Deno.test("terminal command lines", () => {
  assertEquals(terminalArgs("kitty", ["tailscale", "ssh", "nas"]), ["tailscale", "ssh", "nas"]);
  assertEquals(terminalArgs("gnome-terminal", ["ssh", "db"]), ["--", "ssh", "db"]);
  assertEquals(terminalArgs("tilix", ["ssh", "my host"]), ["-e", "ssh 'my host'"]);
  assertEquals(shellLine(["ssh", "it's"]), "ssh 'it'\\''s'");
});
