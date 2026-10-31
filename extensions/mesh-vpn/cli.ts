// Running netbird and zerotier-cli.

import { loginUrl } from "./lib.ts";

export class NotInstalled extends Error {
  constructor(readonly program: string) {
    super(`${program} is not installed`);
  }
}

export interface Output {
  ok: boolean;
  out: string;
  err: string;
}

/** Runs a program; stdout and stderr even on a non-zero exit. */
export async function cli(program: string, args: string[], signal?: AbortSignal): Promise<Output> {
  let result;
  try {
    result = await new Deno.Command(program, { args, stdin: "null", stdout: "piped", stderr: "piped", signal })
      .output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled(program);
    throw e;
  }
  const decode = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  return { ok: result.success, out: decode(result.stdout), err: decode(result.stderr) };
}

/**
 * `netbird up`: done when it exits, or as soon as it prints a sign-in link
 * (it then keeps waiting for the browser, so it is left running).
 */
export async function netbirdUp(timeoutMs = 30_000): Promise<{ ok: boolean; url?: string; output: string }> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("netbird", { args: ["up"], stdin: "null", stdout: "piped", stderr: "piped" }).spawn();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled("netbird");
    throw e;
  }
  let output = "";
  let found: (url: string) => void = () => {};
  const urlSeen = new Promise<string>((resolve) => found = resolve);
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output += decoder.decode(chunk, { stream: true });
      const url = loginUrl(output);
      if (url) found(url);
    }
  };
  const pumps = Promise.all([pump(child.stdout), pump(child.stderr)]).catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => timer = setTimeout(() => resolve("timeout"), timeoutMs));
  const outcome = await Promise.race([
    child.status.then(async (s) => {
      await pumps;
      return s;
    }),
    urlSeen,
    timeout,
  ]);
  clearTimeout(timer);
  if (typeof outcome === "string") {
    if (outcome === "timeout") {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      return { ok: false, output: output || "netbird up took too long" };
    }
    child.unref();
    return { ok: false, url: outcome, output };
  }
  return { ok: outcome.success, url: loginUrl(output), output: output.trim() };
}
