export function parseNumberInput(text: string) {
  const value = text.trim();
  return value ? Number(value.replace(",", ".")) : NaN;
}
