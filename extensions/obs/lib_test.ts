import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { audioInputs, ObsClient, type SocketLike, status } from "./api.ts";
import {
  audioKind,
  AuthError,
  authString,
  checkedUrl,
  closeMessage,
  decodeDataUrl,
  dropped,
  formatBytes,
  formatDb,
  formatDuration,
  identify,
  isAllowedHost,
  kindLabel,
  normalizeUrl,
  parseDb,
  parseOutput,
  parseScenes,
  parseSpecial,
  requestMessage,
  screenshotName,
  statusLine,
  tilde,
} from "./lib.ts";
import { faderPosition } from "./ui.ts";

// The example of obs-websocket's protocol documentation.
const PASSWORD = "supersecretpassword";
const SALT = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=";
const CHALLENGE = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=";
const EXPECTED_AUTH = "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=";

Deno.test("authentication string: base64(sha256(base64(sha256(password + salt)) + challenge))", async () => {
  assertEquals(await authString(PASSWORD, SALT, CHALLENGE), EXPECTED_AUTH);
});

Deno.test("Identify: with and without authentication", async () => {
  assertEquals(await identify({ rpcVersion: 1 }, ""), { op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } });
  const withAuth = await identify({ rpcVersion: 1, authentication: { salt: SALT, challenge: CHALLENGE } }, PASSWORD);
  assertEquals(withAuth.d.authentication, EXPECTED_AUTH);
  await assertRejects(
    () => identify({ rpcVersion: 1, authentication: { salt: SALT, challenge: CHALLENGE } }, ""),
    AuthError,
    "OBS asks for a password",
  );
});

/** Plays OBS: Hello, then answers Identify and requests with `answer`. */
class FakeObs implements SocketLike {
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  sent: { op: number; d: Record<string, unknown> }[] = [];

  constructor(
    private hello: Record<string, unknown> | "refuse",
    private answer: (msg: { op: number; d: Record<string, any> }) => unknown,
  ) {
    setTimeout(() => {
      if (hello === "refuse") {
        this.onerror?.(new Event("error"));
        this.onclose?.({ code: 1006, reason: "" } as CloseEvent);
        return;
      }
      this.onopen?.(new Event("open"));
      this.emit({ op: 0, d: this.hello });
    }, 0);
  }

  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }

  send(data: string) {
    const msg = JSON.parse(data);
    this.sent.push(msg);
    setTimeout(() => {
      const reply = this.answer(msg);
      if (reply === "close-4009") this.onclose?.({ code: 4009, reason: "Authentication failed." } as CloseEvent);
      else if (reply) this.emit(reply);
    }, 0);
  }

  close() {
    setTimeout(() => this.onclose?.({ code: 1000, reason: "" } as CloseEvent), 0);
  }
}

const HELLO_AUTH = {
  obsWebSocketVersion: "5.5.2",
  rpcVersion: 1,
  authentication: { challenge: CHALLENGE, salt: SALT },
};

function obsServer(responses: Record<string, unknown>, failures: Record<string, number> = {}) {
  return (msg: { op: number; d: Record<string, any> }) => {
    if (msg.op === 1) {
      return msg.d.authentication === EXPECTED_AUTH ? { op: 2, d: { negotiatedRpcVersion: 1 } } : "close-4009";
    }
    const one = (requestType: string, requestData?: Record<string, unknown>) => {
      const key = requestData?.inputName ? `${requestType}:${requestData.inputName}` : requestType;
      const code = failures[key];
      return code
        ? { requestType, requestStatus: { result: false, code, comment: "nope" } }
        : { requestType, requestStatus: { result: true, code: 100 }, responseData: responses[key] ?? {} };
    };
    if (msg.op === 6) {
      return { op: 7, d: { requestId: msg.d.requestId, ...one(msg.d.requestType, msg.d.requestData) } };
    }
    if (msg.op === 8) {
      return {
        op: 9,
        d: {
          requestId: msg.d.requestId,
          results: msg.d.requests.map((r: Record<string, any>) => one(r.requestType, r.requestData)),
        },
      };
    }
  };
}

Deno.test("client: handshake with the password, then a request", async () => {
  let fake!: FakeObs;
  const client = await ObsClient.connect("ws://localhost:4455", PASSWORD, {
    factory: () => (fake = new FakeObs(HELLO_AUTH, obsServer({ GetVersion: { obsVersion: "30.2.3" } }))),
  });
  assertEquals(fake.sent[0], { op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, authentication: EXPECTED_AUTH } });
  const v = await client.request("GetVersion");
  assertEquals(v.obsVersion, "30.2.3");
  assertEquals(fake.sent[1].op, 6);
  assertEquals(fake.sent[1].d.requestType, "GetVersion");
  client.close();
  assert(client.closed);
});

Deno.test("client: a wrong password is a clear error", async () => {
  await assertRejects(
    () => ObsClient.connect("ws://localhost:4455", "wrong", { factory: () => new FakeObs(HELLO_AUTH, obsServer({})) }),
    AuthError,
    "OBS refused the password",
  );
});

Deno.test("client: OBS not running", async () => {
  await assertRejects(
    () => ObsClient.connect("ws://localhost:4455", "", { factory: () => new FakeObs("refuse", () => undefined) }),
    Error,
    "OBS isn't running",
  );
});

Deno.test("client: failed requests carry OBS's code as a sentence", async () => {
  const client = await ObsClient.connect("ws://localhost:4455", PASSWORD, {
    factory: () => new FakeObs(HELLO_AUTH, obsServer({}, { StopRecord: 501 })),
  });
  await assertRejects(() => client.request("StopRecord"), Error, "OBS isn't recording");
  client.close();
});

const BATCH = {
  GetRecordStatus: {
    outputActive: true,
    outputPaused: false,
    outputTimecode: "00:12:03.250",
    outputDuration: 723250,
    outputBytes: 1288490188,
  },
  GetStreamStatus: {
    outputActive: false,
    outputReconnecting: false,
    outputTimecode: "00:00:00.000",
    outputDuration: 0,
    outputCongestion: 0,
    outputBytes: 0,
    outputSkippedFrames: 0,
    outputTotalFrames: 0,
  },
  GetVirtualCamStatus: { outputActive: true },
  GetSceneList: {
    currentProgramSceneName: "Camera",
    currentPreviewSceneName: null,
    scenes: [
      { sceneIndex: 0, sceneName: "BRB", sceneUuid: "c" },
      { sceneIndex: 1, sceneName: "Screen", sceneUuid: "b" },
      { sceneIndex: 2, sceneName: "Camera", sceneUuid: "a" },
    ],
  },
  GetInputList: {
    inputs: [
      { inputName: "Desktop Audio", inputKind: "pulse_output_capture", unversionedInputKind: "pulse_output_capture" },
      { inputName: "Mic/Aux", inputKind: "pulse_input_capture", unversionedInputKind: "pulse_input_capture" },
      {
        inputName: "Display",
        inputKind: "pipewire-screen-capture-source",
        unversionedInputKind: "pipewire-screen-capture-source",
      },
    ],
  },
  GetStats: {
    cpuUsage: 3.42,
    memoryUsage: 412.5,
    activeFps: 60.0000006,
    renderSkippedFrames: 2,
    renderTotalFrames: 43000,
    availableDiskSpace: 120000,
  },
  GetSpecialInputs: { desktop1: "Desktop Audio", desktop2: null, mic1: "Mic/Aux", mic2: null, mic3: null, mic4: null },
  "GetInputMute:Desktop Audio": { inputMuted: false },
  "GetInputVolume:Desktop Audio": { inputVolumeMul: 0.5, inputVolumeDb: -6.0206 },
  "GetInputMute:Mic/Aux": { inputMuted: true },
  "GetInputVolume:Mic/Aux": { inputVolumeMul: 1, inputVolumeDb: 0 },
};

Deno.test("status and audio inputs in two batches; the replay buffer off in settings is hidden", async () => {
  const client = await ObsClient.connect("ws://localhost:4455", PASSWORD, {
    factory: () =>
      new FakeObs(
        HELLO_AUTH,
        obsServer(BATCH, { GetReplayBufferStatus: 604, "GetInputMute:Display": 604, "GetInputVolume:Display": 604 }),
      ),
  });
  const st = await status(client);
  assertEquals(st.record.active, true);
  assertEquals(st.record.duration, 723250);
  assertEquals(st.stream.active, false);
  assertEquals(st.virtualCam, true);
  assertEquals(st.replayBuffer, undefined);
  assertEquals(st.scenes.map((s) => s.name), ["Camera", "Screen", "BRB"]);
  assertEquals(st.current, "Camera");
  assertEquals(st.stats.fps, 60.0000006);
  const audio = await audioInputs(client, st.inputs);
  assertEquals(audio, [
    { name: "Desktop Audio", kind: "pulse_output_capture", muted: false, db: -6.0206, special: "desktop1" },
    { name: "Mic/Aux", kind: "pulse_input_capture", muted: true, db: 0, special: "mic1" },
  ]);
  assertEquals(statusLine("30.2.3", st.stats), "OBS 30.2.3 · 60 fps · CPU 3.4 %");
  client.close();
});

Deno.test("addresses: normalized, default port, only local hosts", () => {
  assertEquals(normalizeUrl(""), "ws://localhost:4455");
  assertEquals(normalizeUrl("localhost"), "ws://localhost:4455");
  assertEquals(normalizeUrl("192.168.1.20:4444"), "ws://192.168.1.20:4444");
  assertEquals(normalizeUrl("http://studio.lan"), "ws://studio.lan:4455");
  assertEquals(normalizeUrl("wss://obs.tail1234.ts.net:4455/"), "wss://obs.tail1234.ts.net:4455");
  assertEquals(checkedUrl("10.0.0.4"), "ws://10.0.0.4:4455");
  assert(isAllowedHost("100.101.102.103"));
  assert(isAllowedHost("studio.local"));
  assert(!isAllowedHost("obs.example.com"));
  assert(!isAllowedHost("8.8.8.8"));
  let error = "";
  try {
    checkedUrl("obs.example.com");
  } catch (e) {
    error = (e as Error).message;
  }
  assertStringIncludes(error, "not on this computer or your local network");
});

Deno.test("outputs and scenes from raw answers", () => {
  assertEquals(parseOutput({}), {
    active: false,
    paused: undefined,
    reconnecting: undefined,
    duration: 0,
    bytes: 0,
    congestion: undefined,
    skippedFrames: undefined,
    totalFrames: undefined,
  });
  assertEquals(parseOutput(BATCH.GetStreamStatus).congestion, 0);
  assertEquals(parseScenes(null), { scenes: [], current: undefined, preview: undefined });
  assertEquals(parseSpecial(BATCH.GetSpecialInputs), new Map([["Desktop Audio", "desktop1"], ["Mic/Aux", "mic1"]]));
});

Deno.test("audio kinds and labels", () => {
  assertEquals(audioKind("pulse_input_capture"), "mic");
  assertEquals(audioKind("pulse_output_capture"), "desktop");
  assertEquals(audioKind("ffmpeg_source"), "media");
  assertEquals(audioKind("something", "mic2"), "mic");
  assertEquals(audioKind("wasapi_process_output_capture"), "desktop");
  assertEquals(kindLabel("pulse_input_capture"), "Audio input (PulseAudio)");
  assertEquals(kindLabel("pipewire_audio_application_capture"), "Pipewire audio application capture");
});

Deno.test("messages for close codes and failed requests", () => {
  assertStringIncludes(closeMessage(4009), "refused the password");
  assertStringIncludes(closeMessage(4010), "OBS 28");
  assertEquals(closeMessage(1006), "OBS closed the connection");
  assertEquals(requestMessage("StartRecord", 500), "OBS is already recording");
  assertEquals(requestMessage("StopStream", 501), "OBS isn't streaming");
  assertEquals(requestMessage("StartVirtualCam", 500), "Virtual camera is already on");
  assertEquals(requestMessage("SaveReplayBuffer", 501), "Replay buffer is off");
  assertEquals(requestMessage("StartReplayBuffer", 504), "The replay buffer is turned off in OBS's settings");
  assertEquals(requestMessage("PauseRecord", 502), "The recording is already paused");
  assertEquals(requestMessage("SetCurrentProgramScene", 600, "No source was found"), "Not found: No source was found");
  assertEquals(requestMessage("ToggleInputMute", 205, "boom"), "OBS couldn't toggle input mute: boom");
});

Deno.test("formatting", () => {
  assertEquals(formatDuration(723250), "12:03");
  assertEquals(formatDuration(3_729_000), "1:02:09");
  assertEquals(formatBytes(1288490188), "1.2 GB");
  assertEquals(formatBytes(512), "512 B");
  assertEquals(formatDb(-6.0206), "−6.0 dB");
  assertEquals(formatDb(0.01), "0 dB");
  assertEquals(formatDb(-Infinity), "−∞ dB");
  assertEquals(formatDb(undefined), "");
  assertEquals(parseDb(null), -Infinity);
  assertEquals(dropped(0, 100), "");
  assertEquals(dropped(4, 1000), "0.4 %");
  assertEquals(dropped(1, 100000), "<0.1 %");
  assertEquals(tilde("/home/me/Videos/a.mkv", "/home/me"), "~/Videos/a.mkv");
  assertEquals(faderPosition(0), 1);
  assertEquals(faderPosition(-Infinity), 0);
  assert(Math.abs(faderPosition(-6.0206) - Math.cbrt(0.5)) < 1e-4);
});

Deno.test("screenshots: data URLs decoded, names unique per scene and time", () => {
  assertEquals(decodeDataUrl("data:image/jpg;base64,/9j/"), new Uint8Array([0xff, 0xd8, 0xff]));
  assertEquals(decodeDataUrl("nope"), undefined);
  const a = screenshotName("Camera", 1), b = screenshotName("Screen", 1);
  assert(a !== b && a.startsWith("scene-") && a.endsWith(".jpg"));
  assert(screenshotName("Camera", 2) !== a);
});
