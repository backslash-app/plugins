import { assert, assertEquals } from "@std/assert";
import {
  cssFontFamily,
  expandPath,
  groupFamilies,
  isFontFile,
  pangoFont,
  parseFcList,
  previewName,
  regularFile,
  regularStyle,
  sortStyles,
  tilde,
} from "./lib.ts";

// fc-list --format '%{family[0]}\t%{style[0]}\t%{file}\t%{spacing}\n' on Ubuntu 24.04, plus a user font.
const FC_LIST = [
  "JetBrains Mono\tMedium\t/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf\t100",
  "JetBrains Mono\tBold Italic\t/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-BoldItalic.ttf\t100",
  "JetBrains Mono\tRegular\t/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf\t100",
  "JetBrains Mono\tThin\t/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Thin.ttf\t100",
  "Liberation Serif\tBold Italic\t/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf\t",
  "Liberation Serif\tRegular\t/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf\t",
  "Inter Display\tSemiBold Italic\t/usr/share/fonts/opentype/inter/InterDisplay-SemiBoldItalic.otf\t",
  "Inter Display\tLight\t/usr/share/fonts/opentype/inter/InterDisplay-Light.otf\t",
  "DejaVu Sans\tBook\t/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf\t",
  "DejaVu Sans\tBold\t/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf\t",
  "Fira Code\tRegular\t/home/ada/.local/share/fonts/FiraCode-Regular.ttf\t100",
  "Fira Code\tRegular\t/home/ada/.local/share/fonts/FiraCode-Regular.woff2\t100",
  "\t\t\t",
  "",
].join("\n");

Deno.test("parseFcList reads faces and skips blank lines", () => {
  const faces = parseFcList(FC_LIST);
  assertEquals(faces.length, 12);
  assertEquals(faces[0], {
    family: "JetBrains Mono",
    style: "Medium",
    file: "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf",
    spacing: 100,
  });
  assertEquals(faces[4].spacing, undefined);
});

Deno.test("groupFamilies merges faces, orders styles and spots user fonts", () => {
  const fams = groupFamilies(parseFcList(FC_LIST), ["/home/ada/.local/share/fonts", "/home/ada/.fonts"]);
  assertEquals(fams.map((f) => f.name), [
    "DejaVu Sans",
    "Fira Code",
    "Inter Display",
    "JetBrains Mono",
    "Liberation Serif",
  ]);
  const jb = fams.find((f) => f.name === "JetBrains Mono")!;
  assertEquals(jb.styles, ["Thin", "Regular", "Medium", "Bold Italic"]);
  assert(jb.mono);
  assert(!jb.user);
  const fira = fams.find((f) => f.name === "Fira Code")!;
  assert(fira.user);
  assertEquals(fira.styles, ["Regular"]);
  assertEquals(fira.formats, ["TTF", "WOFF2"]);
  assert(!fams.find((f) => f.name === "Liberation Serif")!.mono);
});

Deno.test("sortStyles puts weights in order, italics after uprights", () => {
  assertEquals(
    sortStyles(["Bold", "Italic", "Black", "Light Italic", "Regular", "Condensed Bold", "SemiBold"]),
    ["Light Italic", "Regular", "Italic", "SemiBold", "Bold", "Black", "Condensed Bold"],
  );
});

Deno.test("regularStyle and regularFile pick the upright face", () => {
  assertEquals(regularStyle(["Bold", "Book", "Oblique"]), "Book");
  assertEquals(regularStyle(["Light", "SemiBold Italic"]), "Light");
  const faces = parseFcList(FC_LIST);
  assertEquals(
    regularFile(faces, "JetBrains Mono"),
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
  );
  assertEquals(regularFile(faces, "Nope"), undefined);
});

Deno.test("cssFontFamily quotes names and adds a generic family", () => {
  assertEquals(cssFontFamily("JetBrains Mono", true), `font-family: "JetBrains Mono", monospace;`);
  assertEquals(cssFontFamily("Inter", false), "font-family: Inter, sans-serif;");
  assertEquals(cssFontFamily("Liberation Serif", false), `font-family: "Liberation Serif", serif;`);
  assertEquals(cssFontFamily("Noto Sans", false), `font-family: "Noto Sans", sans-serif;`);
});

Deno.test("previewName is a safe, distinct file name", () => {
  assert(/^[a-z0-9-]+\.png$/.test(previewName("Noto Sans CJK JP")));
  assert(previewName("Foo-Bar").startsWith("foo-bar-"));
  assert(previewName("Foo Bar") !== previewName("Foo-Bar"));
  assertEquals(pangoFont("Iosevka Term Bold", 26), "Iosevka Term Bold, 26");
});

Deno.test("expandPath and isFontFile understand typed paths", () => {
  assertEquals(expandPath("~/Downloads/Inter.ttf", "/home/ada"), "/home/ada/Downloads/Inter.ttf");
  assertEquals(expandPath("file:///tmp/My%20Font.otf", "/home/ada"), "/tmp/My Font.otf");
  assertEquals(expandPath(" '/tmp/a.ttf' ", "/home/ada"), "/tmp/a.ttf");
  assert(isFontFile("~/Downloads/Inter.TTF"));
  assert(!isFontFile("Inter.ttf"));
  assert(!isFontFile("/tmp/notes.txt"));
  assertEquals(tilde("/home/ada/.local/share/fonts", "/home/ada"), "~/.local/share/fonts");
  assertEquals(tilde("/home/adam/x", "/home/ada"), "/home/adam/x");
});
