import { answer, copy, Icons } from "@backslash/api";
import { evaluate, format } from "../lib.ts";

export default answer((query) => {
  const expression = query.trim();
  const value = evaluate(expression);
  if (value === undefined) return null;
  const result = format(value);
  return {
    id: "result",
    title: result,
    subtitle: expression,
    icon: { source: Icons.calculator, tint: "orange" },
    detail: { metadata: [{ label: "Expression", value: expression }] },
    actions: [copy(result, "Copy Result"), copy(`${expression} = ${result}`, "Copy Full Answer")],
  };
}, { placeholder: "12*(3+4), sqrt(2)/2, 2pi…" });
