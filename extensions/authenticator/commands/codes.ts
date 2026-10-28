import { type Context, Icons, type Item, list, toast, updateCommandMetadata } from "@backslash/api";
import { sortAccounts } from "../lib.ts";
import { importScans, keyring, loadAll, type Loaded, nextTick, VaultError } from "../system.ts";
import { addActions, addedMessage, addItems, codeItem, codesFor, type Prefs, setupItem } from "../ui.ts";

let count = 0;
let locked = 0;

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Search accounts…",
    empty: { title: "No matching account", description: "Ctrl+K adds one", icon: Icons.shield },
    actions: addActions(prefs),
    status: () =>
      count
        ? `${count} account${count === 1 ? "" : "s"}${locked ? ` · ${locked} locked` : ""} · Enter copies the code`
        : "Add your first account",
    // Secrets are read when the list opens and after a change; codes tick every second.
    async *items({ signal }) {
      let accounts: Loaded[] = [];
      let extra: Item[] = [];
      let reload = true;
      while (!signal.aborted) {
        if (reload) {
          const ring = await keyring();
          extra = [];
          try {
            const scanned = await importScans(prefs.passphrase);
            if (scanned.result.added.length || scanned.result.duplicates || scanned.skipped.length) {
              toast(addedMessage(scanned.result, scanned.skipped), { style: "success" }).catch(() => {});
            }
          } catch (e) {
            if (!(e instanceof VaultError)) throw e;
            extra.push(await setupItem(ring, e.message));
          }
          accounts = sortAccounts(await loadAll(prefs.passphrase));
          count = accounts.length;
          locked = accounts.filter((a) => !a.key).length;
          if (ring !== "ok" && !prefs.passphrase && !extra.length) extra.push(await setupItem(ring));
          extra.push(...addItems(prefs, ring));
          updateCommandMetadata({ subtitle: count ? `${count} account${count === 1 ? "" : "s"}` : null }).catch(
            () => {},
          );
        }
        const seconds = Date.now() / 1000;
        const rows = await Promise.all(accounts.map(async (a) => codeItem(a, await codesFor(a, seconds), prefs)));
        yield [...rows, ...extra];
        // Wake up right after the next second, so the countdown stays exact.
        reload = (await nextTick(1000 - (Date.now() % 1000) + 20, signal)) === "change";
      }
    },
  });
};
