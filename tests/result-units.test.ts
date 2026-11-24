import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beamExample, type ResultCombination } from "../src/domain/model";
import { combineLinearResults } from "../src/solver/combinations";
import { evaluateMemberEnvelope } from "../src/solver/envelopes";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { DEFAULT_UNITS, type UnitPreferences } from "../src/units";
import { buildEnvelopeCsv } from "../src/components/EnvelopeResults";
import { buildResultCsv, buildResultTable } from "../src/components/Results";
import { getSlabQuantityDefinition } from "../src/components/SlabResults";
import {
  forceQuantity,
  formatResult,
  formatResultQuantity,
  getForceLabel,
} from "../src/components/resultFormatting";

const output = readFileSync(
  new URL("./fixtures/beam-oofem.txt", import.meta.url),
  "utf8",
);

const alternate: UnitPreferences = {
  ...DEFAULT_UNITS,
  length: "cm",
  displacement: "m",
  force: "N",
  moment: "N·m",
};

function reference() {
  const project = beamExample();
  const result = parseOofemOutput(output, exportOofem(project, "EL"));
  const view = {
    kind: "case" as const,
    definition: project.analysisCases[0],
    result,
  };
  return { project, result, view };
}

describe("unidades dos resultados de referência", () => {
  // Referência gerada pelo código e9e2821 com a saída OOFEM guardada no repositório.
  it.each([
    [
      "reactions",
      "6c3a4bddad20cdc04df90d808f876648eac9a4bd86b9e5ccdd02c1f67560e2b6",
    ],
    [
      "displacements",
      "c0f94ca2e494ee3c845cecb1f28323339e238df2ccf5ad41369731655a3d5423",
    ],
    [
      "forces",
      "2e3bfcbac46a747e4f2ea4dd42486512dc3e77f4e41c69fb889201a5110880f4",
    ],
  ])("mantém todos os bytes do CSV padrão: %s", (tab, expectedHash) => {
    const { project, view } = reference();
    expect(
      createHash("sha256")
        .update(buildResultCsv(project, view, tab))
        .digest("hex"),
    ).toBe(expectedHash);
  });
  it("preserva integralmente o CSV padrão das reações, incluindo a origem", () => {
    const { project, view } = reference();
    expect(buildResultCsv(project, view, "reactions")).toBe(
      '\uFEFF"Nó";"RX (kN)";"RZ (kN)";"MY (kN·m)";"Caso";"ID do caso"\n' +
        '"N1";0;30;0;"EL · Estática linear";"EL"\n' +
        '"N2";0;30;0;"EL · Estática linear";"EL"',
    );
  });

  it("converte reações e momentos separadamente e conserva o resultado SI", () => {
    const { project, result } = reference();
    const original = structuredClone(result);
    const table = buildResultTable(project, "reactions", result, "", {
      ...alternate,
      moment: "kN·m",
    });
    expect(table.headers).toEqual(["Nó", "RX (N)", "RZ (N)", "MY (kN·m)"]);
    expect(table.rows[0]).toEqual(["N1", 0, 30000, 0]);
    expect(result).toEqual(original);
  });

  it("mantém precisão e mrad ao apresentar a flecha em metros", () => {
    const { project, result, view } = reference();
    const standard = buildResultTable(project, "displacements", result);
    const table = buildResultTable(
      project,
      "displacements",
      result,
      "",
      alternate,
    );
    expect(table.headers).toEqual([
      "Nó / estação",
      "UX (m)",
      "UZ (m)",
      "RY (mrad)",
    ]);
    const middle = table.rows.find(([name]) => name === "B1 · x/L 0.5")!;
    expect(middle[2]).toBe(-0.0084375);
    expect(
      formatResultQuantity(middle[2] as number, "displacement", alternate),
    ).toBe("-0,0084375");
    expect(table.rows.map((row) => row[3])).toEqual(
      standard.rows.map((row) => row[3]),
    );
    const csv = buildResultCsv(project, view, "displacements", "", alternate);
    expect(csv).toContain('"UZ (m)";"RY (mrad)"');
    expect(csv).toContain(
      ';0;-0.0084375;-1.8393781500000002e-14;"EL · Estática linear";"EL"',
    );
  });

  it("converte o esforço sem alterar estações, filtro de barra ou origem", () => {
    const { project, result, view } = reference();
    const table = buildResultTable(project, "forces", result, "V1", alternate);
    expect(table.headers).toEqual([
      "Barra",
      "x/L",
      "N (N)",
      "V (N)",
      "M (N·m)",
    ]);
    expect(table.rows).toHaveLength(9);
    expect(table.rows[4]).toEqual(["B1", 0.5, 0, 4.8658e-10, 45000]);
    expect(
      buildResultTable(project, "forces", result, "absent", alternate).rows,
    ).toEqual([]);
    const csv = buildResultCsv(project, view, "forces", "V1", alternate);
    expect(csv).toContain(
      '"B1";0.5;0;4.8658e-10;45000;"EL · Estática linear";"EL"',
    );
    expect(buildResultCsv(project, view, "forces", "V1")).toContain(
      '"B1";0.5;0;4.8658e-13;45;"EL · Estática linear";"EL"',
    );
  });

  it("conserva IDs, fatores e números não arredondados no CSV de combinação", () => {
    const { project, result } = reference();
    const definition: ResultCombination = {
      id: "C1",
      name: "Combinação de referência",
      type: "linear",
      factors: [{ caseId: "EL", factor: 1.23456789 }],
    };
    const combined = combineLinearResults(
      project,
      definition,
      new Map([["EL", result]]),
    );
    const view = {
      kind: "combination" as const,
      definition,
      result: combined,
      problem: "",
    };
    const csv = buildResultCsv(project, view, "forces", "V1", alternate);
    expect(csv).toContain(
      '"Combinação";"ID da combinação";"Parcelas (ID do caso e fator)"',
    );
    expect(csv).toContain(
      ';55555.555049999995;"Combinação de referência";"C1";',
    );
    expect(csv).toContain('"[{""caseId"":""EL"",""factor"":1.23456789}]"');
  });

  it("preserva estações, extremos, composição governante e simultaneidade no envelope", async () => {
    const { project, result } = reference();
    project.resultCombinations = [
      {
        id: "POS",
        name: "Positiva",
        type: "linear",
        factors: [{ caseId: "EL", factor: 1 }],
      },
      {
        id: "NEG",
        name: "Negativa",
        type: "linear",
        factors: [{ caseId: "EL", factor: -2 }],
      },
    ];
    const definition = {
      id: "E1",
      name: "Envelope",
      combinationIds: ["POS", "NEG"],
    };
    const envelope = await evaluateMemberEnvelope(
      project,
      definition,
      new Map([["EL", result]]),
    );
    const original = structuredClone(envelope);
    const standard = buildEnvelopeCsv(project, definition, envelope, "m");
    // Referência de todos os bytes exportados por e9e2821 para este envelope.
    expect(createHash("sha256").update(standard).digest("hex")).toBe(
      "ba81726f0b4eccac4ce538f2c9600aeec1efae482d0fefba86b9ea56810fd7e2",
    );
    const csv = buildEnvelopeCsv(project, definition, envelope, "m", alternate);
    expect(csv).toContain('"N (N)";"V (N)";"M (N·m)"');
    expect(csv).toContain(
      ';0.5;"M";"Mínimo";"Negativa";"NEG";0;-9.7316e-10;-90000;',
    );
    expect(csv).toContain(
      ';0.5;"M";"Máximo";"Positiva";"POS";0;4.8658e-10;45000;',
    );
    expect(standard).toContain(
      ';0.5;"M";"Mínimo";"Negativa";"NEG";0;-9.7316e-13;-90;',
    );
    expect(csv).toContain('"[{""caseId"":""EL"",""factor"":-2}]"');
    expect(csv).toContain('"[""POS"",""NEG""]"');
    expect(envelope).toEqual(original);
  });

  it("identifica corretamente forças e momentos planos e espaciais", () => {
    expect(formatResult(4.8658e-13)).toBe("0");
    for (const component of ["n", "v", "vy", "vz"] as const) {
      expect(forceQuantity(component)).toBe("force");
      expect(getForceLabel(component, alternate).unit).toBe("N");
    }
    for (const component of ["m", "mx", "my", "mz"] as const) {
      expect(forceQuantity(component)).toBe("moment");
      expect(getForceLabel(component, alternate).unit).toBe("N·m");
    }
  });

  it("exibe a flecha da placa na preferência e momentos por metro explícito", () => {
    expect(getSlabQuantityDefinition("slab-uz", alternate)).toMatchObject({
      field: "uz",
      quantity: "displacement",
      factor: 1,
      unit: "m",
    });
    for (const display of ["slab-mx", "slab-my"] as const) {
      expect(getSlabQuantityDefinition(display, alternate)).toMatchObject({
        quantity: "moment",
        factor: 1,
        unit: "N·m/m",
      });
      expect(getSlabQuantityDefinition(display)).toMatchObject({
        factor: 0.001,
        unit: "kN·m/m",
      });
    }
  });
});
