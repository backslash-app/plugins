import { Icons, type Item, list } from "@backslash/api";
import { parseReport } from "../lib.ts";
import { type Device, devices, NotInstalled, ykman } from "../system.ts";
import { changes, deviceItem, errorItem, fidoItem, installItem, noKeyItem, openpgpItem, pivItems } from "../ui.ts";

const keyArgs = (d: Device) => (d.serial ? ["--device", d.serial] : []);

/** The keys first, then each application as it answers (they're asked one at a time). */
async function* overview(): AsyncGenerator<Item[]> {
  let keys: Device[];
  try {
    keys = await devices();
  } catch (e) {
    if (e instanceof NotInstalled) {
      yield [await installItem()];
      return;
    }
    yield [errorItem("Couldn't list YubiKeys", (e as Error).message)];
    return;
  }
  if (!keys.length) {
    yield [noKeyItem()];
    return;
  }
  const items: Item[] = keys.map(deviceItem);
  yield items;
  const many = keys.length > 1;
  for (const d of keys) {
    const apps = d.info?.applications ?? [];
    const enabled = (name: RegExp) => !apps.length || apps.some((a) => name.test(a.name) && /enabled/i.test(a.usb));
    const ask = async (title: string, args: string[], build: (text: string) => Item[]) => {
      try {
        items.push(...build(await ykman([...keyArgs(d), ...args])));
      } catch (e) {
        items.push(errorItem(title, (e as Error).message, title));
      }
    };
    if (enabled(/^PIV/)) await ask("PIV", ["piv", "info"], (t) => pivItems(d, parseReport(t), many));
    yield [...items];
    if (enabled(/^FIDO2/)) await ask("FIDO2", ["fido", "info"], (t) => [fidoItem(d, parseReport(t), many)]);
    yield [...items];
    if (enabled(/^OpenPGP/)) await ask("OpenPGP", ["openpgp", "info"], (t) => [openpgpItem(d, parseReport(t), many)]);
    yield [...items];
  }
}

export default list({
  placeholder: "Filter keys, certificates and applications…",
  empty: { title: "No YubiKey", description: "Plug your key in, then Ctrl+R", icon: Icons.key },
  async *items({ signal }) {
    while (!signal.aborted) {
      yield* overview();
      await new Promise<void>((resolve) => {
        const done = () => {
          changes.removeEventListener("change", done);
          signal.removeEventListener("abort", done);
          resolve();
        };
        changes.addEventListener("change", done);
        signal.addEventListener("abort", done);
      });
    }
  },
});
