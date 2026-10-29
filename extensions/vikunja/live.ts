// Views of this extension run in one process: a change made from one view
// (a new status) reloads the lists still open.

const changes = new EventTarget();

export function notifyChanged() {
  changes.dispatchEvent(new Event("change"));
}

/** Yields `load()`, then again after each change, until `signal` aborts. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
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
