import { expect, it } from "vitest";
import { beamExample, free, type Project } from "../src/domain/model";
import { reverseMember } from "../src/domain/editing";
import { fromSI, toSI, DEFAULT_UNITS } from "../src/units";
import { prepareMemberDiagram } from "../src/solver/memberDiagram";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { pointLoadBeam } from "./fixtures/member-point-loads";
import { distributedBeam } from "./fixtures/member-distributed-loads";
import { diagramEnvelope } from "./fixtures/diagram-envelope";
import { readFileSync } from "node:fs";
const native = it.skipIf(!process.env.OOFEM_BIN);
function solve(p: Project, id = p.analysisCases[0].id) {
  const input = exportOofem(p, id);
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
}
function inspect(p: Project) {
  const r = solve(p);
  return prepareMemberDiagram(
    p,
    p.members[0].id,
    [
      {
        id: r.caseId,
        name: r.caseId,
        factors: [{ caseId: r.caseId, factor: 1 }],
      },
    ],
    new Map([[r.caseId, r]]),
  );
}

native(
  "separa as faces da força de 12 kN, consulta em m, cm e x/L e acompanha a inversão de i e j",
  () => {
    const p = pointLoadBeam();
    p.mesh.segmentsPerMember = 3;
    const d = inspect(p);
    for (const t of [
      2 / d.length,
      toSI(200, "length", { ...DEFAULT_UNITS, length: "cm" }) / d.length,
      1 / 3,
    ]) {
      const left = d.read({ t, side: "left" }, "v"),
        right = d.read({ t, side: "right" }, "v");
      expect(left.method).toBe("sample");
      expect(left.max.forces.v).toBeCloseTo(8000, 3);
      expect(right.min.forces.v).toBeCloseTo(-4000, 3);
      expect(left.max.forces.m).toBeCloseTo(16000, 3);
      expect(right.min.forces.m).toBeCloseTo(16000, 3);
    }
    for (const [x, v, m] of [
      [1, 8000, 8000],
      [3, -4000, 12000],
    ]) {
      const r = d.read({ t: x / d.length }, "m");
      expect(r.method).toBe("linear");
      expect(r.max.forces.v).toBeCloseTo(v, 3);
      expect(r.max.forces.m).toBeCloseTo(m, 3);
    }
    for (const t of [0, 1])
      expect(d.read({ t }, "m").min.forces.m).toBeCloseTo(0, 4);
    for (const t of [-0.01, 1.01, NaN])
      expect(() => d.read({ t }, "m")).toThrow(/fora/);
    reverseMember(p, "V1");
    const reversed = inspect(p);
    for (const [side, v] of [
      ["left", -4000],
      ["right", 8000],
    ] as const) {
      const r = reversed.read({ t: 4 / 6, side }, "v");
      expect(r.min.forces.v).toBeCloseTo(v, 3);
      expect(r.min.forces.m).toBeCloseTo(-16000, 3);
    }
  },
);

native(
  "localiza o máximo entre estações nas malhas de três, cinco e oito subdivisões",
  () => {
    for (const [count, sampleMax] of [
      [3, 40000],
      [5, 43200],
      [8, 45000],
    ]) {
      const p = beamExample();
      p.mesh.segmentsPerMember = count;
      const d = inspect(p);
      const cut = d.extreme("m", "max", false);
      expect(cut.t).toBeCloseTo(0.5, 8);
      expect(d.read(cut, "m").max.forces.m).toBeCloseTo(45000, 2);
      expect(d.read(d.extreme("m", "max", true), "m").max.forces.m).toBeCloseTo(
        sampleMax,
        2,
      );
      expect(
        fromSI(cut.t * d.length, "length", { ...DEFAULT_UNITS, length: "cm" }),
      ).toBeCloseTo(300, 4);
    }
  },
);

native(
  "usa as raízes da lei cúbica sob carga triangular e mantém os limites de trechos parciais",
  () => {
    const p = distributedBeam();
    p.mesh.segmentsPerMember = 3;
    const load = p.loadPatterns[0].distributed![0];
    Object.assign(load, { start: 0, end: 6 });
    let d = inspect(p);
    const cut = d.extreme("m", "max", false);
    expect(cut.t).toBeCloseTo(1 / Math.sqrt(3), 4);
    expect(
      Math.abs(
        d.read(cut, "m").max.forces.m - (6000 * 36) / (9 * Math.sqrt(3)),
      ),
    ).toBeLessThan(0.6);
    p.mesh.segmentsPerMember = 4;
    p.loadPatterns[0].uniform = [{ memberId: "V1", qx: 0, qy: 0, qz: 2000 }];
    d = inspect(p);
    const peakShear = d.extreme("v", "max", false);
    expect(peakShear.t).toBeCloseTo(1 / 3, 8);
    expect(d.read(peakShear, "v").max.forces.v).toBeCloseTo(2000, 2);
    expect(d.read(d.extreme("v", "max", true), "v").max.forces.v).toBeCloseTo(
      1875,
      2,
    );
    p.loadPatterns[0].uniform = [];
    Object.assign(load, { start: 1, end: 5 });
    d = inspect(p);
    expect(d.stations.some((s) => s.t === 1 / 6)).toBe(true);
    expect(d.stations.some((s) => s.t === 5 / 6)).toBe(true);
    expect(d.read({ t: 0.5 / 6 }, "v").max.forces.v).toBeCloseTo(
      d.read({ t: 0 }, "v").max.forces.v,
      2,
    );
  },
);

native(
  "recupera os seis esforços XYZ sob carregamento variável local e peso próprio com uma malha nativa independente",
  () => {
    const p = distributedBeam();
    p.mode = "spatial";
    p.mesh.segmentsPerMember = 3;
    p.members[0].roll = 32;
    p.nodes[0].restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    p.nodes[1].restraints = free();
    const pattern = p.loadPatterns[0];
    pattern.selfWeight.enabled = true;
    Object.assign(pattern.distributed![0], {
      system: "local",
      start: 0,
      end: 6,
      qStart: { x: 2000, y: -3000, z: 4000 },
      qEnd: { x: 5000, y: -8000, z: 9000 },
    });
    p.analysisCases[0].factors[0].factor = -1.3;
    const d = inspect(p);
    p.mesh.segmentsPerMember = 12;
    const refined = solve(p);
    for (const t of [1 / 6, 1 / 2, 5 / 6]) {
      const ref = refined.members.V1.find((s) => s.t === t)!;
      const r = d.read({ t }, "my");
      expect(r.method).toBe("law");
      for (const key of ["n", "vy", "vz", "mx", "my", "mz"] as const)
        expect(Math.abs(r.max.forces[key] - ref[key]), key).toBeLessThan(
          0.02 + 1.1e-4 * Math.abs(ref[key]),
        );
    }
  },
);

native(
  "uma combinação supera as duas amostras vizinhas no interior e conserva seu vetor simultâneo",
  () => {
    const p = diagramEnvelope();
    const cache = new Map(p.analysisCases.map((c) => [c.id, solve(p, c.id)]));
    const negative = prepareMemberDiagram(
      p,
      "V1",
      [
        {
          id: "NEG",
          name: "Invertida",
          factors: [{ caseId: "EL", factor: -2 }],
        },
      ],
      cache,
    );
    const minimum = negative.read(negative.extreme("m", "min", false), "m");
    expect(minimum.location.t).toBeCloseTo(0.5, 8);
    expect(minimum.min.forces.m).toBeCloseTo(-90000, 2);
    const d = prepareMemberDiagram(p, "V1", p.resultCombinations, cache);
    for (const t of [1 / 3, 2 / 3]) {
      const r = d.read({ t }, "m");
      expect(r.max.id).toBe("C-CP");
      expect(r.max.forces.n).toBeCloseTo(5000, 3);
    }
    const max = d.read(d.extreme("m", "max", false), "m");
    expect(max.location.t).toBeCloseTo(0.5, 9);
    expect(max.max.id).toBe("C-EL");
    expect(max.max.forces.m).toBeCloseTo(45000, 3);
    expect(max.max.forces.n).toBeCloseTo(0, 3);
    expect(max.min.id).toBe("C-CP");
    expect(max.min.forces.n).toBeCloseTo(5000, 3);
    expect(d.read(d.extreme("m", "max", true), "m").max.forces.m).toBeCloseTo(
      42000,
      3,
    );
  },
);

it("identifica a amostra efetiva quando o resultado de sessão só fornece estações", () => {
  const p = beamExample();
  const r = parseOofemOutput(
    readFileSync(new URL("./fixtures/beam-oofem.txt", import.meta.url), "utf8"),
    exportOofem(p, "EL"),
  );
  delete r.memberIntensities;
  const d = prepareMemberDiagram(
    p,
    "V1",
    [{ id: "EL", name: "EL", factors: [{ caseId: "EL", factor: 1 }] }],
    new Map([["EL", r]]),
  );
  expect(d.coverage).toBe("sampled");
  const read = d.read({ t: 0.42 }, "m");
  expect(read.method).toBe("nearest");
  expect(read.location.t).toBe(0.375);
  expect(read.max.forces.m).toBe(r.members.V1[3].m);
  expect(d.extreme("m", "max", true)).toEqual(d.extreme("m", "max", false));
});

native(
  "mede x no comprimento deformável inclinado e conserva os dois momentos em um binário concentrado",
  () => {
    const p = beamExample();
    p.mesh.segmentsPerMember = 3;
    p.nodes[0].restraints = { ...free(), ux: true, uz: true, ry: true };
    Object.assign(p.nodes[1], { x: 6, z: 8, restraints: free() });
    p.members[0].offsets = {
      i: { eccentricity: { x: 0, y: 0, z: 0 }, rigidLength: 1 },
      j: { eccentricity: { x: 0, y: 0, z: 0 }, rigidLength: 2 },
    };
    const d = inspect(p);
    expect(d.length).toBe(7);
    p.mesh.segmentsPerMember = 7;
    const reference = solve(p).members.V1.find((s) => s.t === 2 / 7)!;
    expect(
      Math.abs(d.read({ t: 2 / d.length }, "m").max.forces.m - reference.m),
    ).toBeLessThan(6);
    const moment = inspect(pointLoadBeam("moment"));
    const left = moment.read({ t: 1 / 3, side: "left" }, "m"),
      right = moment.read({ t: 1 / 3, side: "right" }, "m");
    expect(Math.abs(left.max.forces.m - right.max.forces.m)).toBeCloseTo(
      6000,
      2,
    );
    expect(left.max.forces.v).toBeCloseTo(right.max.forces.v, 2);
  },
);
