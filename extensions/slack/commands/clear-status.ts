import { run, updateCommandMetadata } from "@backslash/api";
import { clearStatus, getStatus, tokenOf } from "../api.ts";
import { AuthError } from "../lib.ts";

export default run(async (ctx) => {
  let token: string;
  try {
    token = tokenOf(ctx);
  } catch (e) {
    if (e instanceof AuthError) throw new Error(`${e.message}: open Set Slack Status to see how`);
    throw e;
  }
  const before = await getStatus(token);
  if (!before.text && !before.emoji) return "No status to clear";
  await clearStatus(token);
  updateCommandMetadata({ subtitle: null }).catch(() => {});
  return "Slack status cleared";
});
