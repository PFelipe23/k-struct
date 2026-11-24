import { parseUnitNumber } from "../units";

export function parseNumberInput(text: string) {
  return parseUnitNumber(text) ?? NaN;
}
