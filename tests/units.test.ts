import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNITS,
  QUANTITY_LABELS,
  UNIT_OPTIONS,
  formatQuantity,
  formatUnitInput,
  formatUnitValue,
  fromSI,
  parseUnitInput,
  parseUnitNumber,
  parseUnitPreferences,
  toSI,
  unitLabel,
  type UnitPreferences,
  type UnitQuantity,
} from "../src/units";

describe("unidades de apresentação", () => {
  it("preserva os padrões e oferece rótulos para todas as grandezas", () => {
    expect(DEFAULT_UNITS).toEqual({
      length: "m",
      section: "cm",
      displacement: "mm",
      force: "kN",
      moment: "kN·m",
      distributedLoad: "kN/m",
      modulus: "GPa",
    });
    for (const quantity of Object.keys(DEFAULT_UNITS) as UnitQuantity[]) {
      expect(unitLabel(quantity)).toBe(DEFAULT_UNITS[quantity]);
      expect(QUANTITY_LABELS[quantity]).toBeTruthy();
      expect(UNIT_OPTIONS[quantity]).toContainEqual({
        value: DEFAULT_UNITS[quantity],
        label: DEFAULT_UNITS[quantity],
      });
    }
  });

  it.each(["m", "cm", "mm"] as const)(
    "troca a apresentação do vão para %s mantendo 6 m no domínio",
    (length) => {
      const units = { ...DEFAULT_UNITS, length };
      const expected = { m: 6, cm: 600, mm: 6000 }[length];
      expect(fromSI(6, "length", units)).toBe(expected);
      expect(toSI(expected, "length", units)).toBe(6);
      expect(formatUnitInput(6, "length", units)).toBe(String(expected));
    },
  );

  it("converte dimensões de seção e módulo sem alterar valores SI", () => {
    expect(fromSI(0.15, "section")).toBe(15);
    expect(toSI(20, "section")).toBe(0.2);
    expect(fromSI(200e9, "modulus")).toBe(200);
    expect(fromSI(200e9, "modulus", { ...DEFAULT_UNITS, modulus: "MPa" })).toBe(
      200000,
    );
    expect(toSI(200000, "modulus", { ...DEFAULT_UNITS, modulus: "MPa" })).toBe(
      200e9,
    );
  });

  it("converte forças, momentos e cargas distribuídas preservando o sinal", () => {
    expect(fromSI(30000, "force")).toBe(30);
    expect(fromSI(45000, "moment")).toBe(45);
    expect(fromSI(-10000, "distributedLoad")).toBe(-10);
    expect(toSI(30, "force")).toBe(30000);
    expect(toSI(45, "moment")).toBe(45000);
    expect(toSI(-10, "distributedLoad")).toBe(-10000);
    const baseUnits: UnitPreferences = {
      ...DEFAULT_UNITS,
      force: "N",
      moment: "N·m",
      distributedLoad: "N/m",
    };
    expect(fromSI(30000, "force", baseUnits)).toBe(30000);
    expect(fromSI(45000, "moment", baseUnits)).toBe(45000);
    expect(fromSI(-10000, "distributedLoad", baseUnits)).toBe(-10000);
  });

  it("confere ida e volta para todas as opções sem arredondar entradas", () => {
    for (const quantity of Object.keys(DEFAULT_UNITS) as UnitQuantity[]) {
      for (const option of UNIT_OPTIONS[quantity]) {
        const units = { ...DEFAULT_UNITS, [quantity]: option.value };
        for (const valueSI of [
          0, -0.0084375, 0.123456789012345, 30000, 200e9,
        ]) {
          const display = fromSI(valueSI, quantity, units);
          expect(toSI(display, quantity, units)).toBeCloseTo(valueSI, 10);
          expect(
            parseUnitNumber(formatUnitInput(valueSI, quantity, units)),
          ).toBe(display);
        }
      }
    }
    expect(formatUnitInput(0.123456789012345, "length")).toBe(
      "0.123456789012345",
    );
  });

  it("mostra a flecha de referência com precisão em português brasileiro", () => {
    expect(fromSI(-0.0084375, "displacement")).toBe(-8.4375);
    expect(formatQuantity(-0.0084375, "displacement")).toBe("-8,4375");
    expect(
      formatQuantity(-0.0084375, "displacement", {
        ...DEFAULT_UNITS,
        displacement: "m",
      }),
    ).toBe("-0,0084375");
    expect(formatQuantity(1e-10, "length")).toBe("0,0000000001");
    expect(formatQuantity(-0, "length")).toBe("0");
    expect(formatQuantity(Number.NaN, "length")).toBe("—");
    expect(formatUnitValue(-0.0084375)).toBe("-0,0084375");
  });

  it("mantém as operações anteriores na conversão de resultados padrão", () => {
    for (const value of [-0.0084375, 0.123456789012345, -987654321.12345]) {
      expect(fromSI(value, "displacement")).toBe(value * 1000);
      expect(fromSI(value, "force")).toBe(value / 1000);
      expect(fromSI(value, "moment")).toBe(value / 1000);
      expect(fromSI(value, "distributedLoad")).toBe(value / 1000);
    }
  });
});

describe("entrada decimal", () => {
  it.each([
    ["6", 6],
    [" -8,4375 ", -8.4375],
    ["+8.4375", 8.4375],
    [",15", 0.15],
    [".15", 0.15],
    ["1,234", 1.234],
    ["1.234", 1.234],
    ["2,5e-3", 0.0025],
  ])("aceita %s como decimal sem agrupamento", (text, expected) => {
    expect(parseUnitNumber(text as string)).toBe(expected);
  });

  it.each([
    "",
    " ",
    ",",
    ".",
    "1.234,5",
    "1,234.5",
    "1.234.567",
    "1,234,567",
    "1 000",
    "1\u00a0000",
    "10 kN",
    "0x10",
    "1_000",
    "1/2",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e309",
  ])("rejeita entrada inválida, não finita ou agrupada: %s", (text) => {
    expect(parseUnitNumber(text)).toBeNull();
  });

  it("interpreta texto na unidade escolhida e rejeita conversões não finitas", () => {
    expect(parseUnitInput("-8,4375", "displacement")).toBe(-0.0084375);
    expect(parseUnitInput("30", "force")).toBe(30000);
    expect(parseUnitInput("inválido", "length")).toBeNull();
    expect(parseUnitInput("1e308", "modulus")).toBeNull();
    expect(parseUnitInput("31", "force", DEFAULT_UNITS, 30000)).toBe(31000);
  });

  it("preserva exatamente o SI ao confirmar uma entrada sem alteração", () => {
    for (const quantity of Object.keys(DEFAULT_UNITS) as UnitQuantity[]) {
      for (const option of UNIT_OPTIONS[quantity]) {
        const units = { ...DEFAULT_UNITS, [quantity]: option.value };
        for (const originalSI of [
          -0,
          Number.MIN_VALUE,
          0.1 + Number.EPSILON,
          -0.0084375,
          0.123456789012345,
          30000.000000000004,
          200000000000.00003,
        ]) {
          const text = formatUnitInput(originalSI, quantity, units);
          expect(parseUnitInput(text, quantity, units, originalSI)).toBe(
            originalSI,
          );
          expect(
            parseUnitInput(text.replace(".", ","), quantity, units, originalSI),
          ).toBe(originalSI);
        }
      }
    }
  });
});

describe("preferências locais", () => {
  it("valida cada escolha e completa opções ausentes com os padrões", () => {
    expect(
      parseUnitPreferences({
        length: "mm",
        section: "m",
        force: "N",
        moment: "N·m",
        distributedLoad: "N/m",
        modulus: "MPa",
        displacement: "pol",
        extra: "ignorado",
      }),
    ).toEqual({
      length: "mm",
      section: "m",
      displacement: "mm",
      force: "N",
      moment: "N·m",
      distributedLoad: "N/m",
      modulus: "MPa",
    });
    expect(
      parseUnitPreferences({ length: "CM", section: 100, force: "toString" }),
    ).toEqual(DEFAULT_UNITS);
  });

  it.each([null, undefined, "mm", 1, true, [], new Date()])(
    "usa padrões seguros para um valor que não é um objeto simples: %s",
    (value) => {
      const parsed = parseUnitPreferences(value);
      expect(parsed).toEqual(DEFAULT_UNITS);
      expect(parsed).not.toBe(DEFAULT_UNITS);
    },
  );

  it("ignora herança, propriedades especiais e getters", () => {
    expect(parseUnitPreferences(Object.create({ force: "N" }))).toEqual(
      DEFAULT_UNITS,
    );
    expect(
      parseUnitPreferences(
        JSON.parse('{"__proto__":{"force":"N"},"length":"cm"}'),
      ),
    ).toEqual({ ...DEFAULT_UNITS, length: "cm" });
    const getter = Object.defineProperty({}, "force", {
      get() {
        throw new Error("Não deve executar");
      },
    });
    expect(parseUnitPreferences(getter)).toEqual(DEFAULT_UNITS);
    expect(
      parseUnitPreferences(Object.assign(Object.create(null), { force: "N" })),
    ).toEqual({ ...DEFAULT_UNITS, force: "N" });
  });
});
