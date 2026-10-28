import type { Context } from "@backslash/api";
import { countdownForm } from "../countdowns.ts";

// "Add Countdown Vacation" opens the form with the title filled in.
export default (ctx: Context) => countdownForm({ title: ctx.query.trim(), standalone: true });
