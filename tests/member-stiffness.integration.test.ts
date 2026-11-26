import { describe, expect, it } from "vitest";
import {
  beamExample,
  free,
  nodalLoad,
  type Project,
} from "../src/domain/model";
import { sectionProperties } from "../src/domain/sections";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { stiffnessCantilevers } from "./fixtures/member-stiffness";

const executable = process.env.OOFEM_BIN;
const solve = (project: Project) => {
  const input = exportOofem(project, "EL");
  return parseOofemOutput(runDeck(input.deck, executable!), input);
};

describe.skipIf(!executable)("KS-24 · modificadores no OOFEM 3.0", () => {
  it.each([
    ["ea", "ux"],
    ["eiy", "uz"],
    ["eiz", "uy"],
    ["gj", "rx"],
  ] as const)(
    "reduzir %s à metade dobra apenas %s na barra modificada",
    (component, dof) => {
      const p = stiffnessCantilevers();
      const { A, Iy, Iz, J } = sectionProperties(p.sections[0]);
      const { E, nu } = p.materials[0];
      const G = E / (2 * (1 + nu)),
        L = 3;
      const expected = {
        ux: (1200 * L) / (E * A),
        uy: (300 * L ** 3) / (3 * E * Iz),
        uz: (-900 * L ** 3) / (3 * E * Iy),
        rx: (15 * L) / (G * J),
      };
      const original = solve(p);
      const [first, second] = p.members;
      p.members[0].stiffness = { [component]: 0.5 };
      const modified = solve(p);
      for (const key of ["ux", "uy", "uz", "rx"] as const) {
        expect(original.displacements[first.end][key]).toBeCloseTo(
          expected[key],
          11,
        );
        expect(modified.displacements[first.end][key]).toBeCloseTo(
          expected[key] * (key === dof ? 2 : 1),
          11,
        );
        expect(modified.displacements[second.end][key]).toBe(
          original.displacements[second.end][key],
        );
      }
      expect(modified.reactions).toEqual(original.reactions);
      expect(modified.members[second.id]).toEqual(original.members[second.id]);
    },
  );

  it("conserva as reações de equilíbrio e dobra a flecha no balanço XZ", () => {
    const p = beamExample();
    p.nodes[0].restraints.ry = true;
    p.nodes[1].restraints = free();
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -600 }];
    const original = solve(p);
    p.members[0].stiffness = { eiy: 0.5 };
    const modified = solve(p);
    const { Iy } = sectionProperties(p.sections[0]);
    const expected = (-600 * 6 ** 3) / (3 * p.materials[0].E * Iy);
    expect(original.displacements.B.uz).toBeCloseTo(expected, 10);
    expect(modified.displacements.B.uz).toBeCloseTo(2 * expected, 10);
    expect(modified.reactions).toEqual(original.reactions);
  });
});
