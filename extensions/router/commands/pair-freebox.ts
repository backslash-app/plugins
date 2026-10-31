// Pairing with Freebox OS: ask for an app token, wait for the answer on the box's screen, hand the token over.

import { action, clipboard, type Context, detail, Icons, open, refresh, toast } from "@backslash/api";
import { freeboxApi, freeboxCall } from "../api.ts";
import { FREEBOX_APP, PAIRING } from "../lib.ts";
import { checkBase, httpClient, SetupError } from "../net.ts";

const FREEBOX = "http://mafreebox.freebox.fr";
const CONFIGURE = "**Settings → Extensions → Router → Configure**";

export default (ctx: Context) => {
  const url = String(ctx.preferences.url ?? "").trim();
  const kind = String(ctx.preferences.kind ?? "").trim().toLowerCase();
  // Pair with the configured address when it is a Freebox, the box's own name otherwise.
  const base = checkBase(url && (kind === "freebox" || /freebox/i.test(url) || !kind) ? url : FREEBOX, "Freebox");
  let token: string | undefined;

  return detail({
    title: "Pair Freebox",
    async *markdown({ signal }) {
      const client = httpClient(ctx.preferences.certificate);
      let api: string;
      try {
        api = await freeboxApi(base, client, signal);
      } catch (e) {
        if (e instanceof SetupError) {
          yield `## ${e.message}\n\nSet the Freebox's address (\`${FREEBOX}\`) in ${CONFIGURE}, on a computer at home.`;
          return;
        }
        throw e;
      }
      const { app_token, track_id } = await freeboxCall<{ app_token: string; track_id: number }>(
        `${api}/login/authorize/`,
        { client, signal, body: { ...FREEBOX_APP, device_name: "Backslash on Linux" } },
      );
      const intro = [
        "## Accept Backslash on the Freebox",
        "",
        "Go to the Freebox Server and press **›** (the right arrow) on its screen to allow **Backslash**.",
        "",
      ].join("\n");
      yield `${intro}_Waiting for your answer…_`;
      for (let i = 0; i < 120 && !signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const { status } = await freeboxCall<{ status: string }>(`${api}/login/authorize/${track_id}`, {
          client,
          signal,
        });
        if (status === "pending") continue;
        if (status === "granted") {
          token = app_token;
          yield [
            "## Paired",
            "",
            `1. Press **Enter** to copy the app token, and paste it as **Freebox app token** in ${CONFIGURE} (with \`${base}\` as the address).`,
            "2. To reboot the box from Backslash, open Freebox OS → **Paramètres de la Freebox → Gestion des accès → Applications**, edit **Backslash** and tick **Modification des réglages de la Freebox**.",
          ].join("\n");
          return;
        }
        yield `## ${PAIRING[status]?.label ?? status}\n\nRun **Pair Freebox** again to retry.`;
        return;
      }
      yield `## ${PAIRING.timeout.label}\n\nRun **Pair Freebox** again to retry.`;
    },
    actions: [
      action("Copy App Token", async () => {
        if (!token) {
          await toast("Not paired yet", { style: "failure", message: "Accept Backslash on the Freebox's screen" });
          return;
        }
        await clipboard.write(token, { concealed: true });
        await toast("App token copied", { style: "success", message: "Paste it in the extension's settings" });
      }, { icon: Icons.key }),
      open(base, "Open Freebox OS", { icon: Icons.globe }),
      action("Start Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  });
};
