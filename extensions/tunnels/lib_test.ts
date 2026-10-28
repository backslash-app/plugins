import { assertEquals, assertThrows } from "@std/assert";
import {
  duration,
  freeWebPort,
  hostOf,
  installCommand,
  ngrokLogUrl,
  osFamily,
  parseNgrokApi,
  parsePort,
  parseSs,
  parseSystemdTime,
  parseUnit,
  parseUnits,
  shareablePorts,
  startArgs,
  subtitle,
  trycloudflareUrl,
  tunnelError,
  unitName,
} from "./lib.ts";

// cloudflared's stderr for a quick tunnel, as journalctl -o cat shows it.
const CLOUDFLARED =
  `2026-10-28T12:00:00Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.
2026-10-28T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-10-28T12:00:01Z INF +--------------------------------------------------------------------------------------------+
2026-10-28T12:00:01Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-10-28T12:00:01Z INF |  https://plain-sunset-arcade-heavy.trycloudflare.com                                       |
2026-10-28T12:00:01Z INF +--------------------------------------------------------------------------------------------+
2026-10-28T12:00:01Z INF Version 2025.10.0
2026-10-28T12:00:02Z ERR Failed to initialize DNS local resolver error="lookup region1.v2.argotunnel.com: no such host"
2026-10-28T12:00:02Z INF Registered tunnel connection connIndex=0 location=cdg07 protocol=quic`;

// `ngrok http 3000 --log stdout --log-format json`.
const NGROK =
  `{"addr":"http://localhost:3000","lvl":"info","msg":"started tunnel","name":"command_line","obj":"tunnels","t":"2026-10-28T12:00:00.1+01:00","url":"https://9f2c-81-64-12-7.ngrok-free.app"}`;
const NGROK_AUTH =
  `{"err":"authentication failed: Usage of ngrok requires a verified account and authtoken.\\n\\nSign up for an account: https://dashboard.ngrok.com/signup\\n\\nERR_NGROK_4018\\n","lvl":"eror","msg":"failed to reconnect session","obj":"tunnels.session"}`;

// `GET http://127.0.0.1:4040/api/tunnels`.
const API = {
  tunnels: [
    {
      name: "command_line (http)",
      public_url: "http://9f2c.ngrok-free.app",
      proto: "http",
      config: { addr: "http://localhost:3000", inspect: true },
      metrics: { conns: { count: 1 }, http: { count: 2 } },
    },
    {
      name: "command_line",
      ID: "e0b6",
      uri: "/api/tunnels/command_line",
      public_url: "https://9f2c.ngrok-free.app",
      proto: "https",
      config: { addr: "http://localhost:3000", inspect: true },
      metrics: { conns: { count: 4, gauge: 0, rate1: 0 }, http: { count: 17, rate1: 0 } },
    },
  ],
  uri: "/api/tunnels",
};

Deno.test("unit names", () => {
  assertEquals(unitName("ngrok", 3000, 4041), "backslash-tunnel-ngrok-3000-4041");
  assertEquals(parseUnit("backslash-tunnel-ngrok-3000-4041.service"), {
    name: "backslash-tunnel-ngrok-3000-4041",
    provider: "ngrok",
    port: 3000,
    webPort: 4041,
  });
  assertEquals(parseUnit("backslash-tunnel-cloudflared-5173"), {
    name: "backslash-tunnel-cloudflared-5173",
    provider: "cloudflared",
    port: 5173,
  });
  assertEquals(parseUnit("backslash-timer-12"), undefined);
  const units = parseUnits(
    `backslash-tunnel-cloudflared-5173.service loaded active running Backslash tunnel: cloudflared :5173
● backslash-tunnel-ngrok-3000-4040.service loaded failed failed Backslash tunnel: ngrok :3000
something-else.service loaded active running Other`,
  );
  assertEquals(units.map((u) => [u.port, u.active]), [[5173, "active"], [3000, "failed"]]);
  assertEquals(freeWebPort([{ name: "x", provider: "ngrok", port: 1, webPort: 4040 }]), 4041);
  assertEquals(parseSystemdTime("Tue 2026-10-28 12:01:02 UTC"), Date.parse("2026-10-28T12:01:02Z"));
  assertEquals(parseSystemdTime(""), undefined);
});

Deno.test("systemd-run arguments", () => {
  const args = startArgs("ngrok", 3000, { PATH: "/home/me/.local/bin:/usr/bin", HOME: "/home/me" }, 4040);
  assertEquals(args.slice(0, 3), ["--user", "--quiet", "--unit=backslash-tunnel-ngrok-3000-4040"]);
  assertEquals(args.includes("--setenv=HOME=/home/me"), true);
  assertEquals(
    args.at(-1),
    "exec 'ngrok' 'http' '3000' '--web-addr' '127.0.0.1:4040' '--log' 'stdout' '--log-format' 'json'",
  );
  const cf = startArgs("cloudflared", 5173, {});
  assertEquals(cf.at(-1), "exec 'cloudflared' 'tunnel' '--no-autoupdate' '--url' 'http://localhost:5173'");
  // A script sh can read.
  const check = new Deno.Command("sh", { args: ["-n", "-c", cf.at(-1)!] }).outputSync();
  assertEquals(check.success, true);
});

Deno.test("public URLs and errors", () => {
  assertEquals(trycloudflareUrl(CLOUDFLARED), "https://plain-sunset-arcade-heavy.trycloudflare.com");
  assertEquals(trycloudflareUrl("starting"), undefined);
  assertEquals(tunnelError("cloudflared", CLOUDFLARED), undefined, "the DNS resolver warning is harmless");
  assertEquals(
    tunnelError("cloudflared", "2026-10-28T12:00:00Z ERR Error unmarshaling QuickTunnel response: error code: 1015"),
    "Error unmarshaling QuickTunnel response: error code: 1015",
  );
  assertEquals(ngrokLogUrl(NGROK), "https://9f2c-81-64-12-7.ngrok-free.app");
  assertEquals(
    ngrokLogUrl('t=2026 lvl=info msg="started tunnel" obj=tunnels name=command_line url=https://a.ngrok.app'),
    "https://a.ngrok.app",
  );
  assertEquals(tunnelError("ngrok", NGROK_AUTH), "ngrok needs your authtoken: ngrok config add-authtoken <token>");
  assertEquals(tunnelError("ngrok", NGROK), undefined);
  const api = parseNgrokApi(API);
  assertEquals(api[0], {
    publicUrl: "https://9f2c.ngrok-free.app",
    addr: "http://localhost:3000",
    connections: 4,
    requests: 17,
  });
  assertEquals(parseNgrokApi({}), []);
});

Deno.test("ports to share", () => {
  const ss = `LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4242,fd=23))
LISTEN 0 511 [::1]:5173 [::]:* users:(("node",pid=4242,fd=24))
LISTEN 0 4096 127.0.0.1:4040 0.0.0.0:* users:(("ngrok",pid=900,fd=7))
LISTEN 0 4096 127.0.0.1:20241 0.0.0.0:* users:(("cloudflared",pid=901,fd=8))
LISTEN 0 128 0.0.0.0:22 0.0.0.0:*
LISTEN 0 511 *:3000 *:* users:(("python3",pid=77,fd=3))`;
  assertEquals(shareablePorts(parseSs(ss)), [
    { port: 3000, process: "python3", pid: 77, local: false },
    { port: 5173, process: "node", pid: 4242, local: true },
    { port: 22, process: undefined, pid: undefined, local: false },
  ]);
  assertEquals(parsePort("localhost:8080"), 8080);
  assertEquals(parsePort(" 3000 "), 3000);
  assertThrows(() => parsePort("70000"), Error, "not a port");
});

Deno.test("formatting and install hints", () => {
  assertEquals(subtitle(0), null);
  assertEquals(subtitle(1), "1 tunnel open");
  assertEquals(subtitle(3), "3 tunnels open");
  assertEquals(duration(30_000), "just now");
  assertEquals(duration(65 * 60_000), "1 h 5 min");
  assertEquals(hostOf("https://x.trycloudflare.com/"), "x.trycloudflare.com");
  assertEquals(installCommand("cloudflared", osFamily("ID=arch")), "sudo pacman -S cloudflared");
  assertEquals(installCommand("ngrok", osFamily("ID=ubuntu\nID_LIKE=debian")), "sudo snap install ngrok");
});
