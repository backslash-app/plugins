// The no-view commands: one action on the window the user was in.

import type { Context } from "@backslash/api";
import { actionInfo, BACKEND_NAMES, supports, type WindowAction } from "./lib.ts";
import { act, detect, moveTo, switchTo } from "./system.ts";

export interface Prefs {
  delay?: number;
}

export const delayOf = (ctx: Context) => {
  const d = Number((ctx.preferences as Prefs).delay);
  return Number.isFinite(d) && d >= 0 ? Math.min(d, 2000) : 250;
};

async function session() {
  const s = await detect();
  if (!s.backend) {
    throw new Error("No supported window manager: open the Window Manager command to see what to install");
  }
  return s;
}

/** Closes the launcher with no message, so the focus goes back to the window right away. */
export const perform = (a: WindowAction) => async (ctx: Context): Promise<void> => {
  const s = await session();
  if (!supports(s.backend!, a)) {
    throw new Error(`${actionInfo(a).title} isn't available on ${BACKEND_NAMES[s.backend!]}`);
  }
  await act(s, a, delayOf(ctx));
};

const workspaceArg = (ctx: Context) => {
  const n = Math.trunc(Number((ctx.args as { workspace?: unknown }).workspace));
  if (!Number.isFinite(n) || n < 1) throw new Error("Give a workspace number, from 1");
  return n;
};

export const moveToWorkspace = async (ctx: Context): Promise<void> => {
  await moveTo(await session(), workspaceArg(ctx), delayOf(ctx));
};

export const switchWorkspace = async (ctx: Context): Promise<void> => {
  await switchTo(await session(), workspaceArg(ctx));
};
