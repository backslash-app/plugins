// The forms that add, edit and block, shared by the commands.

import { close, field, form, type FormSpec, type Outcome, pop, toast } from "@backslash/api";
import { addEntry, blockNames, editEntry, type Entry, entryProblem, findHost, splitHostnames } from "./lib.ts";
import { read, write } from "./system.ts";

/** After a change: back to the list (which reloads), or close when the form was the command. */
const done = (standalone: boolean, message: string): Promise<Outcome> =>
  standalone ? Promise.resolve(close(message)) : toast(message, { style: "success" }).then(() => pop());

export function entryForm(
  o: { standalone: boolean; edit?: { index: number; entry: Entry }; ip?: string; hosts?: string },
): FormSpec {
  const e = o.edit?.entry;
  return form({
    title: e ? "Edit Hosts Entry" : "Add Hosts Entry",
    submitTitle: e ? "Save" : "Add",
    fields: [
      field.text("ip", "IP address", {
        placeholder: "192.168.1.10, 127.0.0.1 or ::1",
        required: true,
        value: e?.ip ?? o.ip ?? "",
      }),
      field.text("hosts", "Host names", {
        placeholder: "nas.lan nas (separated by spaces)",
        required: true,
        value: e?.hosts.join(" ") ?? o.hosts ?? "",
      }),
      field.text("comment", "Comment", { placeholder: "What it is", value: e?.comment ?? "" }),
    ],
    async submit(values) {
      const ip = String(values.ip ?? "").trim();
      const hosts = splitHostnames(String(values.hosts ?? ""));
      const comment = String(values.comment ?? "").trim() || undefined;
      const problem = entryProblem(ip, hosts);
      if (problem) throw new Error(problem);
      const { text, file } = await read();
      if (o.edit) {
        await write(text, editEntry(file, o.edit.index, o.edit.entry.raw, ip, hosts, comment));
        return done(o.standalone, `${hosts[0]} saved`);
      }
      const already = hosts.flatMap((h) => findHost(file, h).map((x) => `${h} → ${x.entry.ip}`));
      await write(text, addEntry(file, ip, hosts, comment));
      if (already.length) {
        await toast("Added; earlier entries win", {
          style: "info",
          message: `Already in the file: ${already.join(", ")}`,
        });
      }
      return done(o.standalone, `${hosts.join(", ")} → ${ip}`);
    },
  });
}

/** Points a domain (and www.) at 0.0.0.0. */
export async function block(domain: string, www: boolean): Promise<string> {
  const names = blockNames(domain, www);
  if (!names.length) throw new Error("Type a domain to block, e.g. example.com");
  const problem = entryProblem("0.0.0.0", names);
  if (problem) throw new Error(problem);
  const { text, file } = await read();
  const fresh = names.filter((n) => !findHost(file, n).some((x) => x.entry.ip === "0.0.0.0"));
  if (!fresh.length) return `${names[0]} is already blocked`;
  await write(text, addEntry(file, "0.0.0.0", fresh, "blocked with Backslash"));
  return `${fresh.join(" and ")} blocked`;
}

export function blockForm(standalone: boolean, domain = ""): FormSpec {
  return form({
    title: "Block a Domain",
    submitTitle: "Block",
    fields: [
      field.text("domain", "Domain", { placeholder: "ads.example.com", required: true, value: domain }),
      field.checkbox("www", "Also block www.", { value: true }),
    ],
    async submit(values) {
      const message = await block(String(values.domain ?? ""), values.www === true);
      return done(standalone, message);
    },
  });
}
