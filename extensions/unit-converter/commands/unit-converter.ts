import { answer, copy, Icons } from "@backslash/api";
import { convert, format, parse } from "../lib.ts";

export default answer((query) => {
  const request = parse(query);
  if (!request) return null;
  const { value, from, to } = request;
  const result = `${format(convert(value, from, to))} ${to.symbol}`;
  const full = `${format(value)} ${from.symbol} = ${result}`;
  return {
    id: "result",
    title: result,
    subtitle: full,
    icon: { source: Icons.calculator, tint: "orange" },
    actions: [copy(result, "Copy Result"), copy(full, "Copy Full Answer")],
  };
}, { placeholder: "5 km in miles, 72 f to c, 2 GiB en MB…" });
