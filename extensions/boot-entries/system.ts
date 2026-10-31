// Reading the boot menus (bootctl, logind, grub.cfg, the BLS entries, efibootmgr) and rebooting into one entry.
// Reading is done as the user; picking the next GRUB or EFI entry needs root, through pkexec.

import {
  type BootEntry,
  cancelNextScript,
  entriesFromIds,
  logindRebootArgs,
  markGrub,
  nextBootScript,
  parseBlsEntry,
  parseBootctl,
  parseBusctlString,
  parseBusctlStrings,
  parseEfibootmgr,
  parseGrubCfg,
  parseGrubenv,
  pkexecError,
  rebootError,
  sortBls,
  type Source,
} from "./lib.ts";

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

class Missing extends Error {}

async function sh(program: string, args: string[], timeout = 15_000): Promise<Output> {
  try {
    const { code, stdout, stderr } = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C" },
      signal: AbortSignal.timeout(timeout),
    }).output();
    const text = (b: Uint8Array) => new TextDecoder().decode(b);
    return { code, stdout: text(stdout), stderr: text(stderr).trim() };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Missing(program);
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error(`${program} took too long`);
    throw e;
  }
}

/** Runs a script as root, after polkit asks for the password. */
async function asRoot(script: string): Promise<string> {
  let o: Output;
  try {
    // Two minutes to type the password.
    o = await sh("pkexec", ["/bin/sh", "-c", script], 120_000);
  } catch (e) {
    if (e instanceof Missing) throw new Error("pkexec (polkit) is needed to change the next boot entry");
    throw e;
  }
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code === 127) throw new Error(`Not installed: ${o.stderr.split("\n").pop()}`);
  if (o.code !== 0) throw new Error(o.stderr.split("\n").filter(Boolean).pop() || `Exited with ${o.code}`);
  return o.stdout;
}

const LOGIN1 = ["org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager"];

async function logindProperty(name: string): Promise<string | undefined> {
  try {
    const o = await sh("busctl", ["get-property", ...LOGIN1, name], 5000);
    return o.code === 0 ? o.stdout : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// systemd-boot

export interface SystemdBoot {
  entries: BootEntry[];
  /** bootctl couldn't read the ESP: the ids come from logind. */
  partial?: boolean;
}

export async function systemdBoot(): Promise<SystemdBoot | undefined> {
  try {
    const o = await sh("bootctl", ["list", "--json=short", "--no-pager"]);
    const entries = o.code === 0 ? parseBootctl(o.stdout) : undefined;
    if (entries?.length) return { entries };
  } catch (e) {
    if (!(e instanceof Missing)) throw e;
  }
  // The ESP is often readable by root only; logind still knows what the loader reported.
  const ids = parseBusctlStrings(await logindProperty("BootLoaderEntries") ?? "");
  if (!ids.length) return undefined;
  return { entries: entriesFromIds(ids), partial: true };
}

// ---------------------------------------------------------------------------
// GRUB

const GRUB_DIRS = ["/boot/grub", "/boot/grub2"];

export interface Grub {
  entries: BootEntry[];
  dir: string;
  /** grub-reboot, or grub2-reboot on Fedora and openSUSE. */
  rebootTool: string;
  editenvTool: string;
  supportsNextEntry: boolean;
  /** grub.cfg is readable by root only: the menu is unknown until the user asks. */
  locked?: boolean;
}

let rootGrubCfg: { dir: string; text: string } | undefined;

async function readable(path: string): Promise<string | "locked" | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.PermissionDenied || (e as { code?: string }).code === "EACCES") return "locked";
    return undefined;
  }
}

async function blsEntries(): Promise<BootEntry[]> {
  const found: BootEntry[] = [];
  try {
    for await (const f of Deno.readDir("/boot/loader/entries")) {
      if (!f.isFile || !f.name.endsWith(".conf")) continue;
      const text = await Deno.readTextFile(`/boot/loader/entries/${f.name}`).catch(() => "");
      if (text) found.push(parseBlsEntry(f.name.replace(/\.conf$/, ""), text));
    }
  } catch {
    // No BLS entries.
  }
  return sortBls(found);
}

export async function grub(): Promise<Grub | undefined> {
  for (const dir of GRUB_DIRS) {
    const tools = dir.endsWith("grub2")
      ? { rebootTool: "grub2-reboot", editenvTool: "grub2-editenv" }
      : { rebootTool: "grub-reboot", editenvTool: "grub-editenv" };
    let cfg = await readable(`${dir}/grub.cfg`);
    if (cfg === undefined) continue;
    if (cfg === "locked") {
      if (rootGrubCfg?.dir !== dir) return { entries: [], dir, ...tools, supportsNextEntry: true, locked: true };
      cfg = rootGrubCfg.text;
    }
    const menu = parseGrubCfg(cfg);
    const envText = await readable(`${dir}/grubenv`);
    const env = parseGrubenv(typeof envText === "string" && envText !== "locked" ? envText : "");
    if (menu.usesBls) menu.entries = [...(await blsEntries()), ...menu.entries];
    return { entries: markGrub(menu, env), dir, ...tools, supportsNextEntry: menu.supportsNextEntry };
  }
  return undefined;
}

/** Reads a root-only grub.cfg once, through pkexec; kept while the launcher runs. */
export async function unlockGrub(dir: string): Promise<void> {
  rootGrubCfg = { dir, text: await asRoot(`cat ${dir}/grub.cfg`) };
}

// ---------------------------------------------------------------------------
// EFI

export async function efi(): Promise<ReturnType<typeof parseEfibootmgr> | undefined> {
  try {
    const o = await sh("efibootmgr", []);
    if (o.code !== 0) return undefined; // not an EFI system, or efivarfs isn't mounted
    const menu = parseEfibootmgr(o.stdout);
    return menu.entries.length ? menu : undefined;
  } catch (e) {
    if (e instanceof Missing) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Firmware setup

/** "yes", "no", "challenge" (needs a password) or "na" (not an EFI system); undefined when logind doesn't say. */
export async function firmwareSetup(): Promise<string | undefined> {
  return parseBusctlString(await logindProperty("CanRebootToFirmwareSetup") ?? "");
}

// ---------------------------------------------------------------------------
// Rebooting

async function systemctl(args: string[]): Promise<void> {
  let o: Output;
  try {
    o = await sh("systemctl", args, 60_000);
  } catch (e) {
    if (e instanceof Missing) throw new Error("systemctl was not found: this needs systemd");
    throw e;
  }
  if (o.code !== 0) throw new Error(rebootError(o.stderr || o.stdout));
}

export interface Tools {
  grubReboot: string;
  grubEditenv: string;
}

/** Picks the entry for the next boot only, without rebooting. */
export async function setNext(e: BootEntry, tools: Tools): Promise<void> {
  await asRoot(nextBootScript(e, tools.grubReboot));
}

export async function cancelNext(source: Source, tools: Tools): Promise<void> {
  await asRoot(cancelNextScript(source, tools.grubEditenv));
}

/** Makes a systemd-boot entry the default one. */
export async function setDefault(e: BootEntry): Promise<void> {
  await asRoot(`PATH=/usr/sbin:/usr/bin:/sbin:/bin; bootctl set-default '${e.target.replace(/'/g, `'\\''`)}'`);
}

/** Reboots into the entry once: logind for systemd-boot (no password), else root picks it first. */
export async function rebootInto(e: BootEntry, tools: Tools): Promise<void> {
  if (e.source === "systemd-boot") {
    try {
      await systemctl(logindRebootArgs(e));
      return;
    } catch (err) {
      // Older systemd or loader: set the one-shot entry as root instead.
      if (!/doesn't support picking/.test((err as Error).message)) throw err;
    }
  }
  await setNext(e, tools);
  await systemctl(["reboot"]);
}

export const rebootToFirmware = () => systemctl(["reboot", "--firmware-setup"]);
export const reboot = () => systemctl(["reboot"]);
