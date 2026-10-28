import { clipboard, run } from "@backslash/api";
import { parsePort, type Provider } from "../lib.ts";
import { available, start } from "../system.ts";

// "Share Port 3000": opens the tunnel, waits for its URL and copies it.
export default run<{ port: string; provider?: string }>(async ({ args, preferences }) => {
  const port = parsePort(args.port);
  const asked = String(args.provider || preferences.provider || "").trim().toLowerCase();
  const order: Provider[] = asked === "ngrok" ? ["ngrok", "cloudflared"] : ["cloudflared", "ngrok"];
  const provider = asked === "ngrok" || asked === "cloudflared"
    ? asked as Provider
    : (await Promise.all(order.map(async (p) => (await available(p)) ? p : undefined))).find(Boolean);
  if (!provider) throw new Error("Install cloudflared or ngrok first: open Tunnels for the command");
  const url = await start(provider, port);
  if (!url) return `Tunnel to :${port} is starting: open Tunnels for its URL`;
  await clipboard.write(url);
  return `Copied ${url.replace(/^https:\/\//, "")}`;
});
