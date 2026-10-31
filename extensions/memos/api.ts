// Memos' API v1 (Bearer access token) and Trilium's ETAPI (the token as the
// Authorization header).

import { storage } from "@backslash/api";
import {
  apiError,
  fromMemo,
  fromTrilium,
  isAllowedHost,
  isMine,
  isUserNote,
  type Memo,
  normalizeUrl,
  type Note,
  noteTitle,
  parentChoice,
  type Service,
  SERVICE_NAMES,
  SetupError,
  textToHtml,
  type TriliumNote,
  triliumQuery,
  userName,
} from "./lib.ts";

export interface Server {
  service: Service;
  base: string;
  token: string;
}

function checkHost(base: string, service: Service) {
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${base}” is not an address`, service);
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, service);
}

/** The servers the preferences set up; a SetupError when there is none. */
export function servers(prefs: Record<string, unknown>): Server[] {
  const out: Server[] = [];
  for (const service of ["memos", "trilium"] as const) {
    const base = normalizeUrl(prefs[`${service}Url`]);
    const token = String(prefs[`${service}Token`] ?? "").trim().replace(/^Bearer\s+/i, "");
    if (!base && !token) continue;
    if (!base) throw new SetupError(`Add the address of your ${SERVICE_NAMES[service]}`, service);
    checkHost(base, service);
    if (!token) throw new SetupError(`Add a ${SERVICE_NAMES[service]} token`, service, base);
    out.push({ service, base, token });
  }
  if (!out.length) throw new SetupError("Connect Memos or Trilium");
  return out;
}

async function request<T>(
  s: Server,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; text?: boolean } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const headers: Record<string, string> = {
    Accept: o.text ? "text/html, text/plain, */*" : "application/json",
    Authorization: s.service === "memos" ? `Bearer ${s.token}` : s.token,
  };
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: o.method ?? "GET",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).hostname} is outside the networks this extension may reach`, s.service);
    }
    throw new SetupError(
      `Can't reach ${SERVICE_NAMES[s.service]} at ${new URL(s.base).host}: ${(e as Error).message}`,
      s.service,
      s.base,
    );
  }
  const text = await res.text();
  if (o.text && res.ok) return text as T;
  if (res.ok && /^\s*</.test(text)) {
    throw new SetupError(
      `${s.base} answers, but not as ${SERVICE_NAMES[s.service]}: check the address`,
      s.service,
      s.base,
    );
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw apiError(s.service, res.status, json);
  return json as T;
}

/** Each server's result, or its error: one down doesn't hide the other. */
export async function each<T>(
  list: Server[],
  load: (s: Server) => Promise<T>,
): Promise<{ ok: { server: Server; value: T }[]; errors: { server: Server; error: Error }[] }> {
  const settled = await Promise.allSettled(list.map(load));
  const ok: { server: Server; value: T }[] = [];
  const errors: { server: Server; error: Error }[] = [];
  settled.forEach((r, i) =>
    r.status === "fulfilled"
      ? ok.push({ server: list[i], value: r.value })
      : errors.push({ server: list[i], error: r.reason })
  );
  return { ok, errors };
}

// ---------------------------------------------------------------------------
// Memos

/** Who you are, to leave out other people's public memos. The endpoint moved between versions. */
async function memosMe(s: Server, signal?: AbortSignal): Promise<string | undefined> {
  const key = `memos:me:${s.base}`;
  const saved = await storage.get<string>(key).catch(() => undefined);
  if (saved) return saved;
  const attempts: [string, string][] = [
    ["GET", "/api/v1/auth/me"],
    ["GET", "/api/v1/auth/sessions/current"],
    ["POST", "/api/v1/auth/status"],
  ];
  for (const [method, path] of attempts) {
    const name = await request<unknown>(s, path, { method, signal }).then(userName, () => undefined);
    if (name) {
      await storage.set(key, name).catch(() => {});
      return name;
    }
  }
  return undefined;
}

export async function memos(s: Server, signal?: AbortSignal): Promise<Note[]> {
  const [me, first] = await Promise.all([
    memosMe(s, signal),
    request<{ memos: Memo[]; nextPageToken?: string }>(s, "/api/v1/memos?pageSize=200", { signal }),
  ]);
  const list = [...first.memos];
  let token = first.nextPageToken;
  for (let i = 0; token && i < 4; i++) {
    const r = await request<{ memos: Memo[]; nextPageToken?: string }>(
      s,
      `/api/v1/memos?pageSize=200&pageToken=${encodeURIComponent(token)}`,
      { signal },
    );
    list.push(...r.memos);
    token = r.nextPageToken;
  }
  return list.filter((m) => isMine(m, me)).map((m) => fromMemo(m, s.base));
}

export async function createMemo(s: Server, content: string, visibility: string): Promise<Note> {
  const m = await request<Memo>(s, "/api/v1/memos", { method: "POST", body: { content, visibility } });
  return fromMemo(m, s.base);
}

// ---------------------------------------------------------------------------
// Trilium

export async function triliumSearch(s: Server, query: string, signal?: AbortSignal): Promise<Note[]> {
  const q = triliumQuery(query);
  const params = new URLSearchParams({ search: q.search, orderBy: q.orderBy, orderDirection: "desc", limit: "40" });
  const { results } = await request<{ results: TriliumNote[] }>(s, `/etapi/notes?${params}`, { signal });
  const notes = results.filter(isUserNote);
  // The preview needs each note's content: the first ones, a few at a time.
  const bodies = new Map<string, string>();
  const wanted = notes.filter((n) => !n.isProtected && (n.type === "text" || n.type === "code")).slice(0, 20);
  for (let i = 0; i < wanted.length; i += 6) {
    await Promise.all(
      wanted.slice(i, i + 6).map(async (n) => {
        const html = await request<string>(s, `/etapi/notes/${n.noteId}/content`, { signal, text: true }).catch(() =>
          undefined
        );
        if (html !== undefined) bodies.set(n.noteId, html);
      }),
    );
  }
  return notes.map((n) => fromTrilium(n, s.base, bodies.get(n.noteId)));
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function createTriliumNote(s: Server, text: string, parentPref: unknown): Promise<Note> {
  const parent = parentChoice(parentPref);
  let parentNoteId: string;
  if (parent.kind === "note") parentNoteId = parent.id;
  else {
    const path = parent.kind === "inbox" ? `/etapi/inbox/${today()}` : `/etapi/calendar/days/${today()}`;
    parentNoteId = (await request<TriliumNote>(s, path)).noteId;
  }
  const r = await request<{ note: TriliumNote }>(s, "/etapi/create-note", {
    method: "POST",
    body: { parentNoteId, title: noteTitle(text), type: "text", content: textToHtml(text) },
  });
  return fromTrilium(r.note, s.base, textToHtml(text));
}

// ---------------------------------------------------------------------------
// Pin, delete

export async function setPinned(s: Server, n: Note, pinned: boolean): Promise<void> {
  if (s.service === "memos") {
    await request(s, `/api/v1/${n.id}?updateMask=pinned`, { method: "PATCH", body: { name: n.id, pinned } });
    return;
  }
  // Trilium's bookmarks are the #bookmarked label (the bookmark bar of the launcher).
  if (pinned) {
    await request(s, "/etapi/attributes", {
      method: "POST",
      body: { noteId: n.id, type: "label", name: "bookmarked", value: "" },
    });
  } else if (n.bookmarkAttributeId) {
    await request(s, `/etapi/attributes/${n.bookmarkAttributeId}`, { method: "DELETE" });
  }
}

export async function remove(s: Server, n: Note): Promise<void> {
  await request(s, s.service === "memos" ? `/api/v1/${n.id}` : `/etapi/notes/${n.id}`, { method: "DELETE" });
}

/** Where a capture goes: the preference, else Memos when it is set up. */
export function captureServer(list: Server[], pref: unknown): Server {
  const want = String(pref ?? "").trim().toLowerCase();
  return list.find((s) => s.service === want) ?? list.find((s) => s.service === "memos") ?? list[0];
}

export async function capture(s: Server, text: string, prefs: Record<string, unknown>): Promise<Note> {
  return s.service === "memos"
    ? await createMemo(s, text, prefs.memosVisibility === true ? "PUBLIC" : "PRIVATE")
    : await createTriliumNote(s, text, prefs.triliumParent);
}
