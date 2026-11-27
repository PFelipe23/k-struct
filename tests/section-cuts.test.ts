import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beamExample,
  free,
  nodalLoad,
  parseProject,
  serializeProject,
  type Project,
  type SectionCut,
} from "../src/domain/model";
import {
  add,
  cross,
  origin,
  scale,
  subtract,
  type Point3,
} from "../src/domain/geometry";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { reverseMember } from "../src/domain/editing";
import { cutGeometry, cutFrame, elementTrace } from "../src/domain/sectionCut";
import { globalBasis, type Basis } from "../src/domain/surfacePanel";
import { evaluateCut } from "../src/solver/sectionCut";
import {
  exportOofem,
  parseOofemOutput,
  type AnalysisResult,
} from "../src/solver/oofem";
import { cantileverPanel, foldedPanels } from "./fixtures/spatial-panels";
import { jointedSlabs } from "./fixtures/jointed-slabs";
import { runDeck } from "./fixtures/solve-oofem";

const bin = process.env.OOFEM_BIN,
  one = [{ caseId: "EL", factor: 1 }];
const at = (x: number): SectionCut => ({
  id: "C1",
  name: "Corte 1",
  point: { ...origin, x },
  normal: globalBasis[0],
  retained: "negative",
  datum: { ...origin, x },
});
function solve(p: Project, caseId = "EL") {
  const i = exportOofem(p, caseId);
  return parseOofemOutput(runDeck(i.deck, bin!), i);
}
function read(p: Project, c: SectionCut, r: AnalysisResult) {
  return evaluateCut(p, c, one, new Map([[r.caseId, r]]));
}
function cantilever(mode: Project["mode"]) {
  const p = beamExample();
  p.mode = mode;
  p.nodes[1].x = 4;
  p.nodes[0].restraints = {
    ux: true,
    uy: mode === "spatial",
    uz: true,
    rx: mode === "spatial",
    ry: true,
    rz: mode === "spatial",
  };
  p.nodes[1].restraints = free();
  p.loadPatterns[0].uniform = [];
  p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -10000 }];
  return p;
}
function near(v: Point3, expected: Point3, eps: number) {
  for (const k of ["x", "y", "z"] as const)
    expect(Math.abs(v[k] - expected[k]), k).toBeLessThan(eps);
}
it("conserva os cortes, migra v31, atualiza a interseção física e distingue vazio, tangência e interface", () => {
  const p = beamExample(),
    c = at(1);
  expect(parseProject(JSON.stringify({ ...p, schemaVersion: 31 }))).toEqual(p);
  p.sectionCuts = [c];
  const q = parseProject(serializeProject(p));
  expect(q.sectionCuts).toEqual([c]);
  q.nodes[1].x = 8;
  expect(cutGeometry(q, c).objects[0].hits[0].t).toBe(1 / 8);
  expect(cutGeometry(q, at(9)).objects[0].hits).toHaveLength(0);
  const floor = jointedSlabs(4);
  expect(cutGeometry(floor, at(4)).objects.every((o) => o.unavailable)).toBe(
    true,
  );
  const tangent = { ...at(0), normal: { x: 1, y: 1, z: 0 } };
  expect(
    cutGeometry(floor, tangent).objects.find((o) => o.id === "laje-1")?.notice,
  ).toMatch(/Tangência/);
  expect(() => cutGeometry(p, { ...c, normal: origin })).toThrow(/não nula/);
});
it("atribui uma aresta interna a uma só face e preserva o traço ao inverter o lado", () => {
  const a = { ...origin, y: 0 },
    b = { ...origin, y: 2 },
    faces = [
      [a, b, { ...origin, x: -1 }],
      [b, a, { ...origin, x: 1 }],
    ];
  for (const retained of ["negative", "positive"] as const) {
    const frame = cutFrame({ ...at(0), retained });
    const traces = faces.map((face) => elementTrace(face, frame));
    expect(traces.filter(Boolean)).toHaveLength(1);
    expect(traces[retained === "negative" ? 1 : 0]).toEqual(
      expect.arrayContaining([a, b]),
    );
  }
});
it("integra um diagrama entre estações e suprime o total quando falta a lei do elemento ou um caso", () => {
  const p = beamExample(),
    raw = readFileSync(
      new URL("./fixtures/beam-oofem.txt", import.meta.url),
      "utf8",
    );
  const r = parseOofemOutput(raw, exportOofem(p, "EL")),
    c = at(1);
  const v = read(p, c, r).total!;
  near(v.force, { ...origin, z: -20000 }, 0.1);
  near(v.moment, { ...origin, y: -25000 }, 0.5);
  const incomplete = { ...r, memberIntensities: undefined };
  expect(read(p, c, incomplete).total).toBeUndefined();
  expect(() => evaluateCut(p, c, one, new Map())).toThrow(/casos pendentes/);
  expect(
    evaluateCut(p, c, [{ caseId: "EL", factor: -2 }], new Map([["EL", r]]))
      .total?.force.z,
  ).toBeCloseTo(40000);
});
describe.skipIf(!bin)("KS-48 · OOFEM 3.0", () => {
  it.each(["planar", "spatial"] as const)(
    "balanço %s de 4 m, inversão i/j, salto, trecho rígido carregado",
    (mode) => {
      const p = cantilever(mode),
        c = at(1);
      for (const n of [3, 8]) {
        p.mesh.segmentsPerMember = n;
        for (const side of ["negative", "positive"] as const) {
          const r = read(p, { ...c, retained: side }, solve(p)).total!,
            sign = side === "negative" ? 1 : -1;
          near(r.force, { ...origin, z: -sign * 10000 }, 0.1);
          near(r.moment, { ...origin, y: sign * 30000 }, 0.4);
        }
        reverseMember(p, "V1");
      }
      p.loadPatterns[0].points = [
        {
          id: "K",
          memberId: "V1",
          kind: "force",
          system: "global",
          position: { kind: "distance", value: 1 },
          components: { ...origin, z: -3000 },
        },
      ];
      const r = solve(p);
      expect(read(p, c, r).total!.force.z).toBeCloseTo(-10000);
      expect(
        read(p, { ...c, retained: "positive" }, r).total!.force.z,
      ).toBeCloseTo(13000);
      p.members[0].offsets = structuredClone(centeredOffsets);
      p.members[0].offsets.i.rigidLength = 1.5;
      p.loadPatterns[0].uniform = [{ memberId: "V1", qx: 0, qy: 0, qz: -1000 }];
      const w = read(p, at(0.5), solve(p)).total!;
      near(w.force, { ...origin, z: -16500 }, 0.2);
      near(w.moment, { ...origin, y: 35000 + 3500 * 1.75 + 3000 * 0.5 }, 0.8);
      p.loadPatterns[0].uniform = [];
      p.loadPatterns[0].points![0].position.value = 1.5;
      const face = at(1.5),
        atFace = solve(p);
      near(read(p, face, atFace).total!.force, { ...origin, z: -10000 }, 0.2);
      near(
        read(p, { ...face, retained: "positive" }, atFace).total!.force,
        { ...origin, z: 13000 },
        0.2,
      );
    },
  );
  it("parede vertical com tração de borda, flexão e mudança do polo em duas malhas", () => {
    const axes: Basis = [
      globalBasis[2],
      globalBasis[1],
      scale(globalBasis[0], -1),
    ];
    for (const n of [8, 16]) {
      const p = cantileverPanel("shell", axes, n);
      p.surfacePanels![0].nv = n / 2;
      const a = p.surfacePanels![0].a,
        c = {
          ...at(0),
          normal: axes[0],
          point: add(a, { x: 0, y: 0.6, z: 0.91 }),
        };
      c.datum = c.point;
      const r = solve(p),
        v = read(p, c, r).total!,
        f = { x: 1200, y: 0, z: 120000 },
        m = cross(scale(axes[0], 2.09), f);
      console.info("parede", n, JSON.stringify(v));
      near(v.force, f, 0.12);
      near(v.moment, m, 0.025 * Math.abs(m.y));
      const d = { x: 3, y: 1, z: -2 };
      near(
        read(p, { ...c, datum: d }, r).total!.moment,
        add(v.moment, cross(subtract(c.datum, d), v.force)),
        1e-7,
      );
    }
  });
  it("duas lajes e viga comum: três parcelas, equilíbrio externo e transporte do polo", () => {
    for (const n of [12, 20]) {
      const p = jointedSlabs(n);
      Object.assign(p.slabJoint!, { kind: "elastic", stiffness: 1e6 });
      const c = {
        ...at(0),
        normal: globalBasis[1],
        point: { x: 4, y: 0.81, z: 3 },
        datum: { x: 4, y: 0.81, z: 3 },
      };
      const r = solve(p),
        out = read(p, c, r),
        v = out.total!;
      expect(out.rows.map((o) => o.id)).toEqual([
        "viga-comum",
        "laje-1",
        "laje-2",
      ]);
      const h = c.point.y,
        weight = -5000 * 4 * h;
      let fz = weight,
        mx = weight * (-h / 2),
        my = weight * 2;
      for (const s of r.floor!.panels)
        for (const reaction of s.reactions) {
          const n = s.mesh.nodes[reaction.node - 1];
          if (n.y > h || n.x === 4) continue;
          fz += reaction.fz;
          mx += reaction.mx + (n.y - h) * reaction.fz;
          my += reaction.my - (n.x - 4) * reaction.fz;
        }
      const support = r.reactions.find((v) => v.nodeId === "apoio-i")!;
      fz += support.fz;
      mx += support.mx - h * support.fz;
      my += support.my;
      console.info(
        "pavimento",
        n,
        JSON.stringify(out.rows.map((row) => row.value)),
        JSON.stringify({ fz: -fz, mx: -mx, my: -my }),
      );
      expect(Math.abs(v.force.z + fz)).toBeLessThan(1);
      expect(Math.abs(v.moment.x + mx)).toBeLessThan(Math.abs(mx) * 0.025);
      expect(Math.abs(v.moment.y + my)).toBeLessThan(5);
      const d = { x: 0, y: 0, z: 0 };
      near(
        read(p, { ...c, datum: d }, r).total!.moment,
        add(v.moment, cross(subtract(c.datum, d), v.force)),
        1e-7,
      );
      if (n === 12) {
        p.analysisCases.push({
          ...p.analysisCases[0],
          id: "MEIO",
          name: "Meia carga",
          factors: [{ patternId: "G", factor: 0.5 }],
        });
        const half = solve(p, "MEIO"),
          combined = evaluateCut(
            p,
            c,
            [
              { caseId: "EL", factor: 2 },
              { caseId: "MEIO", factor: -1 },
            ],
            new Map([
              ["EL", r],
              ["MEIO", half],
            ]),
          );
        near(combined.total!.force, scale(v.force, 1.5), 1);
        near(combined.total!.moment, scale(v.moment, 1.5), 3);
      }
      const flipped = read(p, { ...c, retained: "positive" }, r).total!;
      near(flipped.force, scale(v.force, -1), 1);
      near(flipped.moment, scale(v.moment, -1), 2);
    }
  });
  it("recusa uma decomposição singular na dobra de duas cascas", () => {
    const p = foldedPanels(),
      c = { ...at(0), point: { ...origin, y: 0.6 }, normal: globalBasis[1] };
    const out = read(p, c, solve(p));
    expect(out.total).toBeUndefined();
    expect(out.rows).toHaveLength(2);
    expect(
      out.rows.every((row) => !row.value && row.note.includes("interface")),
    ).toBe(true);
  });
});
