import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ageSection,
  bytes,
  chooseTranscriber,
  cleanTranscript,
  clock,
  dateOfName,
  errorLine,
  expandHome,
  keywordsOf,
  languageOf,
  noteFileName,
  noteText,
  osFamily,
  pickModel,
  q,
  recordingName,
  recordScript,
  systemdRunArgs,
  tildify,
  titleFrom,
  transcribeScript,
  transcribeUnit,
  uniqueFileName,
  wavDuration,
} from "./lib.ts";

Deno.test("recording names carry the date", () => {
  const d = new Date(2026, 9, 29, 14, 5, 12);
  assertEquals(recordingName(d), "2026-10-29_14-05-12.wav");
  assertEquals(dateOfName("2026-10-29_14-05-12.wav"), d.getTime());
  assertEquals(dateOfName("memo.wav"), undefined);
});

Deno.test("record scripts ask for 16 kHz mono WAV", () => {
  const f = "/home/me/.local/share/backslash/voice-notes/2026-10-29_14-05-12.wav";
  assertEquals(
    recordScript("pw-record", f),
    `mkdir -p /home/me/.local/share/backslash/voice-notes\nexec pw-record --rate 16000 --channels 1 --format s16 ${f}`,
  );
  assertStringIncludes(recordScript("ffmpeg", f), "-f pulse -i default -ac 1 -ar 16000 -c:a pcm_s16le -y");
  assertStringIncludes(
    recordScript("arecord", "/a b/x.wav"),
    "exec arecord -q -f S16_LE -r 16000 -c 1 -t wav '/a b/x.wav'",
  );
  const args = systemdRunArgs("u", "true", { description: "d", killSignal: "SIGINT", env: { A: "1", B: undefined } });
  assertEquals(args, [
    "--user",
    "--quiet",
    "--unit=u",
    "--description=d",
    "--collect",
    "--property=KillSignal=SIGINT",
    "--setenv=A=1",
    "/bin/sh",
    "-c",
    "true",
  ]);
});

function wav(dataBytes: number, declared = dataBytes, extra = 0): { head: Uint8Array; size: number } {
  const head = new Uint8Array(44 + extra);
  const v = new DataView(head.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (head[o + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  let o = 36;
  if (extra) {
    put(o, "LIST");
    v.setUint32(o + 4, extra - 8, true);
    o += extra;
  }
  put(o, "data");
  v.setUint32(o + 4, declared, true);
  return { head, size: o + 8 + dataBytes };
}

Deno.test("WAV duration", () => {
  const a = wav(32000 * 83);
  assertEquals(wavDuration(a.head, a.size), 83);
  // Still recording: the header says 0 or 0xFFFFFFFF.
  const b = wav(32000 * 10, 0);
  assertEquals(wavDuration(b.head, b.size), 10);
  const c = wav(32000 * 5, 0xffffffff, 26);
  assertEquals(wavDuration(c.head, c.size), 5);
  assertEquals(wavDuration(new TextEncoder().encode("not a wav file at all"), 100), undefined);
});

Deno.test("languages and models", () => {
  assertEquals(languageOf(""), "auto");
  assertEquals(languageOf("FR"), "fr");
  assertEquals(languageOf("French"), "fr");
  assertEquals(languageOf("klingon please"), "auto");
  const models = [
    "/m/ggml-tiny.bin",
    "/m/ggml-base.en.bin",
    "/m/ggml-small.bin",
    "/m/ggml-small-encoder.mlmodelc.bin",
    "/m/ggml-silero-v5.1.2.bin",
    "/m/notes.bin",
  ];
  assertEquals(pickModel(models), "/m/ggml-small.bin");
  assertEquals(pickModel(["/m/ggml-base.en.bin", "/m/ggml-tiny.bin"], "fr"), "/m/ggml-tiny.bin");
  assertEquals(pickModel(["/m/ggml-base.en.bin", "/m/ggml-tiny.bin"], "en"), "/m/ggml-base.en.bin");
  assertEquals(pickModel(["/m/ggml-large-v3-turbo-q5_0.bin", "/m/ggml-base.bin"]), "/m/ggml-large-v3-turbo-q5_0.bin");
  assertEquals(pickModel([]), undefined);
});

Deno.test("choosing the transcriber", () => {
  const all = new Set(["whisper-cli", "whisper"]);
  assertEquals(chooseTranscriber({ installed: all, modelPref: "", models: ["/m/ggml-base.bin"], language: "auto" }), {
    engine: "whisper.cpp",
    program: "whisper-cli",
    model: "/m/ggml-base.bin",
  });
  assertEquals(
    chooseTranscriber({ installed: all, modelPref: "/x/ggml-medium.bin", models: [], language: "auto" })?.model,
    "/x/ggml-medium.bin",
  );
  // whisper.cpp without a model: openai-whisper, with its own model name.
  assertEquals(chooseTranscriber({ installed: all, modelPref: "small", models: [], language: "auto" }), {
    engine: "whisper",
    program: "whisper",
    model: "small",
  });
  assertEquals(
    chooseTranscriber({ installed: new Set(["whisper-cpp"]), modelPref: "", models: [], language: "en" }),
    undefined,
  );
  assertEquals(
    chooseTranscriber({ installed: new Set(["whisper"]), modelPref: "", models: [], language: "en" })?.model,
    "base",
  );
});

Deno.test("transcription scripts", () => {
  const w = "/d/2026-10-29_14-05-12.wav";
  const cpp = transcribeScript({ engine: "whisper.cpp", program: "whisper-cli", model: "/m/ggml-base.bin" }, w, "fr");
  assertStringIncludes(
    cpp,
    `if whisper-cli -m /m/ggml-base.bin -f ${w} -l fr -t "$(nproc 2>/dev/null || echo 4)" -otxt -of /d/2026-10-29_14-05-12 -np -nt > /dev/null 2> /d/2026-10-29_14-05-12.log`,
  );
  assertStringIncludes(cpp, "mv -f /d/2026-10-29_14-05-12.log /d/2026-10-29_14-05-12.error");
  const py = transcribeScript({ engine: "whisper", program: "whisper", model: "small" }, w, "auto");
  assertStringIncludes(
    py,
    `whisper ${w} --model small --output_format txt --output_dir /d --fp16 False --verbose False`,
  );
  assert(!py.includes("--language"));
  assertStringIncludes(
    transcribeScript({ engine: "whisper", program: "whisper", model: "base" }, w, "en"),
    "--language en",
  );
  assertEquals(transcribeUnit(w), "backslash-voice-transcribe-2026-10-29_14-05-12");
  assertEquals(transcribeUnit("/d/my memo!.wav"), "backslash-voice-transcribe-my-memo-");
  assertEquals(q("it's"), `'it'\\''s'`);
});

Deno.test("transcripts", () => {
  assertEquals(
    cleanTranscript(" Hello there , this is a test.\n [BLANK_AUDIO]\n Second line !\n"),
    "Hello there, this is a test. Second line!",
  );
  assertEquals(cleanTranscript("[BLANK_AUDIO]"), "");
  assertEquals(
    errorLine("whisper_init_from_file: loading\nerror: failed to open 'x.bin'\nusage: …"),
    "error: failed to open 'x.bin'",
  );
  assertEquals(errorLine(""), "The transcription failed");
});

Deno.test("notes in the Quick Notes folder", () => {
  assertEquals(titleFrom("Call the bank about the card. Then buy milk."), "Call the bank about the card");
  assertEquals(
    titleFrom("This is a very long first sentence that keeps going without any punctuation at all for a while"),
    "This is a very long first sentence that keeps going without…",
  );
  assertEquals(titleFrom(""), "");
  assertEquals(noteFileName("Call the bank / card?"), "Call the bank - card.md");
  assertEquals(noteFileName("Long title…"), "Long title.md");
  assertEquals(noteFileName("???"), "Voice note.md");
  assertEquals(uniqueFileName("A.md", ["a.md", "A 2.md"]), "A 3.md");
  const text = noteText("Buy milk.", new Date(2026, 9, 29, 14, 5, 12), "~/.local/share/backslash/voice-notes/x.wav");
  assertEquals(
    text,
    '---\ntags: [voice-note]\ncreated: 2026-10-29T14:05:12\naudio: "~/.local/share/backslash/voice-notes/x.wav"\n---\nBuy milk.\n',
  );
});

Deno.test("formatting", () => {
  assertEquals(clock(83), "1:23");
  assertEquals(clock(3723), "1:02:03");
  assertEquals(bytes(512), "512 B");
  assertEquals(bytes(2_621_440), "2.5 MB");
  const now = new Date(2026, 9, 29, 15);
  assertEquals(ageSection(new Date(2026, 9, 29, 9).getTime(), now), "Today");
  assertEquals(ageSection(new Date(2026, 9, 28, 9).getTime(), now), "Yesterday");
  assertEquals(ageSection(new Date(2026, 9, 1).getTime(), now), "Older");
  assertEquals(keywordsOf("Buy milk, buy BREAD and eggs"), ["buy", "milk", "bread", "and", "eggs"]);
  assertEquals(expandHome("~/Documents/Notes", "/home/me"), "/home/me/Documents/Notes");
  assertEquals(tildify("/home/me/x", "/home/me"), "~/x");
  assertEquals(osFamily("ID=fedora\nVERSION_ID=41"), "fedora");
});
