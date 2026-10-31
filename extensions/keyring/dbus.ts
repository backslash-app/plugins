// The Secret Service over D-Bus (busctl, or gdbus without systemd), and
// secret-tool to read a secret when the user asks for it.

import { exec } from "@backslash/api";
import {
  attributeArgs,
  type Collection,
  explain,
  IFACE,
  lookupIsUnique,
  parseBusctl,
  parseGdbus,
  parseSearch,
  type SecretItem,
  SERVICE,
  SERVICE_PATH,
  toCollection,
  toItem,
  unwrapVariants,
} from "./lib.ts";

type Arg = { s: string } | { ao: string[] };

let tool: "busctl" | "gdbus" | undefined;

const notFound = (e: unknown) => e instanceof Deno.errors.NotFound;

function busctlArgs(path: string, iface: string, method: string, args: Arg[]): string[] {
  const sig = args.map((a) => ("s" in a ? "s" : "ao")).join("");
  const values = args.flatMap((a) => ("s" in a ? [a.s] : [String(a.ao.length), ...a.ao]));
  return ["--user", "--json=short", "call", SERVICE, path, iface, method, ...(sig ? [sig, ...values] : [])];
}

const gvString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function gdbusArgs(path: string, iface: string, method: string, args: Arg[]): string[] {
  const values = args.map((a) => ("s" in a ? gvString(a.s) : `@ao [${a.ao.map(gvString).join(", ")}]`));
  return ["call", "--session", "--dest", SERVICE, "--object-path", path, "--method", `${iface}.${method}`, ...values];
}

/** Calls a Secret Service method; returns its out values as plain data. */
export async function call(
  path: string,
  iface: string,
  method: string,
  args: Arg[] = [],
  signal?: AbortSignal,
): Promise<unknown[]> {
  try {
    if (tool !== "gdbus") {
      try {
        const out = parseBusctl(await exec("busctl", busctlArgs(path, iface, method, args), { signal }));
        tool = "busctl";
        return out;
      } catch (e) {
        if (!notFound(e)) throw e;
        tool = "gdbus";
      }
    }
    return parseGdbus(await exec("gdbus", gdbusArgs(path, iface, method, args), { signal }));
  } catch (e) {
    if (notFound(e)) throw new Error("Neither busctl (systemd) nor gdbus (GLib) is installed to reach the keyring");
    if (signal?.aborted) throw e;
    throw new Error(explain(e instanceof Error ? e.message : String(e)));
  }
}

const getAll = async (path: string, iface: string, signal?: AbortSignal) =>
  unwrapVariants((await call(path, IFACE.properties, "GetAll", [{ s: iface }], signal))[0]);

export async function collections(signal?: AbortSignal): Promise<Collection[]> {
  const [paths] = await call(
    SERVICE_PATH,
    IFACE.properties,
    "Get",
    [{ s: IFACE.service }, { s: "Collections" }],
    signal,
  );
  const defaultPath = await call(SERVICE_PATH, IFACE.service, "ReadAlias", [{ s: "default" }], signal)
    .then(([p]) => (typeof p === "string" && p !== "/" ? p : undefined))
    .catch(() => undefined);
  const list = Array.isArray(paths) ? paths.map(String) : [];
  // The session collection lives in memory and is usually empty: keep it only when it isn't.
  const found = await Promise.all(
    list.map(async (p) => toCollection(p, await getAll(p, IFACE.collection, signal), defaultPath)),
  );
  return found.filter((c) => !(c.path.endsWith("/session") && !c.items.length));
}

/** Every item's properties, a few calls at a time, yielding as they arrive. */
export async function* items(paths: string[], signal?: AbortSignal): AsyncGenerator<SecretItem[]> {
  const queue = [...paths];
  const batch: SecretItem[] = [];
  let last = Date.now();
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      if (signal?.aborted) return;
      try {
        batch.push(toItem(p, await getAll(p, IFACE.item, signal)));
      } catch {
        // Deleted meanwhile, or not readable: leave it out.
      }
    }
  };
  const all = Promise.all(Array.from({ length: 8 }, worker));
  let done = false;
  all.finally(() => done = true);
  while (!done) {
    await Promise.race([all, new Promise((r) => setTimeout(r, 250))]);
    if (batch.length && (done || Date.now() - last > 400)) {
      yield batch.splice(0);
      last = Date.now();
    }
  }
  await all;
  if (batch.length) yield batch.splice(0);
}

// ---------------------------------------------------------------------------
// Changes

async function prompt(path: unknown): Promise<boolean> {
  if (typeof path !== "string" || path === "/" || !path) return false;
  await call(path, IFACE.prompt, "Prompt", [{ s: "" }]);
  return true;
}

/** Asks the service to unlock; true when it shows a password prompt. */
export async function unlock(collection: string): Promise<boolean> {
  const [, p] = await call(SERVICE_PATH, IFACE.service, "Unlock", [{ ao: [collection] }]);
  return prompt(p);
}

export async function lock(collection: string): Promise<void> {
  const [, p] = await call(SERVICE_PATH, IFACE.service, "Lock", [{ ao: [collection] }]);
  await prompt(p);
}

export async function isLocked(collection: string): Promise<boolean> {
  return (await getAll(collection, IFACE.collection)).Locked === true;
}

/** Deletes the item; true when the service asks the user to confirm in a prompt. */
export async function remove(item: SecretItem): Promise<boolean> {
  const [p] = await call(item.path, IFACE.item, "Delete");
  return prompt(p);
}

// ---------------------------------------------------------------------------
// Secrets

async function secretTool(args: string[]): Promise<string> {
  try {
    const out = await new Deno.Command("secret-tool", { args, stdin: "null", stdout: "piped", stderr: "piped" })
      .output();
    const text = new TextDecoder().decode(out.stdout);
    if (!out.success) {
      throw new Error(explain(new TextDecoder().decode(out.stderr).trim() || "secret-tool couldn't read the secret"));
    }
    return text;
  } catch (e) {
    if (notFound(e)) {
      throw new Error("secret-tool is needed to read secrets: install libsecret-tools (Debian, Ubuntu) or libsecret");
    }
    throw e;
  }
}

/**
 * The item's secret, exactly. `secret-tool lookup` when its attributes find
 * only this item; otherwise `search --all`, picking it by object path. Both
 * unlock the keyring first if needed (the keyring shows its prompt).
 */
export async function readSecret(item: SecretItem, all: SecretItem[]): Promise<string> {
  const attrs = attributeArgs(item.attributes);
  if (!attrs.length) {
    throw new Error("This item has no attributes, so secret-tool can't find it: open it in Seahorse or KWalletManager");
  }
  if (lookupIsUnique(item, all)) {
    const secret = await secretTool(["lookup", ...attrs]);
    if (secret) return secret;
  }
  const found = parseSearch(await secretTool(["search", "--all", "--unlock", ...attrs]));
  const mine = found.find((r) => r.path === item.path);
  if (mine?.secret === undefined) {
    throw new Error(found.length ? "The keyring didn't give this secret: is it still locked?" : "Item not found");
  }
  return mine.secret;
}

// ---------------------------------------------------------------------------
// Keyring managers

/** Opens Seahorse (GNOME) or KWalletManager (KDE), whichever suits the keyring and is installed. */
export function openManager(collectionPath: string): string {
  const kde = /kdewallet|kwallet/i.test(collectionPath);
  const programs = kde
    ? ["kwalletmanager5", "kwalletmanager", "seahorse"]
    : ["seahorse", "kwalletmanager5", "kwalletmanager"];
  for (const program of programs) {
    try {
      new Deno.Command(program, { stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
      return program === "seahorse" ? "Passwords and Keys" : "KWalletManager";
    } catch (e) {
      if (!notFound(e)) throw e;
    }
  }
  throw new Error("Neither Seahorse (Passwords and Keys) nor KWalletManager is installed");
}
