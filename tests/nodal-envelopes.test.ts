import { expect, it } from "vitest";
import { createProject, free, type Project } from "../src/domain/model";
import { hasSupport, supportDofs } from "../src/domain/supports";
import { evaluateEnvelope, type NodeEnvelope } from "../src/solver/envelopes";
import {
  reactionComponents,
  type NodalComponent,
} from "../src/solver/nodalResults";
import {
  exportOofem,
  parseOofemOutput,
  type AnalysisResult,
} from "../src/solver/oofem";
import {
  obliqueFrame,
  planarNodalEnvelope,
  spatialNodalEnvelope,
} from "./fixtures/nodal-envelopes";
import { runDeck } from "./fixtures/solve-oofem";

function solve(p: Project, id: string) {
  const input = exportOofem(p, id);
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
}

function controlled() {
  const p = createProject("spatial");
  const restraints = {
    ux: true,
    uy: true,
    uz: true,
    rx: true,
    ry: true,
    rz: true,
  };
  p.nodes = [
    {
      id: "N1",
      name: "Base",
      x: 0,
      y: 0,
      z: 0,
      restraints: free(),
      springs: { ux: 1e6, uy: 1e6, uz: 1e6, rx: 1e6, ry: 1e6, rz: 1e6 },
      supportFrame: obliqueFrame,
    },
    { id: "N2", name: "Base", x: 1, y: 0, z: 0, restraints },
  ];
  p.analysisCases = ["P", "Q"].map((id) => ({
    ...p.analysisCases[0],
    id,
    name: `Caso ${id}`,
  }));
  p.resultCombinations = ["A", "B"].map((id, i) => ({
    id,
    name: "Serviço",
    type: "linear",
    factors: [{ caseId: p.analysisCases[i].id, factor: 1 }],
  }));
  const A = { fx: 10000, fy: 2000, fz: 30000, mx: -3000, my: 7000, mz: -2000 };
  const B = { fx: -4000, fy: 20000, fz: 12000, mx: 5000, my: -6000, mz: -2000 };
  const zero = { ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 };
  const springMotion = (v: typeof A) => ({
    ux: -v.fx / 1e6,
    uy: -v.fy / 1e6,
    uz: -v.fz / 1e6,
    rx: -v.mx / 1e6,
    ry: -v.my / 1e6,
    rz: -v.mz / 1e6,
  });
  const cases = new Map<string, AnalysisResult>(
    p.analysisCases.map(({ id }, i) => [
      id,
      {
        caseId: id,
        solver: "ensaio controlado",
        completedAt: "",
        rawOutput: "",
        members: {},
        displacements: { N2: zero, N1: springMotion(i === 0 ? A : B) },
        reactions:
          i === 0
            ? [
                { nodeId: "N1", ...A },
                { nodeId: "N2", ...B },
              ]
            : [
                { nodeId: "N2", ...A },
                { nodeId: "N1", ...B },
              ],
      },
    ]),
  );
  return {
    p,
    e: { id: "E", name: "Envelope", combinationIds: ["A", "B"] },
    cases,
    A,
    B,
  };
}

it("mantém o vetor simultâneo por ID e muda a governante depois da projeção na base 3–4–5", async () => {
  const { p, e, cases, A, B } = controlled();
  const { nodal } = await evaluateEnvelope(p, e, cases);
  const { global, local } = nodal.reactions.get("N1")!;
  expect(global.fx.max).toEqual({
    frame: "global",
    vector: A,
    source: {
      id: "A",
      name: "Serviço",
      type: "linear",
      factors: [{ caseId: "P", name: "Caso P", factor: 1 }],
    },
  });
  expect(global.fx.min.vector).toEqual(B);
  expect(global.fy.max.vector).toEqual(B);
  expect(global.my.min.vector).toEqual(B);
  expect(global.mz.min.source.id).toBe("A");
  expect(global.mz.max.source.id).toBe("A");
  expect(nodal.reactions.get("N2")!.global.fx.max.source.id).toBe("B");
  expect(local!.fx.max.source.id).toBe("B");
  const localB = {
    fx: 13600,
    fy: 15200,
    fz: 12000,
    mx: -1800,
    my: -7600,
    mz: -2000,
  };
  for (const key of reactionComponents)
    expect(local!.fx.max.vector[key]).toBeCloseTo(localB[key], 8);
  expect(local!.mx.max.source.id).toBe("A");
  expect(local!.mx.max.vector.mx).toBeCloseTo(3800, 8);
  const motion = nodal.displacements.get("N1")!;
  expect(motion.global.ux.min.source.id).toBe("A");
  expect(motion.local!.ux.min.source.id).toBe("B");
  for (const [i, dof] of supportDofs.entries())
    expect(motion.local!.ux.min.vector[dof]).toBeCloseTo(
      -localB[reactionComponents[i]] / 1e6,
      12,
    );
  e.combinationIds.reverse();
  const reversed = await evaluateEnvelope(p, e, cases);
  expect(reversed.nodal.reactions.get("N1")!.local!.mz.max.source.id).toBe("B");
});

it("recusa caso ausente, identidades incompatíveis, reação duplicada e componentes não finitas", async () => {
  for (const mutate of [
    (r: AnalysisResult) => {
      r.caseId = "antigo";
    },
    (r: AnalysisResult) => {
      delete r.displacements.N1;
    },
    (r: AnalysisResult) => {
      r.reactions[1].nodeId = r.reactions[0].nodeId;
    },
    (r: AnalysisResult) => {
      r.reactions[0].nodeId = "outro";
    },
    (r: AnalysisResult) => {
      r.displacements.N2.ry = NaN;
    },
  ]) {
    const { p, e, cases } = controlled();
    mutate(cases.get("P")!);
    await expect(evaluateEnvelope(p, e, cases)).rejects.toThrow(
      /pendentes|incompatíveis|numérico/,
    );
  }
});

it.skipIf(!process.env.OOFEM_BIN)(
  "confere as reações e rotações de extremidade da viga XZ de 6 m",
  async () => {
    const p = planarNodalEnvelope();
    const { nodal } = await evaluateEnvelope(
      p,
      p.resultEnvelopes[0],
      new Map([["EL", solve(p, "EL")]]),
    );
    for (const { id } of p.nodes) {
      const { fz, fx, my } = nodal.reactions.get(id)!.global;
      expect(fz.min.source.id).toBe("B");
      expect(fz.max.source.id).toBe("A");
      expect(Math.abs(fz.min.vector.fz + 60000)).toBeLessThan(0.02);
      expect(Math.abs(fz.max.vector.fz - 30000)).toBeLessThan(0.02);
      expect(fx.min.vector.fx).toBe(0);
      expect(my.max.vector.my).toBe(0);
      const { ux, uz, ry } = nodal.displacements.get(id)!.global;
      expect(Math.abs(ux.min.vector.ux)).toBeLessThan(1e-12);
      expect(uz.max.vector.uz).toBe(0);
      expect(
        Math.abs(ry.min.vector.ry - (id === "A" ? -0.009 : -0.0045)),
      ).toBeLessThan(1e-10);
      expect(
        Math.abs(ry.max.vector.ry - (id === "A" ? 0.0045 : 0.009)),
      ).toBeLessThan(1e-10);
    }
  },
);

it.skipIf(!process.env.OOFEM_BIN)(
  "reproduz cada extremo e suas seis componentes em dois casos fatorados diretamente no OOFEM 3.0",
  async () => {
    const p = spatialNodalEnvelope();
    const cases = new Map(p.analysisCases.map(({ id }) => [id, solve(p, id)]));
    const { nodal } = await evaluateEnvelope(p, p.resultEnvelopes[0], cases);
    const direct = p.resultCombinations.map((c) => {
      const id = `direto-${c.id}`;
      p.analysisCases.push({
        id,
        name: id,
        type: "linear-static",
        factors: c.factors.map(({ caseId, factor }) => ({
          patternId: caseId,
          factor,
        })),
      });
      return solve(p, id);
    });

    function verify<K extends NodalComponent>(
      record: NodeEnvelope<K>,
      keys: readonly K[],
      read: (r: AnalysisResult) => Record<K, number>,
      reaction: boolean,
    ) {
      const group = (values: Record<K, number>, key: K) => {
        const first = keys.indexOf(key) < 3 ? 0 : 3;
        return Math.hypot(
          ...keys.slice(first, first + 3).map((k) => values[k]),
        );
      };
      for (const frame of ["global", "local"] as const) {
        const ranges = record[frame];
        if (!ranges) continue;
        function inFrame(v: Record<K, number>) {
          const out = { ...v };
          if (frame === "local")
            for (const first of [0, 3]) {
              const x = keys[first],
                y = keys[first + 1];
              out[x] = 0.6 * v[x] + 0.8 * v[y];
              out[y] = -0.8 * v[x] + 0.6 * v[y];
            }
          return out;
        }
        const [a, b] = direct.map((r) => inFrame(read(r)));
        for (const key of keys)
          for (const bound of ["min", "max"] as const) {
            const extreme = ranges[key][bound];
            const i = (bound === "min" ? b[key] < a[key] : b[key] > a[key])
              ? 1
              : 0;
            const reference = i === 0 ? a : b;
            const combination = p.resultCombinations[i];
            expect(extreme.source.id).toBe(combination.id);
            expect(extreme.frame).toBe(frame);
            for (const k of keys) {
              const scale = combination.factors.reduce(
                (sum, t) =>
                  sum +
                  Math.abs(t.factor) * group(read(cases.get(t.caseId)!), k),
                group(reference, k),
              );
              const tolerance = reaction
                ? 1e-7 + 5.1e-5 * scale
                : 1e-12 + 5.1e-9 * scale;
              expect(
                Math.abs(extreme.vector[k] - reference[k]),
              ).toBeLessThanOrEqual(tolerance);
            }
          }
      }
    }
    for (const node of p.nodes) {
      verify(
        nodal.displacements.get(node.id)!,
        supportDofs,
        (r) => r.displacements[node.id],
        false,
      );
      if (hasSupport(node))
        verify(
          nodal.reactions.get(node.id)!,
          reactionComponents,
          (r) => r.reactions.find(({ nodeId }) => nodeId === node.id)!,
          true,
        );
    }
  },
);
