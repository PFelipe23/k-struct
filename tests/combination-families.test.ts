import { describe, expect, it } from "vitest";
import {
  acceptFamilies,
  formulaFields,
  generationKey,
  proposeFamilies,
  reviewFamilies,
  rowFormula,
  type FamilyModel,
} from "../src/domain/combinationFamilies";
import {
  parseProject,
  referenceErrors,
  serializeProject,
  uid,
} from "../src/domain/model";
import {
  combineLinearResults,
  requiredCaseIds,
} from "../src/solver/combinations";
import { evaluateMemberEnvelope } from "../src/solver/envelopes";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { familyBeam, testProfile } from "./fixtures/combination-families";
import { runDeck } from "./fixtures/solve-oofem";

function setup() {
  const p = familyBeam(),
    profile = testProfile(p);
  return { p, profile, preview: () => proposeFamilies(p, profile) };
}
describe("famílias ELU e ELS com coeficientes ilustrativos", () => {
  it("alterna a variável principal e pondera os casos com os valores próprios de cada família", () => {
    const { preview } = setup();
    const values = preview().map((row) => [row.name, row.factors]);
    expect(values).toEqual([
      ["ELU · Q1", { G: "1.2", Q1: "1.5", Q2: "0.75" }],
      ["ELU · Q2", { G: "1.2", Q1: "0.75", Q2: "1.5" }],
      ["ELS · Q1", { G: "1", Q1: "1", Q2: "0.3" }],
      ["ELS · Q2", { G: "1", Q1: "0.3", Q2: "1" }],
    ]);
  });
  it("combina alternativas de grupos, conserva identidades com a inversão da ordem e dispensa a variável excluída", () => {
    const { p, profile, preview } = setup();
    const before = preview()
      .map((r) => generationKey(r.generation))
      .sort();
    profile.actions[1].group = " Vento ";
    profile.actions[2].group = "vento";
    const rows = preview();
    expect(rows.map((r) => generationKey(r.generation)).sort()).toEqual(before);
    expect(rows.find((r) => r.name === "ELU · Q1")!.factors).toEqual({
      G: "1.2",
      Q1: "1.5",
    });
    expect(rows.find((r) => r.name === "ELU · Q2")!.factors).toEqual({
      G: "1.2",
      Q2: "1.5",
    });
    const more = structuredClone(p.analysisCases[1]);
    more.id = "R";
    more.name = "R";
    p.analysisCases.push(more);
    profile.actions.push({ caseId: "R", role: "variable", group: "" });
    const alternatives = preview().filter(
      (r) => r.generation.leadingId === "R" && r.generation.kind === "ELU",
    );
    expect(alternatives.map((r) => r.factors)).toEqual([
      { G: "1.2", Q1: "0.75", R: "1.5" },
      { G: "1.2", Q2: "0.75", R: "1.5" },
    ]);
    const keys = preview()
      .map((r) => generationKey(r.generation))
      .sort();
    p.analysisCases.reverse();
    expect(
      preview()
        .map((r) => generationKey(r.generation))
        .sort(),
    ).toEqual(keys);
  });
  it("valida sobreposição de padrões, exclusão após edição, fatores, referências e ausência de carga", () => {
    const { p, profile, preview } = setup();
    profile.actions[1].group = profile.actions[2].group = "direções";
    const rows = preview(),
      row = rows[0];
    const error = () =>
      reviewFamilies(p, profile, rows).checks[0].errors.join(" ");
    row.factors.Q2 = "0.5";
    expect(error()).toMatch(/mutuamente exclusivos/);
    row.factors.Q2 = "0";
    p.analysisCases[1].factors.push({ patternId: "PG", factor: 2 });
    expect(error()).toMatch(/Padrão G ponderado em dois casos/);
    expect(() => acceptFamilies(p, profile, rows, uid)).toThrow(
      /ponderado em dois casos/,
    );
    p.analysisCases[1].factors.pop();
    row.factors.G = "";
    expect(error()).toMatch(/fator inválido/);
    row.factors = { Q1: "0" };
    expect(error()).toMatch(/diferente de zero/);
    row.factors = { INEXISTENTE: "1" };
    expect(error()).toMatch(/Caso inexistente/);
    row.factors = { Q1: "1" };
    p.analysisCases[1].factors[0].patternId = "AUSENTE";
    expect(error()).toMatch(/padrão inexistente/);
    profile.actions[0].caseId = "ausente";
    expect(preview).toThrow(/caso inexistente/);
  });
  it("identifica duplicatas manuais e entre linhas, independentemente da ordem e da fatoração do padrão", () => {
    const { p, profile, preview } = setup();
    const rows = preview();
    p.resultCombinations[0].factors = [
      ...rowFormula(rows[0]).factors,
    ].reverse();
    expect(reviewFamilies(p, profile, rows).checks[0].errors.join(" ")).toMatch(
      /idêntica.*Manual/,
    );
    rows[0].include = false;
    rows[2].factors = { ...rows[1].factors, Q1: "0,75" };
    expect(reviewFamilies(p, profile, rows).checks[2].errors.join(" ")).toMatch(
      /idêntica/,
    );
    rows[2].include = false;
    expect(acceptFamilies(p, profile, rows, uid)).toHaveLength(3);
    const alias = {
      ...p.analysisCases[0],
      id: "Alias",
      factors: [{ patternId: "PG", factor: 3 }],
    };
    p.analysisCases.push(alias);
    p.resultCombinations[0].factors = [{ caseId: "Alias", factor: 0.4 }];
    rows[0].include = true;
    rows[0].factors = { G: "1.2" };
    expect(reviewFamilies(p, profile, rows).checks[0].errors.join(" ")).toMatch(
      /idêntica.*Manual/,
    );
  });
  it("salva, regenera, protege edições, preserva IDs e mantém referências dos envelopes", () => {
    const { p, profile, preview } = setup();
    const legacy = { ...p, schemaVersion: 22 };
    expect(parseProject(JSON.stringify(legacy))).toEqual(p);
    const rows = preview();
    rows[0].name = "Dimensionamento revisado";
    rows[0].factors.Q1 = "1,6";
    const originalManual = structuredClone(p.resultCombinations[0]);
    p.resultCombinations = acceptFamilies(p, profile, rows, uid);
    p.combinationProfile = profile;
    const id = p.resultCombinations[1].id;
    p.resultEnvelopes[0].combinationIds.push(id);
    const q = parseProject(serializeProject(p));
    expect(q).toEqual(p);
    const changed = structuredClone(profile);
    changed.families[0].leading = 1.7;
    changed.families[1].enabled = false;
    const again = proposeFamilies(q, changed),
      checks = reviewFamilies(q, changed, again);
    expect(checks.checks.map((c) => c.status)).toEqual([
      "Preservar edição",
      "Atualizar",
    ]);
    expect(checks.outside).toHaveLength(2);
    expect(again[0].factors.Q1).toBe("1.6");
    expect(again[0].generation.suggested.factors[1].factor).toBe(1.7);
    Object.assign(again[0], formulaFields(again[0].generation.suggested));
    again[1].include = false;
    q.resultCombinations = acceptFamilies(q, changed, again, uid);
    expect(q.resultCombinations[0]).toEqual(originalManual);
    expect(q.resultCombinations.map((c) => c.id)).toEqual(
      p.resultCombinations.map((c) => c.id),
    );
    expect(q.resultCombinations[1].factors[1].factor).toBe(1.7);
    expect(q.resultCombinations[2]).toEqual(p.resultCombinations[2]);
    expect(q.resultEnvelopes[0].combinationIds).toEqual(["MAN", id]);
    expect(referenceErrors(q)).toEqual([]);
    q.resultCombinations[1].name = "Edição no editor manual";
    expect(proposeFamilies(q, changed)[0].name).toBe("Edição no editor manual");
  });
  it("trata apenas permanentes, casos com fator próprio e protege o limite de alternativas", () => {
    const { p, profile, preview } = setup();
    profile.actions.splice(1);
    profile.families.splice(1);
    p.analysisCases[0].factors[0].factor = 2;
    const rows = preview();
    expect(rows[0].generation.leadingId).toBeNull();
    expect(rows[0].factors).toEqual({ G: "1.2" });
    const model: FamilyModel = {
      ...p,
      resultCombinations: Array.from({ length: 100 }, (_, i) => ({
        ...p.resultCombinations[0],
        id: "M" + i,
      })),
    };
    expect(() => acceptFamilies(model, profile, rows, uid)).toThrow(
      /101 combinações/,
    );
    for (let group = 0; group < 10; group++)
      for (let option = 0; option < 2; option++) {
        const id = `V${group}${option}`;
        p.analysisCases.push({ ...p.analysisCases[0], id });
        profile.actions.push({
          caseId: id,
          role: "variable",
          group: String(group),
        });
      }
    expect(preview).toThrow(/500 alternativas/);
  });
});
it.skipIf(!process.env.OOFEM_BIN)(
  "confere a combinação gerada contra um caso fatorado independente, a expressão analítica e o envelope no OOFEM 3.0",
  async () => {
    const { p, profile, preview } = setup();
    p.resultCombinations = acceptFamilies(p, profile, preview(), uid);
    const [manual, c1, c2, s1, s2] = p.resultCombinations;
    p.resultEnvelopes[0].combinationIds = [c1.id, c2.id];
    const reference = {
      id: "REF",
      name: "Referência",
      type: "linear-static" as const,
      factors: [
        { patternId: "PG", factor: 1.2 },
        { patternId: "PQ1", factor: 1.5 },
        { patternId: "PQ2", factor: 0.75 },
      ],
    };
    p.analysisCases.push(reference);
    const solve = (id: string) => {
      const input = exportOofem(p, id);
      return parseOofemOutput(
        runDeck(input.deck, process.env.OOFEM_BIN!),
        input,
      );
    };
    expect([...requiredCaseIds([c1, c2].flatMap((c) => c.factors))]).toEqual([
      "G",
      "Q1",
      "Q2",
    ]);
    const cache = new Map(["G", "Q1", "Q2"].map((id) => [id, solve(id)]));
    const r = combineLinearResults(p, c1, cache),
      direct = solve("REF");
    const mid = r.members.V1.find((s) => s.t === 0.5)!;
    expect(Math.abs(mid.m - 32400)).toBeLessThan(0.02);
    expect(Math.abs(mid.uz + 0.006075)).toBeLessThan(5e-9);
    expect(Math.abs(r.reactions[0].fz - 21600)).toBeLessThan(0.02);
    for (const [i, a] of r.members.V1.entries()) {
      const b = direct.members.V1[i];
      // Beam2d prints five significant digits for each local end force (%.4e).
      const halfUnit = (v: number) =>
        v === 0 ? 0 : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(v))) - 4);
      for (const k of ["n", "v", "m"] as const) {
        const bound = c1.factors.reduce(
          (sum, t) =>
            sum +
            Math.abs(t.factor) *
              halfUnit(cache.get(t.caseId)!.members.V1[i][k]),
          halfUnit(b[k]),
        );
        expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(bound + 1e-7);
      }
      expect(Math.abs(a.uz - b.uz)).toBeLessThan(5e-9);
    }
    for (const [combo, reaction, moment] of [
      [c1, 21600, 32400],
      [c2, 26100, 39150],
      [s1, 12600, 18900],
      [s2, 16800, 25200],
    ] as const) {
      const result = combineLinearResults(p, combo, cache);
      for (const support of result.reactions)
        expect(Math.abs(support.fz - reaction)).toBeLessThan(0.02);
      expect(
        Math.abs(result.members.V1.find((s) => s.t === 0.5)!.m - moment),
      ).toBeLessThan(0.02);
    }
    const envelope = await evaluateMemberEnvelope(
      p,
      p.resultEnvelopes[0],
      cache,
    );
    expect(
      envelope.V1.find((s) => s.t === 0.5)!.ranges.my.max.combinationId,
    ).toBe(c2.id);
    expect(manual.id).toBe("MAN");
  },
);
