import { run, updateCommandMetadata } from "@backslash/api";
import { nextLayout } from "../lib.ts";
import { load, switchTo } from "../system.ts";

// Cycles through the desktop's layouts; with Fcitx 5 running, through its input methods.
export default run(async () => {
  const s = await load();
  const pool = s.framework === "fcitx5" && s.methods.length > 1 ? s.methods : s.layouts;
  if (!s.backend && !pool.length) throw new Error("No keyboard layout backend found: open Keyboard Layouts");
  const next = nextLayout(pool);
  if (!next) throw new Error("Only one keyboard layout is set up");
  await switchTo(s, next);
  updateCommandMetadata({ subtitle: null }).catch(() => {});
  return `Keyboard: ${next.name}`;
});
