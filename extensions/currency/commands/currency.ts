import { answer, copy, Icons, storage } from "@backslash/api";
import { convert, MAX_AGE, parse, parseRates, type Rates, RETRY_AFTER } from "../lib.ts";

const URL = "https://api.frankfurter.dev/v1/latest?base=EUR";

// The command runs as long as the launcher's window is open: the rates and
// the download in progress are kept here between keystrokes, and on disk
// between openings.
let rates: Rates | undefined;
let download: Promise<Rates> | undefined;
let lastAttempt = 0;
let lastError: string | undefined;

async function fetchRates(): Promise<Rates> {
  const response = await fetch(URL, { signal: AbortSignal.timeout(8000) }).catch((e) => {
    throw new Error(`cannot reach the rates service (${e instanceof Error ? e.message : e})`);
  });
  if (!response.ok) throw new Error(`the rates service answered ${response.status}`);
  const fresh = parseRates(await response.json(), Date.now());
  await storage.set("rates", fresh);
  return fresh;
}

/** Current rates; stale ones while new ones download, so offline use keeps working. */
async function currentRates(): Promise<Rates> {
  rates ??= (await storage.get<Rates>("rates")) ?? undefined;
  const stale = !rates || Date.now() - rates.fetched > MAX_AGE;
  if (stale && !download && Date.now() - lastAttempt > RETRY_AFTER) {
    lastAttempt = Date.now();
    download = fetchRates()
      .then((fresh) => {
        lastError = undefined;
        return (rates = fresh);
      })
      .catch((e) => {
        lastError = e instanceof Error ? e.message : String(e);
        throw e;
      })
      .finally(() => (download = undefined));
    // Failures are reported when there is nothing to show instead.
    download.catch(() => {});
  }
  if (rates) return rates;
  if (download) return await download;
  // A failed download is tried again a minute later, not on every keystroke.
  throw new Error(lastError ?? "no exchange rates yet");
}

/** Resolves with `promise`, or rejects as soon as `signal` aborts (the user typed again). */
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}

export default answer(async (query, { signal }) => {
  const request = parse(query);
  if (!request) return null;
  const { amount, from, to } = request;
  let current: Rates;
  try {
    current = await until(currentRates(), signal);
  } catch (e) {
    if (signal.aborted) throw e;
    return {
      id: "unavailable",
      title: "Exchange rates unavailable",
      subtitle: e instanceof Error ? e.message : String(e),
      icon: { source: Icons.wifiOff, tint: "red" },
    };
  }
  const value = convert(current, amount, from, to);
  if (value === undefined) return null;
  const result = `${value.toFixed(2)} ${to}`;
  const full = `${amount} ${from} = ${result}`;
  return {
    id: "result",
    title: result,
    subtitle: full,
    icon: { source: Icons.coin, tint: "orange" },
    detail: {
      metadata: [
        { label: "Source", value: "European Central Bank" },
        { label: "Rates of", value: current.date },
      ],
    },
    actions: [copy(result, "Copy Result"), copy(full, "Copy Full Answer")],
  };
}, { placeholder: "20 € en $, 100 chf in jpy…" });
