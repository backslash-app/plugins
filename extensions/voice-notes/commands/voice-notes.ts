import {
  type Action,
  action,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  paste,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { ageSection, bytes, clock, installHint, keywordsOf, MODEL_URL, titleFrom, when } from "../lib.ts";
import {
  cancelTranscription,
  DIR,
  family,
  MissingTool,
  type Note,
  notes,
  notesDir,
  type Recording,
  recording,
  remove,
  saveNote,
  startRecording,
  stopRecording,
  tilde,
  type Tools,
  tools,
  transcribe,
} from "../system.ts";

const LANGUAGES: [string, string][] = [["auto", "Detect"], ["en", "English"], ["fr", "French"], ["de", "German"], [
  "es",
  "Spanish",
], ["it", "Italian"]];

const fail = async (e: unknown) => {
  await toast((e as Error).message, { style: "failure" });
};

function recordItem(rec: Recording | undefined, t: Tools): Item {
  if (rec) {
    const elapsed = (Date.now() - rec.started) / 1000;
    return {
      id: "record",
      title: `Recording… ${clock(elapsed)}`,
      subtitle: "Enter stops and saves",
      icon: { source: Icons.mic, tint: "red" },
      section: "Record",
      accessories: [{ tag: "REC", color: "red" }],
      detail: {
        stats: [{ label: "recording", value: clock(elapsed), color: "red" }],
        metadata: [
          meta.text("Recorder", rec.tool, { icon: Icons.mic }),
          meta.text("File", tilde(rec.file), { icon: Icons.file }),
          meta.text("Then", t.transcriber ? `Transcribed with ${t.transcriber.engine}` : "Saved without transcript"),
        ],
      },
      actions: [
        action("Stop Recording", async (ctx) => {
          const { transcribing } = await stopRecording(ctx);
          await toast(transcribing ? "Saved: transcribing…" : "Voice note saved", { style: "success" });
          await updateCommandMetadata({ subtitle: null }).catch(() => {});
          return refresh();
        }, { icon: Icons.stop }),
      ],
    };
  }
  return {
    id: "record",
    title: "Record Voice Note",
    subtitle: t.recorder ? `with ${t.recorder}` : "No recorder installed",
    icon: { source: Icons.mic, tint: t.recorder ? "blue" : "orange" },
    section: "Record",
    detail: {
      markdown: t.recorder
        ? "Records from the default microphone until you stop it, even with Backslash closed. " +
          "**Record Voice Note** also works as a command of its own: give it a hotkey to start and stop."
        : "Install a recorder: **pw-record** (PipeWire), **ffmpeg** or **arecord** (alsa-utils).",
      metadata: [
        meta.text("Recorder", t.recorder ?? "None found", {
          icon: Icons.mic,
          color: t.recorder ? undefined : "orange",
        }),
        meta.text(
          "Transcriber",
          t.transcriber ? `${t.transcriber.engine} · ${tilde(t.transcriber.model)}` : "None found",
          { icon: Icons.text, color: t.transcriber ? undefined : "orange" },
        ),
        meta.text("Recordings", tilde(DIR), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Start Recording", async (ctx) => {
        try {
          await startRecording(ctx);
        } catch (e) {
          if (e instanceof MissingTool) {
            const hint = installHint(await family());
            throw new Error(`${e.message}: ${hint.recorder}`);
          }
          throw e;
        }
        await updateCommandMetadata({ subtitle: "Recording…" }).catch(() => {});
        return close("Recording… open Voice Notes or run Record Voice Note to stop");
      }, { icon: Icons.mic }),
    ],
  };
}

function setupItem(t: Tools, fam: Awaited<ReturnType<typeof family>>): Item | undefined {
  if (t.transcriber) return undefined;
  const hint = installHint(fam);
  return {
    id: "setup",
    title: t.needsModel ? "Download a whisper.cpp model" : "Install a transcriber",
    subtitle: t.needsModel ? "whisper.cpp needs a ggml model file" : "whisper.cpp or openai-whisper",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Record",
    detail: {
      markdown: [
        "Recordings are transcribed on this computer, nothing is uploaded.",
        "",
        "**whisper.cpp** (fast, recommended): `whisper-cli` or `whisper-cpp`, and a model such as",
        "`ggml-base.bin` or `ggml-small.bin` in `~/.local/share/whisper.cpp/` (or its path in the settings).",
        "",
        "**openai-whisper**: `pipx install openai-whisper`; it downloads its model the first time.",
        "",
        `On this system: \`${hint.whisper}\``,
      ].join("\n"),
    },
    actions: [
      open(MODEL_URL, "Download Models", { icon: Icons.download }),
      action("Check Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function noteItem(n: Note, t: Tools): Item {
  const title = n.recording
    ? "Recording…"
    : n.transcript
    ? titleFrom(n.transcript) || "Voice note"
    : n.transcribing
    ? "Transcribing…"
    : n.error
    ? "Transcription failed"
    : "Not transcribed";
  const state = n.recording
    ? { tag: "REC", color: "red" as const }
    : n.transcribing
    ? { tag: "Transcribing", color: "blue" as const }
    : n.error && !n.transcript
    ? { tag: "Failed", color: "red" as const }
    : undefined;
  const retranscribe = (language?: string) => async (ctx: Context) => {
    try {
      await transcribe(ctx, n.wav, undefined, language);
    } catch (e) {
      if (e instanceof MissingTool) {
        const hint = installHint(await family());
        return void (await fail(new Error(`${e.message} (${hint.whisper})`)));
      }
      throw e;
    }
    await toast("Transcribing…", { message: "A notification says when it's ready" });
    return refresh();
  };
  const actions: Action[] = [];
  if (n.transcript) {
    actions.push(
      copy(n.transcript, "Copy Transcript"),
      paste(n.transcript, "Paste Transcript"),
      action("Save as Note", async (ctx) => {
        const path = await saveNote(ctx, n);
        await toast(`Saved to ${tilde(path)}`, { style: "success" });
      }, { icon: Icons.note, shortcut: "<Ctrl>s" }),
    );
  }
  if (!n.recording) {
    if (n.transcribing) {
      actions.push(action("Cancel Transcription", async () => {
        await cancelTranscription(n.wav);
        return refresh();
      }, { icon: Icons.stop, section: "Transcript" }));
    } else if (t.transcriber) {
      actions.push(
        action(n.transcript ? "Transcribe Again" : "Transcribe", retranscribe(), {
          icon: Icons.text,
          shortcut: "<Ctrl>t",
          section: "Transcript",
        }),
        submenu(
          "Transcribe in…",
          LANGUAGES.map(([code, name]) => action(name, retranscribe(code), { icon: Icons.globe })),
          { icon: Icons.globe, section: "Transcript" },
        ),
      );
    }
  }
  actions.push(
    open(n.wav, "Play Recording", { icon: Icons.play, shortcut: "<Ctrl>p", section: "Recording" }),
    open(DIR, "Open Recordings Folder", { icon: Icons.folder, section: "Recording" }),
    copy(n.wav, "Copy File Path", { section: "Recording" }),
  );
  if (!n.recording) {
    actions.push(action("Delete Recording", async () => {
      await remove(n);
      await toast("Recording deleted", { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: n.transcript ? "Delete the recording and its transcript?" : "Delete the recording?",
      shortcut: "<Ctrl>x",
      section: "Recording",
    }));
  }
  const words = n.transcript ? n.transcript.split(/\s+/).filter(Boolean).length : 0;
  return {
    id: n.wav,
    title,
    subtitle: when(n.recorded),
    icon: {
      source: n.transcript ? Icons.note : n.error ? Icons.alert : Icons.mic,
      tint: n.recording ? "red" : n.transcript ? "blue" : n.error ? "orange" : "gray",
    },
    section: ageSection(n.recorded),
    keywords: n.transcript ? keywordsOf(n.transcript) : [],
    accessories: [
      ...(state ? [state] : []),
      ...(n.seconds !== undefined ? [{ text: clock(n.seconds), icon: Icons.clock }] : []),
    ],
    detail: {
      markdown: n.transcript
        ? (n.transcript.length > 4000 ? `${n.transcript.slice(0, 4000)}…` : n.transcript)
        : n.transcribing
        ? "_Transcribing… a notification says when it's ready._"
        : n.error
        ? `**The transcription failed.**\n\n\`${n.error.replace(/`/g, "'")}\``
        : n.recording
        ? "_Recording…_"
        : t.transcriber
        ? "_No transcript yet: press Ctrl+T to transcribe._"
        : "_No transcriber installed._",
      metadata: [
        meta.text("Recorded", new Date(n.recorded).toLocaleString("en"), { icon: Icons.calendar }),
        ...(n.seconds !== undefined ? [meta.text("Length", clock(n.seconds), { icon: Icons.clock })] : []),
        ...(words ? [meta.text("Words", words, { icon: Icons.text })] : []),
        meta.text("Size", bytes(n.size), { icon: Icons.file }),
        meta.text("File", n.name, { icon: Icons.mic }),
      ],
    },
    actions,
  };
}

export default (ctx: Context) =>
  list({
    placeholder: "Search your voice notes…",
    empty: { title: "No voice note yet", description: "Record one with Record Voice Note", icon: Icons.mic },
    status: (items) => {
      const n = items.filter((i) => i.id?.startsWith("/")).length;
      return `${n} recording${n === 1 ? "" : "s"} · notes go to ${tilde(notesDir(ctx))}`;
    },
    // Live while recording or transcribing: the timer runs and transcripts appear.
    async *items({ signal }) {
      const t = await tools(ctx);
      const fam = t.transcriber ? undefined : await family();
      while (!signal.aborted) {
        const rec = await recording();
        const all = await notes(rec);
        const setup = setupItem(t, fam);
        yield [recordItem(rec, t), ...(setup ? [setup] : []), ...all.map((n) => noteItem(n, t))];
        const busy = rec || all.some((n) => n.transcribing);
        if (!busy) return;
        await new Promise((r) => setTimeout(r, rec ? 1000 : 2000));
      }
    },
  });
