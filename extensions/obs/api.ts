// A small obs-websocket v5 client: Hello → Identify (with the SHA-256
// authentication) → Identified, then requests and request batches matched by
// their requestId. The socket is injectable so lib_test.ts can play OBS.

import {
  AuthError,
  closeMessage,
  type Hello,
  identify,
  NOT_RUNNING,
  OP,
  parseDb,
  parseOutput,
  parseScenes,
  parseSpecial,
  parseStats,
  RequestError,
  type Status,
} from "./lib.ts";

/** What the client needs from a WebSocket. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const realSocket: SocketFactory = (url) => new WebSocket(url, "obswebsocket.json") as unknown as SocketLike;

// deno-lint-ignore no-explicit-any
type Data = Record<string, any>;

export interface BatchResult {
  requestType: string;
  ok: boolean;
  code: number;
  comment?: string;
  data: Data;
}

interface Pending {
  resolve: (d: Data) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ObsClient {
  version?: string;
  #socket: SocketLike;
  #pending = new Map<string, Pending>();
  #next = 0;
  #closed?: Error;
  #timeout: number;
  /** Called once when the connection ends. */
  onclose?: () => void;

  private constructor(socket: SocketLike, timeout: number) {
    this.#socket = socket;
    this.#timeout = timeout;
  }

  get closed(): boolean {
    return !!this.#closed;
  }

  /** Connects and identifies; throws a sentence when OBS is off or refuses the password. */
  static connect(
    url: string,
    password: string,
    options: { factory?: SocketFactory; timeout?: number } = {},
  ): Promise<ObsClient> {
    const timeout = options.timeout ?? 5000;
    return new Promise((resolve, reject) => {
      let socket: SocketLike;
      try {
        socket = (options.factory ?? realSocket)(url);
      } catch (e) {
        reject(new Error(`Can't connect to ${url}: ${(e as Error).message}`));
        return;
      }
      const client = new ObsClient(socket, timeout);
      let identified = false;
      let opened = false;
      const fail = (e: Error) => {
        clearTimeout(timer);
        if (!identified) reject(e);
      };
      const timer = setTimeout(() => {
        fail(new Error(opened ? "OBS didn't answer: is it busy or frozen?" : NOT_RUNNING));
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      }, timeout);
      socket.onopen = () => {
        opened = true;
      };
      socket.onerror = () => {
        // A close event always follows with the reason.
      };
      socket.onclose = (ev) => {
        const error = opened || ev.code >= 4000
          ? (ev.code === 4009 ? new AuthError(closeMessage(4009)) : new Error(closeMessage(ev.code, ev.reason)))
          : new Error(NOT_RUNNING);
        client.#end(error);
        fail(error);
      };
      socket.onmessage = async (ev) => {
        let msg: { op: number; d: Data };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.op === OP.Hello) {
          try {
            socket.send(JSON.stringify(await identify(msg.d as Hello, password)));
          } catch (e) {
            fail(e as Error);
            socket.close(1000);
          }
        } else if (msg.op === OP.Identified) {
          identified = true;
          clearTimeout(timer);
          resolve(client);
        } else {
          client.#handle(msg);
        }
      };
    });
  }

  #handle(msg: { op: number; d: Data }): void {
    if (msg.op !== OP.RequestResponse && msg.op !== OP.RequestBatchResponse) return;
    const p = this.#pending.get(msg.d?.requestId);
    if (!p) return;
    this.#pending.delete(msg.d.requestId);
    clearTimeout(p.timer);
    if (msg.op === OP.RequestBatchResponse) {
      p.resolve(msg.d);
      return;
    }
    const st = msg.d.requestStatus ?? {};
    if (st.result) p.resolve(msg.d.responseData ?? {});
    else p.reject(new RequestError(msg.d.requestType, Number(st.code ?? 0), st.comment));
  }

  #end(error: Error): void {
    if (this.#closed) return;
    this.#closed = error;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.#pending.clear();
    this.onclose?.();
  }

  #send(op: number, d: Data, label: string): Promise<Data> {
    if (this.#closed) return Promise.reject(this.#closed);
    const requestId = `bs-${++this.#next}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`OBS didn't answer ${label}`));
      }, this.#timeout);
      this.#pending.set(requestId, { resolve, reject, timer });
      try {
        this.#socket.send(JSON.stringify({ op, d: { ...d, requestId } }));
      } catch (e) {
        this.#pending.delete(requestId);
        clearTimeout(timer);
        reject(e as Error);
      }
    });
  }

  /** One request; resolves with its responseData, rejects with a {@link RequestError}. */
  request(requestType: string, requestData?: Data): Promise<Data> {
    return this.#send(OP.Request, requestData ? { requestType, requestData } : { requestType }, requestType);
  }

  /** Several requests in one round trip; failures don't stop the others. */
  async batch(requests: { requestType: string; requestData?: Data }[]): Promise<BatchResult[]> {
    if (!requests.length) return [];
    const d = await this.#send(OP.RequestBatch, { haltOnFailure: false, executionType: 0, requests }, "the batch");
    const results: Data[] = Array.isArray(d.results) ? d.results : [];
    return requests.map((r, i) => {
      const res = results[i] ?? {};
      return {
        requestType: res.requestType ?? r.requestType,
        ok: !!res.requestStatus?.result,
        code: Number(res.requestStatus?.code ?? 0),
        comment: res.requestStatus?.comment,
        data: res.responseData ?? {},
      };
    });
  }

  close(): void {
    try {
      this.#socket.close(1000);
    } catch {
      // Already closed.
    }
    this.#end(new Error("Disconnected from OBS"));
  }
}

// ---------------------------------------------------------------------------
// What the views ask for

/** Everything the main view shows, in one round trip. */
export async function status(obs: ObsClient): Promise<Status> {
  const [record, stream, vcam, replay, scenes, inputs, stats] = await obs.batch([
    { requestType: "GetRecordStatus" },
    { requestType: "GetStreamStatus" },
    { requestType: "GetVirtualCamStatus" },
    { requestType: "GetReplayBufferStatus" },
    { requestType: "GetSceneList" },
    { requestType: "GetInputList" },
    { requestType: "GetStats" },
  ]);
  const s = parseScenes(scenes.data);
  return {
    record: parseOutput(record.data),
    stream: parseOutput(stream.data),
    virtualCam: vcam.ok ? !!vcam.data.outputActive : undefined,
    replayBuffer: replay.ok ? !!replay.data.outputActive : undefined,
    scenes: s.scenes,
    current: s.current,
    preview: s.preview,
    inputs: (Array.isArray(inputs.data.inputs) ? inputs.data.inputs : [])
      .filter((i: Data) => typeof i?.inputName === "string")
      .map((i: Data) => ({ name: i.inputName, kind: String(i.unversionedInputKind ?? i.inputKind ?? "") })),
    stats: parseStats(stats.data),
  };
}

/** The inputs that carry audio, with their mute state and volume (OBS refuses GetInputMute for the others). */
export async function audioInputs(obs: ObsClient, inputs: { name: string; kind: string }[]) {
  const [special, ...results] = await obs.batch([
    { requestType: "GetSpecialInputs" },
    ...inputs.flatMap((i) => [
      { requestType: "GetInputMute", requestData: { inputName: i.name } },
      { requestType: "GetInputVolume", requestData: { inputName: i.name } },
    ]),
  ]);
  const specials = parseSpecial(special.ok ? special.data : {});
  return inputs.flatMap((input, n) => {
    const mute = results[n * 2], volume = results[n * 2 + 1];
    if (!mute?.ok) return [];
    return [{
      name: input.name,
      kind: input.kind,
      muted: !!mute.data.inputMuted,
      db: volume?.ok ? parseDb(volume.data.inputVolumeDb) : undefined,
      special: specials.get(input.name),
    }];
  });
}
