export type UnitQuantity =
  | "length"
  | "section"
  | "displacement"
  | "force"
  | "moment"
  | "distributedLoad"
  | "modulus";

export interface UnitPreferences {
  length: "m" | "cm" | "mm";
  section: "m" | "cm" | "mm";
  displacement: "m" | "cm" | "mm";
  force: "N" | "kN";
  moment: "N·m" | "kN·m";
  distributedLoad: "N/m" | "kN/m";
  modulus: "MPa" | "GPa";
}

export const DEFAULT_UNITS: UnitPreferences = Object.freeze({
  length: "m",
  section: "cm",
  displacement: "mm",
  force: "kN",
  moment: "kN·m",
  distributedLoad: "kN/m",
  modulus: "GPa",
});

interface UnitDefinition {
  readonly value: string;
  readonly label: string;
  /** Valor de uma unidade de exibição na unidade SI da grandeza. */
  readonly si: number;
}

const lengthUnits = [
  { value: "m", label: "m", si: 1 },
  { value: "cm", label: "cm", si: 0.01 },
  { value: "mm", label: "mm", si: 0.001 },
] as const;

// Opções e conversões derivam da mesma definição para cada grandeza.
const definitions = {
  length: lengthUnits,
  section: lengthUnits,
  displacement: lengthUnits,
  force: [
    { value: "N", label: "N", si: 1 },
    { value: "kN", label: "kN", si: 1000 },
  ],
  moment: [
    { value: "N·m", label: "N·m", si: 1 },
    { value: "kN·m", label: "kN·m", si: 1000 },
  ],
  distributedLoad: [
    { value: "N/m", label: "N/m", si: 1 },
    { value: "kN/m", label: "kN/m", si: 1000 },
  ],
  modulus: [
    { value: "MPa", label: "MPa", si: 1e6 },
    { value: "GPa", label: "GPa", si: 1e9 },
  ],
} as const satisfies Record<UnitQuantity, readonly UnitDefinition[]>;

type UnitOptions = {
  readonly [Q in UnitQuantity]: readonly {
    readonly value: UnitPreferences[Q];
    readonly label: string;
  }[];
};

function publicOptions<T extends string>(
  options: readonly { readonly value: T; readonly label: string }[],
) {
  return options.map(({ value, label }) => ({ value, label }));
}

export const UNIT_OPTIONS: UnitOptions = {
  length: publicOptions(definitions.length),
  section: publicOptions(definitions.section),
  displacement: publicOptions(definitions.displacement),
  force: publicOptions(definitions.force),
  moment: publicOptions(definitions.moment),
  distributedLoad: publicOptions(definitions.distributedLoad),
  modulus: publicOptions(definitions.modulus),
};

export const QUANTITY_LABELS: Record<UnitQuantity, string> = {
  length: "Comprimentos",
  section: "Dimensões de seção",
  displacement: "Deslocamentos",
  force: "Forças",
  moment: "Momentos",
  distributedLoad: "Cargas distribuídas",
  modulus: "Módulo de elasticidade",
};

function selectedUnit(quantity: UnitQuantity, units: UnitPreferences) {
  const unit = definitions[quantity].find(
    (option) => option.value === units[quantity],
  );
  if (!unit) throw new Error(`Unidade inválida para ${quantity}.`);
  return unit;
}

export function unitLabel(
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
): string {
  return selectedUnit(quantity, units).label;
}

export function fromSI(
  valueSI: number,
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
): number {
  const factor = selectedUnit(quantity, units).si;
  return factor < 1 ? valueSI * (1 / factor) : valueSI / factor;
}

export function toSI(
  valueDisplay: number,
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
): number {
  const factor = selectedUnit(quantity, units).si;
  return factor < 1 ? valueDisplay / (1 / factor) : valueDisplay * factor;
}

/** Vírgula e ponto são decimais; agrupamentos de milhares não são aceitos. */
export function parseUnitNumber(text: string): number | null {
  const normalized = text.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(normalized))
    return null;
  const value = Number(normalized.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Uma entrada sem alteração conserva o SI original, inclusive seus últimos bits. */
export function parseUnitInput(
  text: string,
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
  originalSI?: number,
): number | null {
  const display = parseUnitNumber(text);
  if (display === null) return null;
  if (
    originalSI !== undefined &&
    Number.isFinite(originalSI) &&
    display === fromSI(originalSI, quantity, units)
  )
    return originalSI;
  const valueSI = toSI(display, quantity, units);
  return Number.isFinite(valueSI) ? valueSI : null;
}

/** O texto editável mantém a precisão do Number; o arredondamento é só visual. */
export function formatUnitInput(
  valueSI: number,
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
): string {
  return String(fromSI(valueSI, quantity, units));
}

const displayNumber = new Intl.NumberFormat("pt-BR", {
  maximumSignificantDigits: 12,
  useGrouping: false,
});

export function formatUnitValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return displayNumber.format(Object.is(value, -0) ? 0 : value);
}

/** Retorna somente o número. O rótulo da unidade vem de unitLabel. */
export function formatQuantity(
  valueSI: number,
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
): string {
  return formatUnitValue(fromSI(valueSI, quantity, units));
}

export function parseUnitPreferences(value: unknown): UnitPreferences {
  const parsed = { ...DEFAULT_UNITS };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return parsed;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return parsed;

  function readPreference<Q extends UnitQuantity>(quantity: Q) {
    // Não lê valores herdados nem executa getters de um objeto externo.
    const candidate = Object.getOwnPropertyDescriptor(value, quantity)?.value;
    const option = UNIT_OPTIONS[quantity].find(
      (entry) => entry.value === candidate,
    );
    if (option) parsed[quantity] = option.value;
  }

  for (const quantity of Object.keys(DEFAULT_UNITS) as UnitQuantity[])
    readPreference(quantity);
  return parsed;
}
