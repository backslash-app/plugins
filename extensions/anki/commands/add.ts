import { type Context, list } from "@backslash/api";
import { addCardForm, OfflineError, offlineItems } from "../anki.ts";

export default async (ctx: Context) => {
  try {
    return await addCardForm(ctx, { front: ctx.query.trim() || undefined, standalone: true });
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    return list({ items: await offlineItems(ctx) });
  }
};
