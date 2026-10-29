import { action, type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { oath, parseCodes, secondsLeft } from "../lib.ts";
import { devices, NotInstalled, ykman } from "../system.ts";
import { accountItem, addForm, errorItem, installItem, live, noKeyItem, type Oath } from "../ui.ts";

interface Prefs {
  oathPassword?: string;
}

async function load(password?: string): Promise<Item[]> {
  let keys;
  try {
    keys = await devices();
  } catch (e) {
    if (e instanceof NotInstalled) return [await installItem()];
    return [errorItem("Couldn't list YubiKeys", (e as Error).message)];
  }
  if (!keys.length) return [noKeyItem()];
  const withOath = keys.filter((k) => {
    const apps = k.info?.applications ?? [];
    return !apps.length || apps.some((a) => /^OATH/.test(a.name) && /enabled/i.test(a.usb));
  });
  const many = withOath.length > 1;
  const left = secondsLeft();
  const items: Item[] = [];
  let total = 0;
  for (const device of withOath) {
    try {
      const o: Oath = { device, accounts: parseCodes(await ykman(oath.codes(device.serial, password))) };
      total += o.accounts.length;
      items.push(...o.accounts.map((a) => accountItem(o, a, password, left, many)));
    } catch (e) {
      items.push(errorItem(`OATH on ${device.name}`, (e as Error).message));
    }
  }
  updateCommandMetadata({ subtitle: total ? `${total} account${total === 1 ? "" : "s"}` : null }).catch(() => {});
  if (!items.length) {
    items.push({
      id: "empty",
      title: "No account on the YubiKey yet",
      subtitle: "Enter adds one from an otpauth:// link",
      icon: { source: Icons.plus, tint: "gray" },
      actions: [action("Add Account…", () => addForm(withOath, "", password), { icon: Icons.plus })],
    });
  }
  return items;
}

export default (ctx: Context) => {
  const password = (ctx.preferences as Prefs).oathPassword || undefined;
  return list({
    placeholder: "Search accounts…",
    empty: { title: "No matching account", icon: Icons.key },
    status: () => `New codes in ${secondsLeft()}s`,
    // Codes are computed again when the 30-second window turns.
    items: ({ signal }) => live(() => load(password), signal, () => secondsLeft() * 1000 + 300),
  });
};
