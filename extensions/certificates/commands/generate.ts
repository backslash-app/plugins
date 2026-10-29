import { copy, detail, field, form, type FormSpec, Icons, open, toast } from "@backslash/api";
import { expandHome, mkcertBase, parseNames, tildify } from "../lib.ts";
import { caroot, generate, HOME, MissingTool } from "../system.ts";

/** The mkcert form; `names` and `folder` prefill it (to renew a certificate). */
export function generateForm(names = "localhost 127.0.0.1 ::1", folder = "~/certs"): FormSpec {
  return form({
    title: "Generate Local Certificate",
    submitTitle: "Generate",
    fields: [
      field.text("names", "Names", {
        required: true,
        value: names,
        placeholder: "myapp.test *.myapp.test localhost 127.0.0.1",
      }),
      field.text("folder", "Folder", { required: true, value: tildify(folder, HOME), placeholder: "~/certs" }),
      field.checkbox("ecdsa", "ECDSA key instead of RSA"),
      field.checkbox("client", "Client authentication certificate"),
      field.checkbox("pkcs12", "PKCS#12 file (.p12) for Java, Windows…"),
    ],
    async submit(values) {
      const list = parseNames(String(values.names ?? ""));
      const dir = expandHome(String(values.folder ?? "~/certs"), HOME);
      const base = mkcertBase(list);
      let made;
      try {
        made = await generate(list, dir, base, {
          ecdsa: values.ecdsa === true,
          client: values.client === true,
          pkcs12: values.pkcs12 === true,
        });
      } catch (e) {
        if (e instanceof MissingTool) {
          throw new Error(
            "mkcert is not installed: sudo apt install mkcert libnss3-tools (or dnf, pacman), then mkcert -install",
          );
        }
        throw e;
      }
      const root = await caroot();
      const trusted = await Deno.stat(`${root.path}/rootCA.pem`).then(() => true, () => false);
      await toast(`Certificate for ${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ""}`, { style: "success" });
      const cert = tildify(made.cert, HOME);
      const key = tildify(made.key, HOME);
      return detail({
        title: base,
        markdown: [
          `## Certificate for ${list.join(", ")}`,
          "",
          made.p12
            ? `- **PKCS#12**: \`${cert}\` (password \`changeit\`)`
            : `- **Certificate**: \`${cert}\`\n- **Key**: \`${key}\``,
          "",
          trusted ? "" : "> Run `mkcert -install` once so that browsers trust the local CA.",
          "",
          made.p12 ? "" : [
            "**Node**",
            "```js",
            `https.createServer({ cert: fs.readFileSync("${made.cert}"), key: fs.readFileSync("${made.key}") }, app)`,
            "```",
            "**Vite**",
            "```js",
            `server: { https: { cert: "${made.cert}", key: "${made.key}" } }`,
            "```",
            "**nginx**",
            "```nginx",
            `ssl_certificate     ${made.cert};`,
            `ssl_certificate_key ${made.key};`,
            "```",
          ].join("\n"),
        ].join("\n"),
        actions: [
          copy(made.cert, "Copy Certificate Path"),
          ...(made.p12 ? [] : [copy(made.key, "Copy Key Path", { icon: Icons.key })]),
          open(dir, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
          ...(trusted ? [] : [copy("mkcert -install", "Copy mkcert -install", { icon: Icons.terminal })]),
        ],
      });
    },
  });
}

export default generateForm();
