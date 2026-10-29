import { Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { asleep, offloadEnv } from "../lib.ts";
import { gpus, modeState, nvidia, pending, processes, switcheroo } from "../system.ts";
import { changes, gpuItem, modeItem, noToolItem, pendingItem, processItem } from "../ui.ts";

/** Yields once, then again after each change, until the user leaves. */
async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
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
}

let shown = "";

export default list({
  placeholder: "Filter modes, GPUs and processes…",
  empty: { title: "No GPU found", description: "lspci lists no display controller", icon: Icons.monitor },
  status: () => shown,
  items: ({ signal }) =>
    live(async () => {
      const [boot, state, waiting] = await Promise.all([switcheroo(), modeState(), pending()]);
      const found = await gpus(boot);
      const dgpu = found.find((g) => g.discrete);
      const awake = !asleep(state.power);
      const [smi, procs] = await Promise.all([
        dgpu?.vendorId === "10de" ? nvidia(state.power) : Promise.resolve([]),
        processes(dgpu, awake),
      ]);
      const other = boot.find((g) => !g.default);
      const env = other && Object.keys(other.env).length ? other.env : offloadEnv(dgpu);

      const items: Item[] = [];
      if (waiting && state.tool) items.push(pendingItem(waiting, state));
      if (state.tool) items.push(...state.modes.map((m) => modeItem(m, state, waiting)));
      else if (found.length) items.push(noToolItem(found));
      items.push(...found.map((g) =>
        gpuItem(
          g,
          env,
          g.discrete ? state.power : undefined,
          g.discrete
            ? smi.find((s) => s.busId.toLowerCase().endsWith(g.slot.slice(5).toLowerCase())) ?? smi[0]
            : undefined,
        )
      ));
      items.push(...procs.map(processItem));

      const current = state.modes.find((m) => m.id.toLowerCase() === state.current?.toLowerCase());
      shown = [
        current ? `Mode ${current.title}` : "",
        dgpu ? `${procs.length} process${procs.length === 1 ? "" : "es"} on the discrete GPU` : "",
      ].filter(Boolean).join(" · ");
      updateCommandMetadata({ subtitle: current ? current.title : null }).catch(() => {});
      return items;
    }, signal),
});
