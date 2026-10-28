// A small MPD client over TCP (localhost:6600): text commands, and the binary
// chunks of albumart / readpicture.

import { ACK_NO_EXIST, parseAck, quote } from "./lib.ts";

export const HOST = "localhost";
export const PORT = 6600;

export class MpdError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

/** MPD isn't running, or doesn't listen on localhost:6600. */
export class Unreachable extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Mpd {
  private buf = new Uint8Array(0);
  version = "";

  private constructor(private conn: Deno.Conn) {}

  static async connect(password?: string): Promise<Mpd> {
    let conn: Deno.Conn | undefined;
    let error: unknown;
    // IPv4 first: "localhost" may resolve to ::1 while MPD only listens on 127.0.0.1.
    for (const hostname of ["127.0.0.1", HOST]) {
      try {
        conn = await Deno.connect({ hostname, port: PORT });
        break;
      } catch (e) {
        error = e;
      }
    }
    if (!conn) {
      if (error instanceof Deno.errors.ConnectionRefused || error instanceof Deno.errors.NotFound) {
        throw new Unreachable(`MPD isn't running on ${HOST}:${PORT}`);
      }
      throw new Unreachable(`Can't reach MPD on ${HOST}:${PORT}: ${(error as Error).message}`);
    }
    const mpd = new Mpd(conn);
    const hello = await mpd.line();
    if (!hello.startsWith("OK MPD ")) {
      conn.close();
      throw new Unreachable(`Something else listens on ${HOST}:${PORT}`);
    }
    mpd.version = hello.slice(7).trim();
    if (password) await mpd.command(`password ${quote(password)}`);
    return mpd;
  }

  close() {
    try {
      this.conn.close();
    } catch {
      // Already closed.
    }
  }

  private async fill(): Promise<void> {
    const chunk = new Uint8Array(64 * 1024);
    const n = await this.conn.read(chunk);
    if (n === null) throw new MpdError("MPD closed the connection");
    const next = new Uint8Array(this.buf.length + n);
    next.set(this.buf);
    next.set(chunk.subarray(0, n), this.buf.length);
    this.buf = next;
  }

  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) {
        const line = decoder.decode(this.buf.subarray(0, i));
        this.buf = this.buf.subarray(i + 1);
        return line;
      }
      await this.fill();
    }
  }

  private async bytes(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.slice(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  private send(cmd: string) {
    return this.conn.write(encoder.encode(`${cmd}\n`));
  }

  /** Runs a command; returns its "key: value" lines. Throws MpdError on ACK. */
  async command(cmd: string): Promise<string> {
    await this.send(cmd);
    const lines: string[] = [];
    for (;;) {
      const line = await this.line();
      if (line === "OK") return lines.join("\n");
      if (line.startsWith("ACK ")) {
        const ack = parseAck(line);
        throw new MpdError(ack?.message || line, ack?.code);
      }
      lines.push(line);
    }
  }

  /** Several commands at once (command_list_begin … end); one round trip. */
  async commands(cmds: string[]): Promise<void> {
    await this.command(["command_list_begin", ...cmds, "command_list_end"].join("\n"));
  }

  /** A binary answer, read chunk by chunk: `albumart` (cover file) or `readpicture` (embedded). */
  async picture(kind: "albumart" | "readpicture", uri: string, max = 8 * 1024 * 1024): Promise<Uint8Array | undefined> {
    const parts: Uint8Array[] = [];
    let offset = 0;
    let size = Infinity;
    while (offset < size && offset < max) {
      await this.send(`${kind} ${quote(uri)} ${offset}`);
      let binary = -1;
      for (;;) {
        const line = await this.line();
        if (line.startsWith("ACK ")) {
          const ack = parseAck(line);
          if (ack?.code === ACK_NO_EXIST || /unknown command/i.test(ack?.message ?? "")) return undefined;
          throw new MpdError(ack?.message || line, ack?.code);
        }
        if (line === "OK") break;
        const [k, v] = [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)];
        if (k === "size") size = Number(v);
        if (k === "binary") {
          binary = Number(v);
          const data = await this.bytes(binary);
          parts.push(data);
          offset += data.length;
          await this.bytes(1); // the newline after the data
        }
      }
      // readpicture answers nothing at all when there is no picture.
      if (binary <= 0) break;
    }
    if (!parts.length) return undefined;
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** Connects, runs `fn`, closes. */
export async function withMpd<T>(password: string | undefined, fn: (mpd: Mpd) => Promise<T>): Promise<T> {
  const mpd = await Mpd.connect(password);
  try {
    return await fn(mpd);
  } finally {
    mpd.close();
  }
}
