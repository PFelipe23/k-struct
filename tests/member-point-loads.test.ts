import { legacyPatterns } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import { beamStations, sectionLocations } from "../src/domain/beamMesh";
import { connectMeshJoint, reverseMember } from "../src/domain/editing";
import {
  addPoint,
  free,
  nodalLoad,
  parseProject,
  referenceErrors,
  removeSelection,
  serializeProject,
} from "../src/domain/model";
import { combineLinearResults } from "../src/solver/combinations";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { planMemberEdit } from "../src/domain/memberOperations";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { pointLoadBeam } from "./fixtures/member-point-loads";

const solve = (p: ReturnType<typeof pointLoadBeam>, id = "EL") => {
  const input = exportOofem(p, id);
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
};
const numerical = it.skipIf(!process.env.OOFEM_BIN);
describe("KS-29 · ações concentradas em barras", () => {
  it("migra v16 sem alterar os dados e valida o domínio e o plano", () => {
    const p = pointLoadBeam();
    delete p.loadPatterns[0].points;
    expect(
      parseProject(
        JSON.stringify({
          ...p,
          schemaVersion: 16,
          loadPatterns: legacyPatterns(p),
        }),
      ),
    ).toEqual(p);
    const q = pointLoadBeam(),
      l = q.loadPatterns[0].points![0];
    expect(parseProject(serializeProject(q))).toEqual(q);
    l.position.value = 6.1;
    expect(referenceErrors(q).join(" ")).toMatch(/comprimento/);
    l.position = { kind: "relative", value: 1.3 };
    expect(referenceErrors(q).join(" ")).toMatch(/entre 0 e 1/);
    l.position.value = 0.5;
    l.components.y = 10;
    expect(referenceErrors(q).join(" ")).toMatch(/plano XZ/);
    removeSelection(q, [{ kind: "member", id: "V1" }]);
    expect(q.loadPatterns[0].points).toEqual([]);
  });
  it("partilha a única estação entre padrões, refinamento e nó existente", () => {
    const p = pointLoadBeam();
    p.mesh.segmentsPerMember = 3;
    const original = p.loadPatterns[0].points![0];
    p.loadPatterns.push({ ...structuredClone(p.loadPatterns[0]), id: "Q" });
    const joint = addPoint(p, { x: 2, y: 0, z: 0 });
    connectMeshJoint(p, "V1", { kind: "node", id: joint.id });
    const layout = beamStations(p).get("V1")!;
    expect(layout.map((s) => s.t)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(layout[1]).toMatchObject({
      nodeId: joint.id,
      pointLoads: [original, original],
    });
    expect(
      sectionLocations(layout)
        .filter((s) => s.side)
        .map((s) => s.side),
    ).toEqual(["left", "right"]);
    expect(exportOofem(p, "EL").deck.match(/^NodalLoad /gm)).toHaveLength(1);
  });
  numerical(
    "confere 8/4 kN, 16 kN·m e salto do cortante com x, x/L, refinamento e inversão",
    () => {
      for (const count of [2, 3, 8]) {
        const p = pointLoadBeam();
        p.mesh.segmentsPerMember = count;
        if (count !== 2)
          p.loadPatterns[0].points![0].position = {
            kind: "relative",
            value: 1 / 3,
          };
        const a = solve(p);
        expect(a.reactions.map((r) => r.fz)).toEqual([8000, 4000]);
        const [l, r] = a.members.V1.filter((s) => s.side);
        expect([l.side, r.side]).toEqual(["left", "right"]);
        expect(l.t).toBe(1 / 3);
        expect(l.v).toBeCloseTo(8000, 3);
        expect(r.v).toBeCloseTo(-4000, 3);
        for (const s of [l, r]) expect(s.m).toBeCloseTo(16000, 3);
        reverseMember(p, "V1");
        const reversed = solve(p);
        expect(reversed.reactions.map((r) => r.fz)).toEqual([8000, 4000]);
        const [before, after] = reversed.members.V1.filter((s) => s.side);
        expect(before.t).toBeCloseTo(2 / 3, 12);
        expect(before.v).toBeCloseTo(r.v, 3);
        expect(after.v).toBeCloseTo(l.v, 3);
        expect(before.m).toBeCloseTo(-16000, 3);
      }
    },
  );
  numerical(
    "um binário no vão produz reações opostas, cortante contínuo e salto de 6 kN·m",
    () => {
      const p = pointLoadBeam("moment");
      const r = solve(p);
      expect(r.reactions.map((s) => s.fz)).toEqual([-1000, 1000]);
      const [a, b] = r.members.V1.filter((s) => s.side);
      expect(a.v).toBeCloseTo(-1000, 4);
      expect(a.v).toBeCloseTo(b.v, 4);
      expect(a.m).toBeCloseTo(-2000, 4);
      expect(b.m).toBeCloseTo(4000, 4);
      expect(b.m - a.m).toBeCloseTo(6000, 4);
    },
  );
  numerical(
    "reutiliza a estação ao dividir no ponto da carga e conserva o equilíbrio ao unir",
    () => {
      const p = pointLoadBeam();
      const split = planMemberEdit(p, {
        kind: "split",
        id: "V1",
        reference: { kind: "distance", metres: 2 },
      }).project;
      const [load] = split.loadPatterns[0].points!;
      expect(load.position.value).toBe(0);
      expect(load.memberId).toBe(split.members[1].id);
      expect(solve(split).reactions.map((s) => s.fz)).toEqual([8000, 4000]);
      const merged = planMemberEdit(split, {
        kind: "join",
        ids: split.members.map((m) => m.id),
      }).project;
      expect(merged.loadPatterns[0].points).toEqual(p.loadPatterns[0].points);
      expect(solve(merged).reactions.map((s) => s.fz)).toEqual([8000, 4000]);
    },
  );
  numerical(
    "reutiliza as extremidades, transfere o braço rígido e soma a carga nodal na conexão",
    () => {
      const p = pointLoadBeam();
      const pattern = p.loadPatterns[0],
        load = pattern.points![0];
      load.position.value = 0;
      expect(solve(p).reactions.map((r) => r.fz)).toEqual([12000, 0]);
      load.position = { kind: "relative", value: 1 };
      expect(solve(p).reactions.map((r) => r.fz)).toEqual([0, 12000]);
      expect(
        sectionLocations(beamStations(p).get("V1")!).some((s) => s.side),
      ).toBe(false);
      p.members[0].offsets = structuredClone(centeredOffsets);
      p.members[0].offsets.i.rigidLength = 1;
      load.position = { kind: "distance", value: 0.5 };
      expect(solve(p).reactions.map((r) => r.fz)).toEqual([11000, 1000]);
      delete p.members[0].offsets;
      load.position.value = 2;
      const joint = addPoint(p, { x: 2, y: 0, z: 0 });
      connectMeshJoint(p, "V1", { kind: "node", id: joint.id });
      pattern.nodal.push({ ...nodalLoad(joint.id), fz: -6000 });
      expect(solve(p).reactions.map((r) => r.fz)).toEqual([12000, 6000]);
    },
  );
  numerical("usa as mesmas seções nos casos e superpõe lados distintos", () => {
    const p = pointLoadBeam(),
      moment = pointLoadBeam("moment").loadPatterns[0];
    moment.id = "M";
    moment.name = "Binário";
    moment.points![0].position.value = 4;
    p.loadPatterns.push(moment);
    p.analysisCases.push({
      ...p.analysisCases[0],
      id: "CM",
      name: "Momento isolado",
      factors: [{ patternId: "M", factor: 1 }],
    });
    const a = solve(p),
      b = solve(p, "CM");
    const combo = combineLinearResults(
      p,
      {
        id: "C",
        name: "Soma",
        type: "linear",
        factors: [
          { caseId: "EL", factor: 1 },
          { caseId: "CM", factor: 1 },
        ],
      },
      new Map([
        ["EL", a],
        ["CM", b],
      ]),
    );
    const [i, j, k, l] = combo.members.V1.filter((s) => s.side);
    expect([i.t, j.t, k.t, l.t]).toEqual([1 / 3, 1 / 3, 2 / 3, 2 / 3]);
    expect(i.v - j.v).toBeCloseTo(12000, 2);
    expect(i.m - j.m).toBeCloseTo(0, 2);
    expect(k.v - l.v).toBeCloseTo(0, 2);
    expect(l.m - k.m).toBeCloseTo(6000, 2);
  });
  numerical(
    "confere a carga local em barra XYZ inclinada, rotação da seção e fator do caso",
    () => {
      const p = pointLoadBeam();
      p.mode = "spatial";
      p.nodes[1] = { ...p.nodes[1], x: 3, y: 0, z: 4, restraints: free() };
      p.nodes[0].restraints = {
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: true,
        rz: true,
      };
      p.members[0].roll = 90;
      p.analysisCases[0].factors[0].factor = 1.5;
      const l = p.loadPatterns[0].points![0];
      l.system = "local";
      l.position = { kind: "relative", value: 0.4 };
      // With this +90° roll, local z points along global −Y. At (1.2,0,1.6)
      // the factored force of +15 kN in Y gives Mx=−24 and Mz=+18 kN·m.
      l.components = { x: 0, y: 0, z: -10000 };
      const result = solve(p);
      reverseMember(p, "V1");
      const after = solve(p);
      for (const support of [result.reactions[0], after.reactions[0]]) {
        expect(support.fy).toBeCloseTo(-15000, 2);
        expect(support.mx).toBeCloseTo(24000, 2);
        expect(support.mz).toBeCloseTo(-18000, 2);
      }
    },
  );
});
