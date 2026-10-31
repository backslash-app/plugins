import { Icons, list, updateCommandMetadata } from "@backslash/api";
import { bookings, each } from "../api.ts";
import { type Account, accountsOf, attendeeSummary, SetupError, setupItem, untilLabel } from "../lib.ts";
import { bookingItem, report } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter bookings by title, attendee or email…",
  status: () => status,
  empty: {
    title: "Nothing booked",
    description: "No upcoming meeting on Cal.com or Calendly. Share a link from Scheduling Links.",
    icon: Icons.calendar,
  },
  async items({ preferences, signal, launchType }) {
    let accounts: Account[];
    try {
      accounts = accountsOf(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const r = await each(accounts, (a) => bookings(a, signal));
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    const all = r.ok.flatMap((x) => x.value.map((b) => ({ account: x.account, booking: b })))
      .sort((x, y) => x.booking.start.localeCompare(y.booking.start));
    const next = all[0]?.booking;
    status = all.length ? `${all.length} upcoming` : "";
    if (launchType !== "background") {
      await updateCommandMetadata({
        subtitle: next
          ? `Next: ${next.title}${attendeeSummary(next) ? ` with ${attendeeSummary(next)}` : ""} ${
            untilLabel(next.start, next.end)
          }`
          : null,
      }).catch(() => {});
    }
    return all.map((x) => bookingItem(x.account, x.booking, many));
  },
});
