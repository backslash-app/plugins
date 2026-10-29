// What the commands share: taking a snapshot, restoring by name, the setup message.

import type { Context } from "@backslash/api";
import { BACKEND_NAMES, findLayout, type Layout, restoreMessage, snapshot, uniqueName } from "./lib.ts";
import { apps, detect, layouts, putLayout, restore, type Session, windows } from "./system.ts";

export class NoBackend extends Error {}

/** Says which tool to install when no compositor answers. */
export function noBackendMessage(s: Session): string {
  if (s.wanted.includes("kde")) return "Install kdotool to save and restore window layouts on KDE Plasma";
  if (s.wanted.includes("x11")) return "Install wmctrl to save and restore window layouts on X11";
  if (s.wanted.length) return `${BACKEND_NAMES[s.wanted[0]]} doesn't answer: is the launcher running in your session?`;
  return "Window Layouts works with Hyprland, Sway, niri, KDE Plasma (kdotool) and X11 (wmctrl)";
}

export async function session(): Promise<Session & { backend: NonNullable<Session["backend"]> }> {
  const s = await detect();
  if (!s.backend) throw new NoBackend(noBackendMessage(s));
  return s as Session & { backend: NonNullable<Session["backend"]> };
}

export const timeoutOf = (ctx: Pick<Context, "preferences">) => {
  const n = Number(ctx.preferences.timeout ?? 20);
  return (Number.isFinite(n) && n > 0 ? Math.min(n, 120) : 20) * 1000;
};

/** Saves the windows open now under `name`, keeping the extras and edited commands of a layout it replaces. */
export async function saveCurrent(name: string, o: { extras?: string[]; replace?: boolean } = {}): Promise<Layout> {
  const s = await session();
  const [open, installed, all] = await Promise.all([windows(s.backend), apps(), layouts()]);
  const existing = findLayout(all, name);
  const same = existing && existing.name.toLowerCase() === name.trim().toLowerCase() ? existing : undefined;
  // Commands typed by the user for an app stay when the layout is saved again.
  const overrides: Record<string, string> = {};
  for (const w of same?.windows ?? []) {
    if (w.command && !w.desktopId) overrides[w.appId.toLowerCase()] = w.command;
  }
  const now = Date.now();
  const layout: Layout = {
    name: same && o.replace !== false ? same.name : uniqueName(name, all.map((l) => l.name)),
    backend: s.backend,
    created: same?.created ?? now,
    updated: now,
    windows: snapshot(open, installed, overrides),
    extras: o.extras ?? same?.extras ?? [],
  };
  await putLayout(layout, same?.name);
  return layout;
}

export async function restoreNamed(name: string, ctx: Pick<Context, "preferences">): Promise<string> {
  const layout = findLayout(await layouts(), name);
  if (!layout) throw new Error(`No layout named “${name}”: save one with Save Window Layout`);
  const s = await session();
  return restoreMessage(layout.name, await restore(s.backend, layout, timeoutOf(ctx)));
}
