import { clipboard, run } from "@backslash/api";
import { publicIps } from "../system.ts";

export default run(async () => {
  const ips = await publicIps();
  const ip = ips.v4 ?? ips.v6;
  if (!ip) throw new Error(`No public IP: ${ips.error ?? "offline?"}`);
  await clipboard.write(ip);
  return `Copied ${ip}`;
});
