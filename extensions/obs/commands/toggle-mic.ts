import { run } from "@backslash/api";
import { audioInputs } from "../api.ts";
import { audioKind } from "../lib.ts";
import { once } from "../system.ts";

// Mutes or unmutes OBS's microphones together: if any is on, all are muted.
export default run((ctx) =>
  once(ctx, async (client) => {
    const res = await client.request("GetInputList");
    const inputs = (Array.isArray(res.inputs) ? res.inputs : [])
      .map((i: Record<string, unknown>) => ({
        name: String(i.inputName),
        kind: String(i.unversionedInputKind ?? i.inputKind ?? ""),
      }));
    const mics = (await audioInputs(client, inputs)).filter((a) => audioKind(a.kind, a.special) === "mic");
    if (!mics.length) throw new Error("OBS has no microphone input");
    const mute = mics.some((m) => !m.muted);
    await client.batch(
      mics.map((m) => ({ requestType: "SetInputMute", requestData: { inputName: m.name, inputMuted: mute } })),
    );
    const names = mics.length === 1 ? mics[0].name : `${mics.length} microphones`;
    return `${names} ${mute ? "muted" : "unmuted"}`;
  })
);
