import { close, type Context, detail, field, form, storage } from "@backslash/api";
import { AuthError, needToken, setupItems } from "../api.ts";
import { appendToPage, BLOCK_TYPES, type Page, search, titleOf } from "../lib.ts";

export default async ({ preferences }: Context) => {
  let token: string;
  let pages: Page[];
  try {
    token = needToken(preferences);
    pages = await search(token, "", "page", undefined, 50) as Page[];
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const [setup] = setupItems(e);
    return detail({ title: "Connect Notion", markdown: setup.detail!.markdown!, actions: setup.actions });
  }
  if (!pages.length) {
    throw new Error("No page is shared with the integration: in Notion, ••• → Connections → add it");
  }
  const last = await storage.get<string>("lastPage").catch(() => undefined);
  const options = pages.map((p) => ({
    value: p.id,
    title: `${p.icon?.type === "emoji" ? `${p.icon.emoji} ` : ""}${titleOf(p)}`,
  }));
  return form({
    title: "Add to Notion page",
    submitTitle: "Add",
    fields: [
      field.dropdown("page", "Page", options, { value: pages.some((p) => p.id === last) ? last : pages[0].id }),
      field.textArea("text", "Text", { required: true, placeholder: "Appended at the end of the page" }),
      field.dropdown("type", "As", BLOCK_TYPES, { value: "paragraph" }),
    ],
    async submit(values) {
      const page = pages.find((p) => p.id === values.page) ?? pages[0];
      await appendToPage(token, page.id, String(values.text), String(values.type));
      await storage.set("lastPage", page.id).catch(() => {});
      return close(`Added to ${titleOf(page)}`);
    },
  });
};
