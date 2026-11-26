import { describe, it, expect } from "vitest";
import {
  parseProject,
  serializeProject,
  referenceErrors,
  removeSelection,
  nodalLoad,
} from "../src/domain/model";
import { distributeWind } from "../src/domain/wind";
import { combineLinearResults } from "../src/solver/combinations";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { windColumn, facade } from "./fixtures/wind-column";

describe("faixas de vento", () => {
  it("migra v20 sem alterar cargas e IDs e remove a faixa ao excluir seu nó", () => {
    const p = windColumn();
    p.loadPatterns[0].nodal = [{ ...nodalLoad("A"), fx: 35 }];
    expect(parseProject(JSON.stringify({ ...p, schemaVersion: 20 }))).toEqual(
      p,
    );
    p.loadPatterns[0].wind = [facade];
    expect(parseProject(serializeProject(p))).toEqual(p);
    removeSelection(p, [{ kind: "node", id: "B" }]);
    expect(p.loadPatterns[0].wind).toEqual([]);
    expect(p.loadPatterns[0].nodal[0].fx).toBe(35);
  });
  it("distribui a área pela altura da linha de ação e conserva o sentido em XYZ", () => {
    const p = windColumn(),
      nodes = new Map(p.nodes.map((n) => [n.id, n]));
    for (const angle of [0, 45, 90, 180, -90]) {
      const w = distributeWind(nodes, "spatial", {
        ...facade,
        from: 0.5,
        angle,
        coefficient: -1.25,
      });
      expect(w.area).toBe(6);
      expect(w.center.z).toBe(2.25);
      expect(w.force.x).toBeCloseTo(-6000 * Math.cos((angle * Math.PI) / 180));
      expect(w.force.y).toBeCloseTo(-6000 * Math.sin((angle * Math.PI) / 180));
      expect(w.loads[0].fx).toBeCloseTo(w.force.x / 4);
      expect(w.loads[1].fy * 3).toBeCloseTo(w.force.y * w.center.z);
    }
  });
  it("recusa geometria incompatível, faixas sem área, pressão negativa e vento fora de XZ", () => {
    for (const invalid of [
      { topId: "A" },
      { width: 0 },
      { to: 0 },
      { from: 0.7, to: 0.4 },
      { pressure: -1 },
      { angle: 90 },
    ]) {
      const p = windColumn();
      p.loadPatterns[0].wind = [{ ...facade, ...invalid }];
      expect(referenceErrors(p).length).toBeGreaterThan(0);
    }
  });
  it.skipIf(!process.env.OOFEM_BIN)(
    "transfere sucção oblíqua para um pilar XYZ fora da origem",
    () => {
      const p = windColumn();
      p.mode = "spatial";
      Object.assign(p.nodes[0].restraints, { uy: true, rx: true, rz: true });
      for (const node of p.nodes)
        Object.assign(node, { x: 8, y: -2, z: node.z + 10 });
      p.loadPatterns[0].wind = [
        { ...facade, from: 0.5, coefficient: -1.25, angle: 30 },
      ];
      const input = exportOofem(p, "EL");
      const r = parseOofemOutput(
        runDeck(input.deck, process.env.OOFEM_BIN!),
        input,
      ).reactions.find((r) => r.nodeId === "A")!;
      const fx = 6000 * Math.cos(Math.PI / 6),
        fy = 3000;
      expect(r.fx).toBeCloseTo(fx, 1);
      expect(r.fy).toBeCloseTo(fy, 1);
      expect(r.mx).toBeCloseTo(-fy * 2.25, 1);
      expect(r.my).toBeCloseTo(fx * 2.25, 1);
    },
  );
  it.skipIf(!process.env.OOFEM_BIN)(
    "confere no OOFEM o equilíbrio, a inversão, as duas faixas e a combinação com outra ação",
    () => {
      const p = windColumn(),
        wind = p.loadPatterns[0];
      function solve(id = "EL") {
        const deck = exportOofem(p, id);
        return parseOofemOutput(
          runDeck(deck.deck, process.env.OOFEM_BIN!),
          deck,
        );
      }
      for (const angle of [0, 180]) {
        for (const divided of [false, true]) {
          wind.wind = divided
            ? [
                { ...facade, to: 0.5, angle },
                { ...facade, id: "W2", from: 0.5, angle },
              ]
            : [{ ...facade, angle }];
          const r = solve().reactions.find((r) => r.nodeId === "A")!;
          const sign = angle === 0 ? -1 : 1;
          expect(r.fx).toBeCloseTo(sign * 12000, 1);
          expect(r.my).toBeCloseTo(sign * 18000, 1);
        }
      }
      wind.wind = [facade];
      p.loadPatterns.push({
        ...wind,
        id: "P",
        name: "Permanente",
        wind: [],
        nodal: [{ ...nodalLoad("B"), fz: -1000 }],
      });
      p.analysisCases.push({
        ...p.analysisCases[0],
        id: "CP",
        factors: [{ patternId: "P", factor: 1 }],
      });
      const combo = {
        id: "COMB",
        name: "Vento e permanente",
        type: "linear" as const,
        factors: [
          { caseId: "EL", factor: -0.5 },
          { caseId: "CP", factor: 1.5 },
        ],
      };
      const result = combineLinearResults(
        p,
        combo,
        new Map([
          ["EL", solve()],
          ["CP", solve("CP")],
        ]),
      );
      const r = result.reactions.find((r) => r.nodeId === "A")!;
      expect(r.fx).toBeCloseTo(6000, 1);
      expect(r.my).toBeCloseTo(9000, 1);
      expect(r.fz).toBeCloseTo(1500, 1);
    },
  );
});
