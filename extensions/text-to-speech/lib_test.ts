import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  cleanText,
  clock,
  duration,
  guessLanguage,
  installMarkdown,
  osFamily,
  parseEngine,
  parseEspeakVoices,
  parseSpdVoices,
  pickEngine,
  piperVoice,
  speakScript,
  speedOf,
  systemdRunArgs,
  voiceFor,
} from "./lib.ts";

const ESPEAK = `Pty Language       Age/Gender VoiceName          File                 Other Languages
 5  af              --/M      Afrikaans          gmw/af
 2  en-gb           --/M      English_(Great_Britain) gmw/en          (en 2)
 2  en-us           --/M      English_(America)  gmw/en-US            (en 3)
 5  fr-be           --/M      French_(Belgium)   roa/fr-BE            (fr 8)
 5  fr              --/M      French_(France)    roa/fr               (fr 5)
 5  de              --/F      German             gmw/de
`;

const SPD = `     NAME                 LANGUAGE             VARIANT
     afrikaans            af                   none
     english-us           en-US                none
     french               fr                   none
`;

const PIPER_CONFIG = JSON.stringify({
  audio: { sample_rate: 22050, quality: "medium" },
  espeak: { voice: "fr" },
  language: { code: "fr_FR", family: "fr", region: "FR", name_native: "Français", name_english: "French" },
  num_speakers: 1,
});

Deno.test("engines", () => {
  assertEquals(parseEngine("espeak"), "espeak-ng");
  assertEquals(parseEngine("Speech-Dispatcher"), "spd-say");
  assertEquals(parseEngine("whatever"), "auto");
  assertEquals(pickEngine("auto", new Set(["festival", "espeak-ng"])), "espeak-ng");
  assertEquals(pickEngine("auto", new Set(["piper", "espeak-ng"])), "piper");
  assertEquals(pickEngine("piper", new Set(["espeak-ng"])), undefined);
  assertEquals(pickEngine("auto", new Set()), undefined);
});

Deno.test("voices", () => {
  const es = parseEspeakVoices(ESPEAK);
  assertEquals(es.length, 6);
  assertEquals(es[1], {
    engine: "espeak-ng",
    id: "en-gb",
    name: "English (Great Britain)",
    language: "en-gb",
    gender: "Male",
  });
  assertEquals(es[5].gender, "Female");
  const spd = parseSpdVoices(SPD);
  assertEquals(spd.map((v) => [v.id, v.language]), [["afrikaans", "af"], ["english-us", "en-us"], ["french", "fr"]]);
  const p = piperVoice("/home/ada/.local/share/piper/fr_FR-siwis-medium.onnx", PIPER_CONFIG);
  assertEquals([p.name, p.language, p.quality, p.sampleRate], ["Siwis · French", "fr-fr", "medium", 22050]);
  const bare = piperVoice("/m/en_US-lessac-high.onnx", undefined);
  assertEquals([bare.name, bare.language, bare.quality, bare.sampleRate], ["Lessac", "en-us", "high", 22050]);
});

Deno.test("language guess and voice choice", () => {
  assertEquals(guessLanguage("Bonjour, je voudrais réserver une table pour ce soir."), "fr");
  assertEquals(guessLanguage("The quick brown fox jumps over the lazy dog and that is it."), "en");
  assertEquals(guessLanguage("Ich bin nicht sicher, ob das stimmt."), "de");
  assertEquals(guessLanguage("¿Dónde está la estación de tren? Es muy tarde."), "es");
  assertEquals(guessLanguage("OK"), undefined);
  const es = parseEspeakVoices(ESPEAK);
  assertEquals(voiceFor(es, undefined, "fr")?.id, "fr", "fr before fr-be");
  assertEquals(voiceFor(es, "en-gb", "fr")?.id, "en-gb", "the chosen voice wins");
  assertEquals(voiceFor(es, "German", undefined)?.id, "de", "by name");
  assertEquals(voiceFor(es, undefined, "ja"), undefined);
  const piper = [piperVoice("/m/fr_FR-siwis-low.onnx", undefined), piperVoice("/m/fr_FR-tom-medium.onnx", undefined)];
  assertEquals(voiceFor(piper, undefined, "fr")?.id, "/m/fr_FR-tom-medium.onnx", "better quality first");
});

Deno.test("text", () => {
  assertEquals(
    cleanText(
      "# Title\n\nRead **this** on https://www.example.com/a/b?c=d and [the docs](https://deno.com/x).\n\n\n\nEnd",
    ),
    "Title\n\nRead this on example.com and the docs.\n\nEnd",
  );
  assertEquals(cleanText("```\ncode\n```"), "");
  assertEquals(duration("word ".repeat(160)), 60);
  assertEquals(duration("word ".repeat(160), 2), 30);
  assertEquals(clock(75), "1:15");
  assertEquals(speedOf(150), 1.5);
  assertEquals(speedOf(undefined), 1);
  assertEquals(speedOf(1000), 3);
});

Deno.test("speak scripts", () => {
  const file = "/home/ada/.cache/backslash/tts/text.txt";
  const es = parseEspeakVoices(ESPEAK);
  assertEquals(
    speakScript({ engine: "espeak-ng", file, voice: es[4], speed: 1.2, cache: "/c" }),
    `exec espeak-ng -v 'fr' -s 210 -f '${file}'`,
  );
  assertEquals(
    speakScript({ engine: "espeak-ng", file, language: "de", speed: 1, cache: "/c" }),
    `exec espeak-ng -v 'de' -s 175 -f '${file}'`,
  );
  assertEquals(
    speakScript({ engine: "spd-say", file, language: "fr", speed: 0.5, cache: "/c" }),
    `exec spd-say -w -e -r -50 -l 'fr' < '${file}'`,
  );
  assertEquals(speakScript({ engine: "festival", file, speed: 1, cache: "/c" }), `exec festival --tts '${file}'`);
  const piper = speakScript({
    engine: "piper",
    file,
    voice: piperVoice("/m/it's.onnx", JSON.stringify({ audio: { sample_rate: 16000 } })),
    speed: 2,
    cache: "/c",
  });
  assertStringIncludes(
    piper,
    `piper --model '/m/it'\\''s.onnx' --length_scale 0.50 --output-raw < '${file}' | aplay -q -r 16000`,
  );
  assertStringIncludes(piper, "paplay --raw --rate=16000");
  assertStringIncludes(piper, "pw-play '/c/speech.wav'");
  const args = systemdRunArgs("true", { XDG_RUNTIME_DIR: "/run/user/1000", PULSE_SERVER: undefined });
  assertEquals(args.slice(0, 3), ["--user", "--quiet", "--unit=backslash-text-to-speech"]);
  assert(args.includes("--setenv=XDG_RUNTIME_DIR=/run/user/1000") && !args.some((a) => a.includes("PULSE")));
});

Deno.test("install hints", () => {
  assertEquals(osFamily("ID=fedora\n"), "fedora");
  assertStringIncludes(installMarkdown("arch"), "sudo pacman -S espeak-ng");
  assertStringIncludes(installMarkdown(undefined), "sudo apt install espeak-ng");
});
