// Test Start: launch a stdio server (or call a local HTTP one), do the MCP handshake, list its tools, stop it.

import {
  initializedNotification,
  initializeRequest,
  type InitInfo,
  isLocalUrl,
  listRequest,
  parseLines,
  parseSse,
  readInit,
  readTools,
  runner,
  RUNNERS,
  type Server,
  type Tool,
} from "./lib.ts";

export interface Probe {
  ok: boolean;
  ms: number;
  info?: InitInfo;
  tools: Tool[];
  prompts?: number;
  resources?: number;
  error?: string;
  /** The end of what the server wrote on stderr. */
  stderr: string;
}

type Message = { id?: number; result?: unknown; error?: { message?: string; code?: number } };

/** First-run downloads (npx, uvx, docker pull) can take a while. */
const TIMEOUT = 45_000;

/** `p`, or `undefined` after `ms`, without leaving a timer behind. */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => timer = setTimeout(() => resolve(undefined), ms));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

function rpcError(m: Message): string {
  return `${m.error?.message ?? "Error"}${m.error?.code !== undefined ? ` (${m.error.code})` : ""}`;
}

/** Talks to a server through `send`/`receive` until it has the server's info and tools. */
async function handshake(
  call: (msg: object, id?: number) => Promise<Message | undefined>,
  out: Probe,
): Promise<void> {
  const init = await call(initializeRequest(1), 1);
  if (!init) throw new Error("No answer to initialize");
  if (init.error) throw new Error(`initialize failed: ${rpcError(init)}`);
  out.info = readInit(init.result);
  await call(initializedNotification);
  let id = 2;
  if (out.info.capabilities.includes("tools")) {
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await call(listRequest(id, "tools", cursor), id++);
      if (!res || res.error) break;
      const { tools, next } = readTools(res.result);
      out.tools.push(...tools);
      if (!next) break;
      cursor = next;
    }
  }
  for (const what of ["prompts", "resources"] as const) {
    if (!out.info.capabilities.includes(what)) continue;
    const res = await call(listRequest(id, what), id++);
    if (res && !res.error) out[what] = readTools(res.result).tools.length;
  }
  out.ok = true;
}

export async function probeStdio(s: Server, signal?: AbortSignal): Promise<Probe> {
  const started = performance.now();
  const out: Probe = { ok: false, ms: 0, tools: [], stderr: "" };
  if (!RUNNERS.includes(runner(s.command))) {
    out.error = `Test Start runs ${RUNNERS.join(", ")}; run this one in a terminal instead`;
    return out;
  }
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(s.command!, {
      args: s.args,
      env: s.env,
      cwd: s.cwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (e) {
    out.error = e instanceof Deno.errors.NotFound
      ? `${s.command} is not installed (or not in the PATH Backslash sees)`
      : (e as Error).message;
    return out;
  }

  const writer = child.stdin.getWriter();
  const encoder = new TextEncoder();
  const waiting = new Map<number, (m: Message) => void>();
  let exited = false;
  let buffer = "";

  // stdout: newline-delimited JSON-RPC.
  const reading = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      const cut = buffer.lastIndexOf("\n");
      if (cut === -1) continue;
      for (const m of parseLines(buffer.slice(0, cut)) as Message[]) {
        if (typeof m.id === "number") waiting.get(m.id)?.(m);
      }
      buffer = buffer.slice(cut + 1);
    }
  })().catch(() => {});
  const errors = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) out.stderr = (out.stderr + decoder.decode(chunk)).slice(-4000);
  })().catch(() => {});
  const status = child.status.then((st) => {
    exited = true;
    return st;
  });

  const call = async (msg: object, id?: number): Promise<Message | undefined> => {
    if (exited) throw new Error("The server exited");
    await writer.write(encoder.encode(JSON.stringify(msg) + "\n"));
    if (id === undefined) return undefined;
    return await new Promise<Message | undefined>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No answer within ${TIMEOUT / 1000} s`)), TIMEOUT);
      const stop = () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      };
      signal?.addEventListener("abort", stop, { once: true });
      waiting.set(id, (m) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        resolve(m);
      });
      status.then((st) => {
        clearTimeout(timer);
        reject(new Error(`The server exited with code ${st.code}`));
      });
    });
  };

  try {
    await handshake(call, out);
  } catch (e) {
    out.error = (e as Error).message;
  } finally {
    // Closing stdin asks the server to stop; then SIGTERM, then SIGKILL.
    await writer.close().catch(() => {});
    const stopped = await within(status.then(() => true), 1500);
    if (!stopped) {
      try {
        child.kill("SIGTERM");
      } catch { /* already gone */ }
      const gone = await within(status.then(() => true), 2000);
      if (!gone) {
        try {
          child.kill("SIGKILL");
        } catch { /* already gone */ }
      }
    }
    await within(Promise.all([reading, errors]), 500);
  }
  out.ms = Math.round(performance.now() - started);
  return out;
}

/** Streamable HTTP on localhost: POST JSON-RPC, read a JSON or an event-stream answer. */
export async function probeHttp(s: Server, signal?: AbortSignal): Promise<Probe> {
  const started = performance.now();
  const out: Probe = { ok: false, ms: 0, tools: [], stderr: "" };
  if (!isLocalUrl(s.url)) {
    out.error = "Only servers on localhost or 127.0.0.1 can be tested from here";
    return out;
  }
  if (s.transport === "sse") {
    out.error = "Testing the older SSE transport isn't supported; connect a client to it instead";
    return out;
  }
  let session: string | undefined;
  const call = async (msg: object, id?: number): Promise<Message | undefined> => {
    const res = await fetch(s.url!, {
      method: "POST",
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      headers: {
        ...s.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify(msg),
    });
    session = res.headers.get("mcp-session-id") ?? session;
    if (res.status === 401) throw new Error("The server wants a sign-in (401): test it from a client");
    if (!res.ok && res.status !== 202) throw new Error(`The server answered ${res.status} ${res.statusText}`);
    const body = await res.text();
    if (id === undefined) return undefined;
    const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? parseSse(body)
      : parseLines(body);
    return (messages as Message[]).find((m) => m.id === id);
  };
  try {
    await handshake(call, out);
  } catch (e) {
    out.error = (e as Error).name === "TimeoutError" ? "No answer within 15 s" : (e as Error).message;
  }
  out.ms = Math.round(performance.now() - started);
  return out;
}

export const probe = (s: Server, signal?: AbortSignal) =>
  s.transport === "stdio" ? probeStdio(s, signal) : probeHttp(s, signal);
