import { clipboard, run } from "@backslash/api";
import { diceNotation, parseDice, roll, rollBreakdown } from "../lib.ts";

// "Roll Dice  2d6+3": flashes the total with the dice, and copies the total.
export default run<{ dice?: string }>(async ({ args }) => {
  const text = String(args.dice ?? "").trim() || "1d6";
  const dice = parseDice(text);
  if (!dice) throw new Error(`“${text}” isn't dice notation: try 2d6+3, d20 or 4d6kh3`);
  const r = roll(dice);
  await clipboard.write(String(r.total));
  return dice.count === 1 && !dice.modifier
    ? `${diceNotation(dice)}: ${r.total}`
    : `${diceNotation(dice)}: ${r.total}  ${rollBreakdown(r)}`;
});
