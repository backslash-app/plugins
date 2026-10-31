import { run } from "@backslash/api";
import { cli, NotInstalled } from "../cli.ts";
import { cleanNetworkId, explainZt } from "../lib.ts";

export default run<{ network: string }>(async ({ args }) => {
  const id = cleanNetworkId(args.network);
  if (!id) throw new Error("A ZeroTier network ID is 16 hex digits, like 8056c2e21c000001");
  let r;
  try {
    r = await cli("zerotier-cli", ["join", id]);
  } catch (e) {
    if (e instanceof NotInstalled) throw new Error("ZeroTier is not installed: https://www.zerotier.com/download/");
    throw e;
  }
  if (!r.ok || !r.out.startsWith("200")) throw new Error(explainZt(r.err || r.out));
  return `Joined ${id}: authorize this device in the network's controller if it is private`;
});
