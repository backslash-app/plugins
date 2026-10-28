import { type Context, copy, Icons, list, type ListSpec } from "@backslash/api";
import { type Details, details, devices, installHint, Missing } from "../adb.ts";
import { type Device, deviceName } from "../lib.ts";
import { appItems, appsView, installSubmenu, type Prefs } from "../views.ts";

/** The apps of the connected device; with several devices, a chip for each. */
export default async ({ preferences, signal }: Context): Promise<ListSpec> => {
  const prefs = preferences as Prefs;
  let ready: Device[];
  try {
    ready = (await devices(signal)).filter((d) => d.state === "device");
  } catch (e) {
    if (!(e instanceof Missing)) throw e;
    const cmd = await installHint("adb");
    return list({
      items: [{
        title: "adb is not installed",
        subtitle: cmd,
        icon: { source: Icons.alert, tint: "orange" },
        actions: [copy(cmd, "Copy Install Command", { icon: Icons.terminal })],
      }],
    });
  }
  if (!ready.length) {
    return list({
      items: [],
      empty: {
        title: "No Android device connected",
        description: "Plug in a phone with USB debugging on, or connect it over Wi-Fi from Android Devices",
        icon: Icons.cpu,
      },
    });
  }
  const infos = await Promise.all(
    ready.map((d) => details(d.serial, signal).catch((): Details | undefined => undefined)),
  );
  const names = ready.map((d, i) => deviceName(d, infos[i]?.info));
  if (ready.length === 1) return appsView(ready[0], names[0], prefs);
  return list({
    title: "Android Apps",
    placeholder: "Filter the apps you installed…",
    filter: { options: ready.map((d, i) => ({ value: d.serial, title: names[i] })), default: ready[0].serial },
    status: (items) => `${items.length} app${items.length === 1 ? "" : "s"}`,
    empty: { title: "No app installed", description: "Only the apps you installed are listed", icon: Icons.apps },
    actions: ready.map((d, i) => ({ ...installSubmenu(d, names[i]), title: `Install APK on ${names[i]}` })),
    items: ({ filter, signal }) => {
      const i = Math.max(0, ready.findIndex((d) => d.serial === filter));
      return appItems(ready[i], names[i], prefs, signal);
    },
  });
};
