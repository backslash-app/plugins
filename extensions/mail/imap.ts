// A small IMAP4rev1 client over Deno.connectTls / STARTTLS: sign in, unread
// messages of the inbox, flags, move. Responses are parsed in lib.ts.

import {
  type Account,
  base64Encode,
  capabilities,
  FETCH_ITEMS,
  type Folder,
  Framer,
  isLoopback,
  type Message,
  parseFetch,
  parseFolders,
  parseMessage,
  parseStatus,
  quote,
  searchUids,
  specialFolder,
  type Status,
  uidSet,
} from "./lib.ts";

/** What the client reads and writes: a TCP or TLS connection, or a recorded transcript in tests. */
export interface Transport {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}

export class ImapError extends Error {
  constructor(message: string, readonly kind: "auth" | "network" | "protocol" = "protocol") {
    super(message);
  }
}

export interface Reply {
  lines: string[];
  status: Status;
}

/** A command argument sent as a literal (`{5}` then the bytes). */
export interface Literal {
  literal: string;
}

export class Client {
  #framer = new Framer();
  #tag = 0;
  caps = new Set<string>();

  constructor(private conn: Transport) {}

  close() {
    try {
      this.conn.close();
    } catch {
      // Already closed.
    }
  }

  /** Swaps the connection, after STARTTLS. */
  upgrade(conn: Transport) {
    this.conn = conn;
    this.#framer = new Framer();
  }

  async #next(): Promise<string> {
    const buf = new Uint8Array(16 * 1024);
    while (true) {
      const line = this.#framer.next();
      if (line !== undefined) return line;
      let n: number | null;
      try {
        n = await this.conn.read(buf);
      } catch (e) {
        throw new ImapError(`Connection lost: ${e instanceof Error ? e.message : e}`, "network");
      }
      if (n === null) throw new ImapError("The server closed the connection", "network");
      this.#framer.push(buf.subarray(0, n));
    }
  }

  async #write(text: string) {
    const bytes = new TextEncoder().encode(text);
    let done = 0;
    while (done < bytes.length) done += await this.conn.write(bytes.subarray(done));
  }

  /** Reads the server's greeting. */
  async greeting(): Promise<Status> {
    const line = await this.#next();
    const status = parseStatus(line);
    if (!status || status.tag !== "*" || (status.status !== "OK" && status.status !== "PREAUTH")) {
      throw new ImapError(`The server refused the connection: ${status?.text || line.slice(0, 120)}`, "network");
    }
    this.caps = capabilities([line]);
    return status;
  }

  /**
   * Sends a command and collects the untagged responses until its tagged
   * answer. NO and BAD throw, unless `allowNo`. `onContinue` answers `+`
   * requests (AUTHENTICATE).
   */
  async command(
    parts: string | (string | Literal)[],
    o: { allowNo?: boolean; onContinue?: (text: string) => string } = {},
  ): Promise<Reply> {
    const tag = `A${++this.#tag}`;
    const list = typeof parts === "string" ? [parts] : parts;
    let pending = `${tag} `;
    const lines: string[] = [];
    // Synchronizing literals: send up to each one, wait for "+", then go on.
    for (const part of list) {
      if (typeof part === "string") {
        pending += part;
        continue;
      }
      const bytes = new TextEncoder().encode(part.literal).length;
      const plus = this.caps.has("LITERAL+") || this.caps.has("LITERAL-");
      await this.#write(`${pending}{${bytes}${plus ? "+" : ""}}\r\n`);
      if (!plus) {
        while (true) {
          const line = await this.#next();
          if (line.startsWith("+")) break;
          const status = parseStatus(line);
          if (status?.tag === tag) throw new ImapError(status.text || `${status.status}`, "protocol");
          lines.push(line);
        }
      }
      pending = part.literal;
    }
    await this.#write(`${pending}\r\n`);
    while (true) {
      const line = await this.#next();
      if (line.startsWith("+")) {
        await this.#write(`${o.onContinue ? o.onContinue(line.slice(1).trim()) : "*"}\r\n`);
        continue;
      }
      const status = parseStatus(line);
      if (status?.tag === tag) {
        if (status.status !== "OK" && !o.allowNo) {
          throw new ImapError(status.text || `The server answered ${status.status}`);
        }
        for (const c of capabilities([line])) this.caps.add(c);
        return { lines, status };
      }
      if (status?.tag === "*" && status.status === "BYE" && !/^LOGOUT$/i.test(String(list[0]))) {
        throw new ImapError(status.text || "The server closed the session", "network");
      }
      lines.push(line);
    }
  }

  async capability(): Promise<Set<string>> {
    const reply = await this.command("CAPABILITY");
    this.caps = capabilities(reply.lines);
    return this.caps;
  }

  /** AUTHENTICATE PLAIN when offered (any character works), LOGIN otherwise. */
  async login(user: string, password: string): Promise<void> {
    if (!this.caps.has("IMAP4REV1") && !this.caps.has("IMAP4REV2")) await this.capability();
    let reply: Reply;
    if (this.caps.has("AUTH=PLAIN")) {
      const token = base64Encode(`\0${user}\0${password}`);
      reply = this.caps.has("SASL-IR")
        ? await this.command(`AUTHENTICATE PLAIN ${token}`, { allowNo: true })
        : await this.command("AUTHENTICATE PLAIN", { allowNo: true, onContinue: () => token });
    } else if (!this.caps.has("LOGINDISABLED")) {
      const arg = (s: string): (string | Literal)[] => {
        const q = quote(s);
        return q ? [q] : [{ literal: s }, ""];
      };
      reply = await this.command(["LOGIN ", ...arg(user), " ", ...arg(password)], { allowNo: true });
    } else {
      throw new ImapError("The server accepts no password sign-in on this connection", "auth");
    }
    if (reply.status.status !== "OK") {
      throw new ImapError(reply.status.text || "Wrong address or password", "auth");
    }
    // Capabilities often change after signing in.
    const after = capabilities([...reply.lines, `* OK [${reply.status.code ?? ""}]`]);
    if (after.size) this.caps = after;
    else await this.capability();
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } catch {
      // Closing anyway.
    }
  }

  /** The newest unread messages of the inbox (read-only), and how many there are. */
  async unread(limit = 30): Promise<{ total: number; messages: Message[] }> {
    await this.command("EXAMINE INBOX");
    const uids = searchUids((await this.command("UID SEARCH UNSEEN")).lines).sort((a, b) => b - a);
    const newest = uids.slice(0, limit);
    if (!newest.length) return { total: 0, messages: [] };
    const reply = await this.command(`UID FETCH ${uidSet(newest)} ${FETCH_ITEMS}`);
    const messages = reply.lines
      .map(parseFetch)
      .map((f) => (f ? parseMessage(f) : undefined))
      .filter((m): m is Message => !!m && !m.flags.some((f) => f.toLowerCase() === "\\seen"))
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || b.uid - a.uid);
    return { total: uids.length, messages };
  }

  async folders(): Promise<Folder[]> {
    return parseFolders((await this.command('LIST "" "*"')).lines);
  }

  async markRead(uids: number[], read = true): Promise<void> {
    if (!uids.length) return;
    await this.command("SELECT INBOX");
    await this.command(`UID STORE ${uidSet(uids)} ${read ? "+" : "-"}FLAGS.SILENT (\\Seen)`);
  }

  /** Moves to the archive or trash; deleting with no trash folder expunges. */
  async moveTo(uids: number[], use: "archive" | "trash"): Promise<string | undefined> {
    if (!uids.length) return undefined;
    const target = specialFolder(await this.folders(), use);
    if (!target && use === "archive") throw new ImapError("This account has no Archive folder");
    await this.command("SELECT INBOX");
    const set = uidSet(uids);
    if (target) {
      const name = quote(target);
      const arg: (string | Literal)[] = name ? [name] : [{ literal: target }, ""];
      if (this.caps.has("MOVE")) {
        await this.command([`UID MOVE ${set} `, ...arg]);
        return target;
      }
      await this.command([`UID COPY ${set} `, ...arg]);
    }
    await this.command(`UID STORE ${set} +FLAGS.SILENT (\\Deleted)`);
    await this.command(this.caps.has("UIDPLUS") ? `UID EXPUNGE ${set}` : "EXPUNGE");
    return target;
  }
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The certificate Proton Mail Bridge signs its local IMAP with (Bridge → Settings → Export TLS certificates). */
async function bridgeCertificate(): Promise<string[] | undefined> {
  let home = "";
  try {
    home = Deno.env.get("HOME") ?? "";
  } catch {
    return undefined;
  }
  for (const dir of ["bridge-v3", "bridge"]) {
    try {
      return [await Deno.readTextFile(`${home}/.config/protonmail/${dir}/cert.pem`)];
    } catch {
      // Next one.
    }
  }
  return undefined;
}

/** Connects and signs in. */
export async function connect(a: Account): Promise<Client> {
  let conn: Deno.Conn;
  try {
    conn = a.security === "tls"
      ? await Deno.connectTls({ hostname: a.host, port: a.port })
      : await Deno.connect({ hostname: a.host, port: a.port });
  } catch (e) {
    if (e instanceof Deno.errors.ConnectionRefused && a.preset.id === "proton") {
      throw new ImapError("Proton Mail Bridge isn't running: start it, then try again", "network");
    }
    throw new ImapError(`Can't reach ${a.host}:${a.port}: ${describe(e)}`, "network");
  }
  const client = new Client(conn);
  try {
    await client.greeting().catch((e) => {
      if (a.security === "tls" && /corrupt message|InvalidContentType|handshake/i.test(String(e))) {
        throw new ImapError(
          `${a.host}:${a.port} doesn't use TLS: for STARTTLS write the server as imap://${a.host}:${a.port}`,
          "network",
        );
      }
      throw e;
    });
    if (a.security === "starttls") {
      if (!client.caps.size) await client.capability();
      if (client.caps.has("STARTTLS")) {
        await client.command("STARTTLS");
        const caCerts = a.preset.id === "proton" || isLoopback(a.host) ? await bridgeCertificate() : undefined;
        try {
          const tls = await Deno.startTls(conn as Deno.TcpConn, { hostname: a.host, caCerts });
          client.upgrade(tls);
          conn = tls;
        } catch (e) {
          throw new ImapError(
            a.preset.id === "proton"
              ? "Proton Mail Bridge's certificate isn't trusted: in Bridge, Settings → Export TLS certificates into ~/.config/protonmail/bridge-v3"
              : `Secure connection failed: ${describe(e)}`,
            "network",
          );
        }
        await client.capability();
      } else if (!isLoopback(a.host)) {
        throw new ImapError(`${a.host} doesn't offer STARTTLS: the password would travel in clear`, "network");
      }
    }
    await client.login(a.email, a.password);
    return client;
  } catch (e) {
    conn.close();
    throw e;
  }
}

/** Runs `fn` signed in, then signs out; the whole session times out. */
export async function session<T>(a: Account, fn: (c: Client) => Promise<T>, timeoutMs = 25_000): Promise<T> {
  let client: Client | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    client = await connect(a);
    const out = await fn(client);
    await client.logout();
    return out;
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImapError(`${a.host} didn't answer in time`, "network")), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    client?.close();
    // A connection still being opened is closed once it is.
    work.catch(() => {}).finally(() => client?.close());
  }
}
