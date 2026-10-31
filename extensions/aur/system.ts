// pacman (installed foreign packages), finding the AUR helper and running it in a terminal.

import { type Helper, holdOpen, type Installed, parseQm } from "./lib.ts";
import { runInTerminal } from "./terminal.ts";

export class NoPacman extends Error {}

async function output(program: string, args: string[], signal?: AbortSignal): Promise<string | undefined> {
  try {
    const o = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      env: { LC_ALL: "C" },
      signal,
    }).output();
    // pacman -Qm exits with 1 when there is no foreign package.
    return new TextDecoder().decode(o.stdout);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}

/** Packages that came from no repository (`pacman -Qm`): AUR builds and local ones. */
export async function foreign(signal?: AbortSignal): Promise<Installed[]> {
  const out = await output("pacman", ["-Qm"], signal);
  if (out === undefined) throw new NoPacman("pacman was not found: the AUR is for Arch Linux and its derivatives");
  return parseQm(out);
}

let cached: Promise<Helper | undefined> | undefined;

/** The AUR helper to use: the preference, else paru, else yay; undefined when neither is installed. */
export function helper(preferred?: unknown): Promise<Helper | undefined> {
  const want = String(preferred ?? "").trim().toLowerCase();
  if (want === "paru" || want === "yay") return Promise.resolve(want);
  cached ??= (async () => {
    for (const h of ["paru", "yay"] as const) {
      if (await output(h, ["--version"]) !== undefined) return h;
    }
    return undefined;
  })();
  return cached;
}

/** Runs a command in the terminal and keeps the window open at the end. */
export function inTerminal(command: string, terminal?: unknown): string {
  const t = String(terminal ?? "").trim();
  return runInTerminal(holdOpen(command), t || undefined);
}
