import { centeredOffsets } from "../src/domain/memberOffsets";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addPoint,
  beamExample,
  createProject,
  defaultEndConnection,
  free,
  nodalLoad,
  parseProject,
  serializeProject,
  uniformLoad,
  type Project,
  type EndConnection,
} from "../src/domain/model";
import { defaultGeometry, sectionProperties } from "../src/domain/sections";
import { noRepairs, planRepair } from "../src/domain/duplicateRepair";
import { stagedMembers } from "../src/domain/duplicateGeometry";
import { planMemberEdit } from "../src/domain/memberOperations";
import { planTransform } from "../src/domain/transform";
import {
  addMember,
  connectMeshJoint,
  reverseMember,
} from "../src/domain/editing";
import { projectV8, projectV9, rectangle } from "./fixtures/project-v8";
import {
  assignMaterial,
  duplicateSection,
  newMaterial,
  saveMaterial,
} from "../src/domain/materials";
import { internalJointBeam } from "./fixtures/internal-joint";
import { inclinedBeam } from "./fixtures/inclined-beam";
import { origin, type Point3 } from "../src/domain/geometry";
import { sectionRoll } from "../src/domain/transformGeometry";
import { combineLinearResults } from "../src/solver/combinations";
import { evaluateMemberEnvelope } from "../src/solver/envelopes";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import portal from "./fixtures/portal-planar.json";
import portalExpected from "./fixtures/portal-expected.json";
import { runDeck } from "./fixtures/solve-oofem";
import {
  navierSlabCenter,
  slabBenchmark,
  slabBenchmarkProject,
} from "./fixtures/slab-benchmark";
import {
  spatialBenchmark,
  spatialBenchmarkDifferences,
} from "./fixtures/spatial-benchmark";

const executable = process.env.OOFEM_BIN;
function solve(p: Project, caseId = "EL") {
  const input = exportOofem(p, caseId);
  return parseOofemOutput(runDeck(input.deck, executable!), input);
}

const envelopeExample = readFileSync(
  new URL("../examples/portico-em-l-envelopes.kstruct.json", import.meta.url),
  "utf8",
);

it("KS-21 · exporta articulação semirrígida como nó de braço e mola", () => {
  const p = beamExample();
  const connection: EndConnection = defaultEndConnection();
  connection.ry = { kind: "elastic", stiffness: 4200 };
  p.members[0].connectionI = connection;

  const input = exportOofem(p, "EL");
  const arm = input.nodes.find(({ connection }) => connection);
  expect(arm).toBeDefined();
  expect(arm?.master).toBe(1);
  expect(arm?.connection?.masterMask).toEqual([1, 1, 0]);
  expect(input.elements[0].start).toBe(arm?.number);
  expect(input.deck).toContain(
    `RigidArmNode ${arm?.number} coords 3 0 0 0 master 1 dofidmask 3 1 3 5 masterMask 3 1 1 0 doftype 3 2 2 0`,
  );
  expect(input.deck).toContain(
    `Spring ${input.elements.length + 1} nodes 2 1 ${arm?.number} crossSect 1 mode 3 k 4200`,
  );
  expect(input.deck).toContain("Node 1 coords 3 0 0 0 dofidmask 3 1 3 5\n");
  expect(input.deck).not.toMatch(/^Spring .*\bset\b/m);
  expect(input.deck).toContain(`nelem ${input.elements.length + 1}`);
});

it("KS-21 · exporta uma mola de rotação local em uma barra espacial", () => {
  const p = beamExample();
  p.mode = "spatial";
  p.nodes[0].restraints = {
    ux: true,
    uy: true,
    uz: true,
    rx: true,
    ry: true,
    rz: true,
  };
  const connection: EndConnection = defaultEndConnection();
  connection.rz = { kind: "elastic", stiffness: 3500 };
  p.members[0].connectionJ = connection;

  const input = exportOofem(p, "EL");
  const arm = input.nodes.find(({ connection }) => connection)!;
  expect(arm.master).toBe(2);
  expect(input.elements.at(-1)?.end).toBe(arm.number);
  expect(input.deck).toContain("domain 3dShell");
  expect(input.deck).toContain(
    `Spring ${input.elements.length + 1} nodes 2 2 ${arm.number} crossSect 1 mode 5 k 3500 orientation 3`,
  );
});

describe.skipIf(!executable)(
  "OOFEM real · KS-21 ligações de extremidade",
  () => {
    const connectionBeam = (
      kind: "rigid" | "free" | "elastic",
      segments = 8,
      reversed = false,
      stiffness = 1,
    ) => {
      const p = beamExample();
      p.mesh.segmentsPerMember = segments;
      p.nodes[0].restraints = { ...free(), ux: true, uz: true, ry: true };
      p.nodes[1].restraints = { ...free(), uz: true };
      const connection: EndConnection = defaultEndConnection();
      connection.ry = kind === "elastic" ? { kind, stiffness } : { kind };
      p.members[0].connectionI = connection;
      if (reversed) reverseMember(p, "V1");
      return { p, result: solve(p) };
    };

    it("compara ponta i articulada e rígida com as reações e momentos de referência", () => {
      const { result: hinged } = connectionBeam("free");
      const hingedA = hinged.members.V1.find(({ t }) => t === 0)!;
      expect(Math.abs(hingedA.my)).toBeLessThan(1);
      expect(
        hinged.reactions.find(({ nodeId }) => nodeId === "A")!.fz,
      ).toBeCloseTo(30000, 1);
      expect(
        hinged.reactions.find(({ nodeId }) => nodeId === "B")!.fz,
      ).toBeCloseTo(30000, 1);

      const { result: rigid } = connectionBeam("rigid");
      const rigidA = rigid.members.V1.find(({ t }) => t === 0)!;
      expect(Math.abs(rigidA.my)).toBeCloseTo(45000, 0);
      expect(
        rigid.reactions.find(({ nodeId }) => nodeId === "A")!.fz,
      ).toBeCloseTo(37500, 1);
      expect(
        rigid.reactions.find(({ nodeId }) => nodeId === "B")!.fz,
      ).toBeCloseTo(22500, 1);
    });

    it("separa as rotações da viga e dos nós com as duas extremidades articuladas", () => {
      const p = beamExample();
      const connection: EndConnection = defaultEndConnection();
      connection.ry = { kind: "free" };
      p.members[0].connectionI = structuredClone(connection);
      p.members[0].connectionJ = structuredClone(connection);

      const input = exportOofem(p, "EL");
      expect(input.nodes.filter((n) => n.connection)).toHaveLength(2);

      const result = solve(p);
      const left = result.members.V1.find(({ t }) => t === 0)!;
      const right = result.members.V1.find(({ t }) => t === 1)!;
      const middle = result.members.V1.find(({ t }) => t === 0.5)!;
      expect(Math.abs(left.my)).toBeLessThan(1);
      expect(Math.abs(right.my)).toBeLessThan(1);
      expect(middle.my).toBeCloseTo(45_000, 0);
      expect(
        result.reactions.find(({ nodeId }) => nodeId === "A")!.fz,
      ).toBeCloseTo(30_000, 0);
      expect(
        result.reactions.find(({ nodeId }) => nodeId === "B")!.fz,
      ).toBeCloseTo(30_000, 0);
    });

    it("identifica o nó, a barra e a rotação sem rigidez que recebe o momento efetivo", () => {
      const p = beamExample();
      const connection: EndConnection = defaultEndConnection();
      connection.ry = { kind: "free" };
      p.members[0].connectionI = structuredClone(connection);
      p.members[0].connectionJ = structuredClone(connection);
      p.loadPatterns[0].nodal.push({
        nodeId: "A",
        fx: 0,
        fy: 0,
        fz: 0,
        mx: 0,
        my: 100,
        mz: 0,
      });

      expect(() => exportOofem(p, "EL")).toThrow(/nó N1 \[A\].*V1.*RY/);
    });

    it("considera somente o momento efetivo do caso, inclusive fatores nulos e cancelamentos", () => {
      const p = beamExample();
      for (const key of ["connectionI", "connectionJ"] as const) {
        const c: EndConnection = defaultEndConnection();
        c.ry = { kind: "free" };
        p.members[0][key] = c;
      }
      const q = structuredClone(p.loadPatterns[0]);
      q.id = "Q";
      q.uniform = [];
      q.nodal = [{ ...nodalLoad("A"), my: 100 }];
      p.loadPatterns.push(q);
      const other = structuredClone(q);
      other.id = "R";
      p.loadPatterns.push(other);
      for (const extra of [
        [],
        [{ patternId: "Q", factor: 0 }],
        [
          { patternId: "R", factor: -1 },
          { patternId: "Q", factor: 1 },
        ],
      ]) {
        p.analysisCases[0].factors = [{ patternId: "G", factor: 1 }, ...extra];
        const result = solve(p);
        expect(result.reactions.map((r) => r.fz)).toEqual([30000, 30000]);
        expect(result.members.V1.find((s) => s.t === 0.5)!.my).toBeCloseTo(
          45000,
          0,
        );
      }
      // The node can transmit the moment to a ground spring even if the member is hinged.
      p.analysisCases[0].factors = [
        { patternId: "G", factor: 1 },
        { patternId: "Q", factor: 1 },
      ];
      p.nodes[0].springs = { ry: 20000 };
      const result = solve(p);
      expect(result.displacements.A.ry).toBeCloseTo(0.005, 8);
      expect(Math.abs(result.members.V1[0].my)).toBeLessThan(1);
    });

    it("viga biapoiada XYZ com RY local livre nas duas pontas, inclusive no referencial girado", () => {
      for (const angle of [0, Math.atan2(3, 4)]) {
        const p = beamExample();
        p.mode = "spatial";
        const c = Math.cos(angle),
          s = Math.sin(angle);
        Object.assign(p.nodes[1], { x: 6 * c, y: 6 * s });
        for (const n of p.nodes) {
          n.supportFrame = {
            kind: "spatial",
            x: { x: c, y: s, z: 0 },
            y: { x: -s, y: c, z: 0 },
          };
        }
        Object.assign(p.nodes[0].restraints, { uy: true, rx: true, rz: true });
        p.nodes[1].restraints.uy = true;
        const connection: EndConnection = defaultEndConnection();
        connection.ry = { kind: "free" };
        p.members[0].connectionI = connection;
        p.members[0].connectionJ = structuredClone(connection);
        const r = solve(p),
          stations = r.members.V1;
        expect(r.reactions.map((v) => v.fz)).toEqual([30000, 30000]);
        for (const pt of [stations[0], stations.at(-1)!])
          expect(Math.abs(pt.my)).toBeLessThan(1);
        expect(Math.abs(stations.find((v) => v.t === 0.5)!.my)).toBeCloseTo(
          45000,
          0,
        );
        expect(
          Math.hypot(r.displacements.A.rx, r.displacements.A.ry),
        ).toBeLessThan(1e-9);
        expect(
          Math.abs(-s * stations[0].rx + c * stations[0].ry),
        ).toBeGreaterThan(0.001);
      }
    });

    it("identifica a barra com as duas translações longitudinais liberadas", () => {
      const p = beamExample(),
        connection: EndConnection = defaultEndConnection();
      connection.ux = { kind: "free" };
      p.members[0].connectionI = connection;
      p.members[0].connectionJ = structuredClone(connection);
      expect(() => exportOofem(p, "EL")).toThrow(/Mecanismo na barra.*V1/);
    });

    it("valida kθ = 3EI/L em duas malhas e com a barra invertida", () => {
      const { E } = beamExample().materials[0];
      const p0 = beamExample();
      const kTheta =
        (3 * E * sectionProperties(p0.sections[0]).Iy) /
        (p0.nodes[1].x - p0.nodes[0].x);
      for (const segments of [6, 12]) {
        for (const reversed of [false, true]) {
          const { result } = connectionBeam(
            "elastic",
            segments,
            reversed,
            kTheta,
          );
          const t = reversed ? 1 : 0;
          const station = result.members.V1.find((entry) => entry.t === t)!;
          const reactionA = result.reactions.find(
            ({ nodeId }) => nodeId === "A",
          )!;
          const reactionB = result.reactions.find(
            ({ nodeId }) => nodeId === "B",
          )!;
          expect(Math.abs(station.my)).toBeCloseTo(22500, 0);
          expect(
            Math.abs(Math.abs(station.my / station.ry) - kTheta) / kTheta,
          ).toBeLessThan(0.01);
          expect(reactionA.fz + reactionB.fz).toBeCloseTo(60000, 0);
          expect(Math.abs(reactionB.fz * 6 - 10000 * 6 * 3)).toBeCloseTo(
            Math.abs(station.my),
            0,
          );
        }
      }
    });
  },
);

it("abre o exemplo de pórtico em L e preserva o projeto ao salvar e reabrir", () => {
  const project = parseProject(envelopeExample);
  expect(parseProject(serializeProject(project))).toEqual(project);
});

it.skipIf(!executable)(
  "KS-28 · peso próprio de barras e painéis fecha as reações no OOFEM",
  () => {
    const beam = beamExample();
    beam.materials[0].density = 2500;
    Object.assign(beam.sections[0], { width: 0.2, height: 0.4 });
    beam.loadPatterns[0].uniform = [];
    Object.assign(beam.loadPatterns[0].selfWeight, {
      enabled: true,
      direction: "-Z",
      gravity: 10,
      multiplier: 1,
    });

    const beamResult = solve(beam);
    expect(
      beamResult.reactions.find(({ nodeId }) => nodeId === "A")!.fz,
    ).toBeCloseTo(6000, 0);
    expect(
      beamResult.reactions.find(({ nodeId }) => nodeId === "B")!.fz,
    ).toBeCloseTo(6000, 0);

    const slab = slabBenchmarkProject();
    const definition = slab.slabs[0];
    slab.materials.find(({ id }) => id === definition.materialId)!.density =
      2500;
    slab.loadPatterns[0].pressure = [];
    Object.assign(slab.loadPatterns[0].selfWeight, {
      enabled: true,
      direction: "-Z",
      gravity: 10,
      multiplier: 1,
    });

    const slabResult = solve(slab).slab!;
    expect(slabResult.totalLoadZ).toBeCloseTo(-30_000, 0);
    expect(slabResult.totalReactionZ).toBeCloseTo(30_000, 0);
    expect(slabResult.center.uz).toBeLessThan(0);
  },
);

it.skipIf(!executable)(
  "KS-28 · conserva massa e braço de alavanca com excentricidade e EI modificado",
  () => {
    const p = beamExample(),
      m = p.members[0];
    Object.assign(p.sections[0], { width: 0.2, height: 0.4 });
    p.materials[0].density = 2500;
    m.stiffness = { eiy: 0.5 };
    m.offsets = structuredClone(centeredOffsets);
    m.offsets.i.rigidLength = 0.75;
    m.offsets.j.eccentricity.x = 0.6;
    p.loadPatterns[0].uniform = [];
    Object.assign(p.loadPatterns[0].selfWeight, { enabled: true, gravity: 10 });
    const automatic = solve(p);
    expect(automatic.reactions.reduce((sum, r) => sum + r.fz, 0)).toBeCloseTo(
      13200,
      1,
    );
    p.loadPatterns[0].selfWeight.enabled = false;
    p.loadPatterns[0].uniform = [{ ...uniformLoad(m.id), qz: -2000 }];
    const manual = solve(p);
    expect(automatic.reactions).toEqual(manual.reactions);
    expect(automatic.members).toEqual(manual.members);
  },
);
describe.skipIf(!executable)("OOFEM real · benchmarks analíticos", () => {
  it("KS-20 · rolete XZ transmite somente a reação normal", () => {
    const p = inclinedBeam();
    const r = solve(p);
    const [a, b] = r.reactions;
    expect(a.fx).toBeCloseTo(-22500, 2);
    expect(a.fz).toBeCloseTo(30000, 2);
    expect(b.fx).toBeCloseTo(22500, 2);
    expect(b.fz).toBeCloseTo(30000, 2);
    expect(0.6 * b.fx + 0.8 * b.fz).toBeCloseTo(37500, 2);
    expect(0.8 * b.fx - 0.6 * b.fz).toBeCloseTo(0, 2);
    const tip = r.displacements.B;
    expect(0.6 * tip.ux + 0.8 * tip.uz).toBeCloseTo(0, 12);
    expect(tip.ux).toBeCloseTo((22500 * 6) / (2e11 * 0.03), 12);
    expect(tip.uz).toBeCloseTo(-0.75 * tip.ux, 12);
    expect(r.members.V1.at(-1)).toMatchObject(tip);
    expect(r.rawOutput).toMatch(/Node\s+2 iDof\s+3 reaction\s+3\.7500e\+04/);

    p.loadPatterns[0].nodal = [
      { ...nodalLoad("B"), fx: 3000, fz: -4000, my: 1200 },
    ];
    const result = solve(p);
    expect(result.reactions[0].fx).toBeCloseTo(-28650, 2);
    expect(result.reactions[0].fz).toBeCloseTo(29800, 2);
    expect(result.reactions[1].fx).toBeCloseTo(25650, 2);
    expect(result.reactions[1].fz).toBeCloseTo(34200, 2);
    const combined = combineLinearResults(
      p,
      {
        id: "C",
        name: "Dobrada",
        type: "linear",
        factors: [{ caseId: "EL", factor: 2 }],
      },
      new Map([["EL", result]]),
    );
    p.analysisCases[0].factors[0].factor = 2;
    const direct = solve(p);
    expect(combined.reactions[1].fx).toBeCloseTo(direct.reactions[1].fx, 2);
    expect(combined.reactions[1].fz).toBeCloseTo(direct.reactions[1].fz, 2);
    expect(combined.displacements.B.uz).toBeCloseTo(
      direct.displacements.B.uz,
      11,
    );
  });

  it("KS-19/20 · inverter i/j conserva o vínculo, as reações e o deslocamento do rolete", () => {
    const p = inclinedBeam();
    const original = solve(p);
    reverseMember(p, "V1");
    const reversed = solve(p);
    for (const [i, reaction] of original.reactions.entries()) {
      expect(reversed.reactions[i].nodeId).toBe(reaction.nodeId);
      expect(reversed.reactions[i].fx).toBeCloseTo(reaction.fx, 2);
      expect(reversed.reactions[i].fz).toBeCloseTo(reaction.fz, 2);
    }
    expect(reversed.displacements.B.ux).toBeCloseTo(
      original.displacements.B.ux,
      12,
    );
    expect(reversed.displacements.B.uz).toBeCloseTo(
      original.displacements.B.uz,
      12,
    );
  });

  it.each(["horizontal", "vertical"] as const)(
    "KS-20 · distingue arredondamento de desequilíbrio em balanço %s com engaste a 31°",
    (orientation) => {
      const p = beamExample();
      const [root, tip] = p.nodes;
      root.restraints = { ...free(), ux: true, uz: true, ry: true };
      root.supportFrame = { kind: "planar", angle: 31 };
      tip.restraints = free();
      if (orientation === "vertical") Object.assign(tip, { x: 0, z: 6 });
      // The force error also contributes a moment about the free end.
      p.nodes = [tip, root];
      p.loadPatterns[0].uniform = [];
      p.loadPatterns[0].nodal = [{ ...nodalLoad(tip.id), fz: -12345 }];
      const input = exportOofem(p, "EL");
      const raw = runDeck(input.deck, executable!);
      const [reaction] = parseOofemOutput(raw, input).reactions;
      expect(Math.abs(reaction.fx)).toBeLessThan(0.5);
      expect(Math.abs(reaction.fz - 12345)).toBeLessThan(0.5);
      expect(reaction.my).toBeCloseTo(
        orientation === "horizontal" ? -74070 : 0,
        2,
      );
      const corrupted = raw.replace(
        /(Node\s+\d+\s+iDof\s+1\s+reaction\s+)(\S+)/,
        (_, prefix, value) => prefix + (Number(value) + 10).toExponential(4),
      );
      expect(corrupted).not.toBe(raw);
      expect(() => parseOofemOutput(corrupted, input)).toThrow(
        /equilíbrio global/,
      );
    },
  );

  it("KS-20 · rolete de ângulo zero reproduz o apoio global legado", () => {
    const p = beamExample();
    const global = solve(p);
    p.nodes[1].supportFrame = { kind: "planar", angle: 0 };
    const local = solve(p);
    expect(local.reactions).toEqual(global.reactions);
    expect(local.displacements).toEqual(global.displacements);
    expect(local.members).toEqual(global.members);
  });

  it("KS-20 · apoio XYZ oblíquo equivale à rotação global de um balanço de referência", () => {
    const p = beamExample();
    p.mode = "spatial";
    p.nodes[0].restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    p.nodes[1].restraints.rx = true;
    p.loadPatterns[0].nodal = [
      {
        ...nodalLoad("B"),
        fx: 1200,
        fy: 700,
        fz: -900,
        mx: 500,
        my: -220,
        mz: 80,
      },
    ];
    const original = solve(p);
    const rotate = ({ x, y, z }: Point3) => ({
      x: (x + 2 * y - 2 * z) / 3,
      y: (2 * x + y + 2 * z) / 3,
      z: (2 * x - 2 * y - z) / 3,
    });
    const [a, b] = p.nodes;
    Object.assign(b, rotate(b));
    b.supportFrame = {
      kind: "spatial",
      x: { x: 1, y: 2, z: 2 },
      y: { x: 3, y: 3, z: 0 },
    };
    p.members[0].roll = sectionRoll(a, b, rotate({ x: 0, y: 0, z: 1 }));
    const pad = p.loadPatterns[0];
    const [load] = pad.nodal;
    const f = rotate({ x: load.fx, y: load.fy, z: load.fz });
    const m = rotate({ x: load.mx, y: load.my, z: load.mz });
    pad.nodal[0] = {
      nodeId: "B",
      fx: f.x,
      fy: f.y,
      fz: f.z,
      mx: m.x,
      my: m.y,
      mz: m.z,
    };
    const q = rotate({ x: 0, y: 0, z: -10000 });
    pad.uniform[0] = { memberId: "V1", qx: q.x, qy: q.y, qz: q.z };
    const rotated = solve(p);
    for (const [i, reaction] of original.reactions.entries()) {
      const force = rotate({ x: reaction.fx, y: reaction.fy, z: reaction.fz });
      const moment = rotate({ x: reaction.mx, y: reaction.my, z: reaction.mz });
      for (const k of ["x", "y", "z"] as const) {
        expect(Math.abs(rotated.reactions[i][`f${k}`] - force[k])).toBeLessThan(
          2,
        );
        expect(
          Math.abs(rotated.reactions[i][`m${k}`] - moment[k]),
        ).toBeLessThan(2);
      }
    }
    for (const [i, station] of original.members.V1.entries()) {
      const u = rotate({ x: station.ux, y: station.uy, z: station.uz });
      const r = rotate({ x: station.rx, y: station.ry, z: station.rz });
      for (const k of ["x", "y", "z"] as const) {
        expect(rotated.members.V1[i][`u${k}`]).toBeCloseTo(u[k], 9);
        expect(rotated.members.V1[i][`r${k}`]).toBeCloseTo(r[k], 9);
      }
      for (const k of ["n", "vy", "vz", "mx", "my", "mz"] as const)
        expect(Math.abs(rotated.members.V1[i][k] - station[k])).toBeLessThan(2);
    }
  });
  it.each([
    {
      geometry: defaultGeometry.circle,
      iy: 4908738.521234051,
      iz: 4908738.521234051,
      j: 9817477.042468103,
    },
    {
      geometry: defaultGeometry.tube,
      iy: 2898119.222936584,
      iz: 2898119.222936584,
      j: 5796238.445873168,
    },
    {
      geometry: defaultGeometry.i,
      iy: 20982666.66666667,
      iz: 1669906.666666667,
      j: 80346.666666667,
    },
  ])(
    "KS-18 · flexão biaxial e torção no balanço 3D com seção $geometry.shape",
    ({ geometry, iy, iz, j }) => {
      const p = createProject("spatial");
      const E = 210e9,
        nu = 0.3,
        G = E / (2 * (1 + nu)),
        L = 2,
        fy = 300,
        fz = -900,
        mx = 15;
      Object.assign(p.materials[0], { E, nu });
      const section = {
        ...geometry,
        id: "ensaio",
        name: "Seção de ensaio",
        materialId: p.materials[0].id,
      };
      p.sections.push(section);
      const root = addPoint(p, { x: 0, y: 0, z: 0 }),
        tip = addPoint(p, { x: L, y: 0, z: 0 });
      root.restraints = {
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: true,
        rz: true,
      };
      const bar = addMember(p, root, tip, { sectionId: section.id, roll: 0 });
      p.loadPatterns[0].nodal = [{ ...nodalLoad(tip.id), fy, fz, mx }];
      for (const roll of [0, 90]) {
        bar.roll = roll;
        const result = solve(p);
        const u = result.displacements[tip.id];
        // Independent moments of inertia in mm⁴. A quarter-turn exchanges the bending axes.
        const expected = [
          [u.uy, (fy * L ** 3) / (3 * E * (roll === 0 ? iz : iy) * 1e-12)],
          [u.uz, (fz * L ** 3) / (3 * E * (roll === 0 ? iy : iz) * 1e-12)],
          [u.rx, (mx * L) / (G * j * 1e-12)],
        ];
        for (const [computed, reference] of expected)
          expect(
            Math.abs(computed - reference) / Math.abs(reference),
          ).toBeLessThan(2e-6);
        expect(result.reactions[0]).toMatchObject({
          nodeId: root.id,
          fy: -fy,
          fz: -fz,
          mx: -mx,
        });
      }
    },
  );

  it("KS-17 · dobrar E em uma seção reduz à metade somente a flecha de seu balanço", () => {
    const p = createProject();
    const sectionA = rectangle(p.sections[0]);
    Object.assign(sectionA, { width: 0.2, height: 0.3 });
    const sectionB = duplicateSection(p, sectionA.id);
    const steel = {
      ...newMaterial(p),
      name: "Aço de ensaio",
      E: 210e9,
      nu: 0.3,
      density: 7850,
      alpha: 12e-6,
    };
    saveMaterial(p, steel, "create");
    const tips: string[] = [],
      roots: string[] = [];
    const P = 10500,
      L = 3;
    for (const [i, section] of p.sections.entries()) {
      assignMaterial(p, { kind: "section", id: section.id }, steel.id);
      const root = addPoint(p, { x: 0, y: 0, z: 2 * i }),
        tip = addPoint(p, { x: L, y: 0, z: 2 * i });
      root.restraints = { ...free(), ux: true, uz: true, ry: true };
      addMember(p, root, tip, { sectionId: section.id, roll: 0 });
      p.loadPatterns[0].nodal.push({ ...nodalLoad(tip.id), fz: -P });
      roots.push(root.id);
      tips.push(tip.id);
    }
    const beforeLoads = structuredClone(p.loadPatterns);
    const materialNumbers = (deck: string) =>
      [...deck.matchAll(/^SimpleCS .* material (\d+) set /gm)].map((m) =>
        Number(m[1]),
      );
    const deck = exportOofem(p, "EL").deck;
    expect(deck).toContain(
      "IsoLE 2 d 7850 E 210000000000 n 0.3 tAlpha 0.000012",
    );
    expect(materialNumbers(deck)).toEqual([2, 2]);
    const shared = solve(p);
    const copy = newMaterial(p, steel);
    saveMaterial(p, copy, "create");
    assignMaterial(p, { kind: "section", id: sectionB }, copy.id);
    saveMaterial(p, { ...copy, E: 2 * steel.E }, "edit");
    const independentDeck = exportOofem(p, "EL").deck;
    expect(materialNumbers(independentDeck)).toEqual([2, 3]);
    expect(independentDeck).toContain(
      "IsoLE 3 d 7850 E 420000000000 n 0.3 tAlpha 0.000012",
    );
    const independent = solve(p);
    const I = (sectionA.width * sectionA.height ** 3) / 12;
    const predicted = (-P * L ** 3) / (3 * steel.E * I);
    for (const [i, id] of tips.entries()) {
      expect(shared.displacements[id].uz).toBeCloseTo(predicted, 10);
      expect(independent.displacements[id].uz).toBeCloseTo(
        i === 0 ? predicted : predicted / 2,
        10,
      );
      for (const r of [shared, independent]) {
        const reaction = r.reactions.find((v) => v.nodeId === roots[i])!;
        expect(reaction.fz).toBeCloseTo(P, 1);
        expect(reaction.my).toBeCloseTo(-P * L, 1);
      }
    }
    expect(p.loadPatterns).toEqual(beforeLoads);
  });

  it("KS-17 · a viga v8 recupera tAlpha zero e reproduz a solução analítica", () => {
    const p = parseProject(JSON.stringify(projectV8(beamExample())));
    expect(exportOofem(p, "EL").deck).toContain(
      "IsoLE 1 d 7850 E 200000000000 n 0.3 tAlpha 0",
    );
    const r = solve(p),
      middle = r.members.V1.find((s) => s.t === 0.5)!;
    expect(middle.uz).toBeCloseTo(-0.0084375, 8);
    expect(middle.m).toBeCloseTo(45000, 1);
    for (const support of r.reactions) expect(support.fz).toBeCloseTo(30000, 1);
  });

  it("KS-15 · carga de 9 kN a 2 m na barra íntegra, reações, salto, flexão e flecha", () => {
    const p = internalJointBeam();
    const section = rectangle(p.sections[0]);
    const EI = (p.materials[0].E * section.width * section.height ** 3) / 12;
    // Simple supports, point load P at a, b=L−a: w(a) = −P a² b²/(3 E I L).
    const expectedUz = (-9000 * 2 ** 2 * 4 ** 2) / (3 * EI * 6);
    for (const count of [8, 6, 13]) {
      p.mesh.segmentsPerMember = count;
      const r = solve(p);
      const [a, b] = r.reactions;
      expect(a.fz).toBeCloseTo(6000, 1);
      expect(b.fz).toBeCloseTo(3000, 1);
      expect(a.fz + b.fz).toBeCloseTo(9000, 1);
      expect(b.fz * 6 - 9000 * 2).toBeCloseTo(0, 1);
      const stations = r.members.V1.filter((s) => s.t === 1 / 3);
      expect(stations.map((s) => s.side)).toEqual(["left", "right"]);
      expect(stations[0].v).toBeCloseTo(6000, 1);
      expect(stations[1].v).toBeCloseTo(-3000, 1);
      for (const s of stations) {
        expect(s.m).toBeCloseTo(12000, 1);
        expect(s.uz).toBeCloseTo(expectedUz, 9);
        expect(s.uz).toBe(r.displacements.C.uz);
      }
    }
  });
  it("KS-15 · engaste interno equilibra a carga uniforme nos dois balanços", () => {
    const p = internalJointBeam();
    p.nodes[0].restraints = free();
    p.nodes[1].restraints = free();
    p.nodes[2].restraints = { ...free(), ux: true, uz: true, ry: true };
    p.loadPatterns[0].nodal = [];
    p.loadPatterns[0].uniform = [{ ...uniformLoad("V1"), qz: -1000 }];
    const r = solve(p);
    expect(r.reactions).toHaveLength(1);
    expect(r.reactions[0]).toMatchObject({ nodeId: "C", fz: 6000, my: -6000 });
    const [left, right] = r.members.V1.filter((s) => s.t === 1 / 3);
    expect(right.v - left.v).toBeCloseTo(6000, 1);
    expect(left.m).toBeCloseTo(-2000, 1);
    expect(right.m).toBeCloseTo(-8000, 1);
  });
  it("KS-15 · montante excêntrico em banzo espacial reproduz duas peças divididas manualmente", () => {
    const p = internalJointBeam();
    p.mode = "spatial";
    p.members[0].roll = 23;
    p.nodes[0].restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    p.nodes[1].restraints = free();
    const tip = addPoint(p, { x: 2, y: 0, z: 2 });
    const post = addMember(p, p.nodes[2], tip);
    p.meshConnections = [];
    connectMeshJoint(p, "V1", { kind: "node", id: "C" });
    p.loadPatterns[0].nodal = [
      { ...nodalLoad(tip.id), fx: 1100, fy: 1700, fz: -9000 },
    ];
    p.loadPatterns[0].uniform = [{ ...uniformLoad("V1"), qz: -650 }];
    const manual = structuredClone(p);
    manual.meshConnections = [];
    manual.members[0].end = "C";
    manual.members.push({
      ...p.members[0],
      id: "V2",
      name: "Trecho direito",
      start: "C",
    });
    manual.loadPatterns[0].uniform.push({
      ...manual.loadPatterns[0].uniform[0],
      memberId: "V2",
    });
    const reference = solve(manual);
    for (const count of [5, 8, 12]) {
      p.mesh.segmentsPerMember = count;
      const result = solve(p);
      expect(Object.keys(result.members)).toEqual(["V1", post.id]);
      for (const n of p.nodes)
        for (const k of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
          expect(result.displacements[n.id][k]).toBeCloseTo(
            reference.displacements[n.id][k],
            8,
          );
      const reaction = result.reactions[0];
      // Sum of forces and moments about the fixed end in global axes.
      const equilibrium = {
        fx: -1100,
        fy: -1700,
        fz: 12900,
        mx: 3400,
        my: -31900,
        mz: -3400,
      };
      for (const k of ["fx", "fy", "fz", "mx", "my", "mz"] as const) {
        expect(Math.abs(reaction[k] - equilibrium[k])).toBeLessThan(1);
        expect(Math.abs(reaction[k] - reference.reactions[0][k])).toBeLessThan(
          1,
        );
      }
      const chord = result.members.V1,
        postStations = result.members[post.id];
      const [before, after] = chord.filter((s) => s.t === 1 / 3);
      for (const [a, b] of [
        [chord[0], reference.members.V1[0]],
        [before, reference.members.V1.at(-1)!],
        [after, reference.members.V2[0]],
        [chord.at(-1)!, reference.members.V2.at(-1)!],
        [postStations[0], reference.members[post.id][0]],
        [postStations.at(-1)!, reference.members[post.id].at(-1)!],
      ])
        for (const k of ["n", "vy", "vz", "mx", "my", "mz"] as const)
          expect(Math.abs(a[k] - b[k])).toBeLessThan(1);
    }
  });
  it("laje da issue #9: equilíbrio e convergência da flecha e dos momentos no centro", () => {
    const p = slabBenchmarkProject();
    const [slab] = p.slabs;
    const reference = navierSlabCenter();
    const fields = ["uz", "mx", "my"] as const;
    let previous = fields.map(() => Infinity);
    for (const [nx, ny] of slabBenchmark.refinements) {
      slab.divisionsX = nx;
      slab.divisionsY = ny;
      const result = solve(p).slab!;
      expect(result.slabId).toBe(slab.id);
      expect(result.nodes).toHaveLength((nx + 1) * (ny + 1));
      expect(result.elements).toHaveLength(2 * nx * ny);
      expect(result.totalLoadZ).toBe(-60000);
      expect(Math.abs(result.totalReactionZ - 60000)).toBeLessThan(1);
      const relative = fields.map((key) =>
        Math.abs((result.center[key] - reference[key]) / reference[key]),
      );
      for (const [index, error] of relative.entries())
        expect(error).toBeLessThan(previous[index]);
      previous = relative;
    }
    for (const error of previous) expect(error).toBeLessThan(0.005);
  });

  it("apoios opostos e pressão com fatores reproduzem a flexão de faixa com ν nulo", () => {
    const p = slabBenchmarkProject();
    const [slab] = p.slabs;
    p.materials.find(({ id }) => id === slab.materialId)!.nu = 0;
    slab.x = -2;
    slab.y = 5;
    slab.divisionsX = 31;
    slab.divisionsY = 24;
    slab.supports.yMin = slab.supports.yMax = false;
    p.loadPatterns.push({
      id: "W",
      name: "Sucção",
      nodal: [],
      uniform: [],
      pressure: [{ slabId: slab.id, pz: 500 }],
      selfWeight: { ...p.loadPatterns[0].selfWeight },
    });
    p.analysisCases.push({
      id: "S",
      name: "Pressão ascendente",
      type: "linear-static",
      factors: [
        { patternId: "G", factor: -1 },
        { patternId: "W", factor: 2 },
      ],
    });
    const result = solve(p, "S").slab!;
    const q = 6000;
    const rigidity = (slabBenchmark.E * slab.thickness ** 3) / 12;
    const expectedUz = (5 * q * slab.lengthX ** 4) / (384 * rigidity);
    const expectedMx = (-q * slab.lengthX ** 2) / 8;
    expect(result.totalLoadZ).toBe(72000);
    expect(Math.abs(result.totalReactionZ + 72000)).toBeLessThan(1);
    expect(Math.abs(result.center.uz / expectedUz - 1)).toBeLessThan(0.005);
    expect(Math.abs(result.center.mx / expectedMx - 1)).toBeLessThan(0.005);
    expect(Math.abs(result.center.my)).toBeLessThan(
      0.005 * Math.abs(expectedMx),
    );
  });

  it("rejeita saída de laje sem pontos de Gauss ou em desequilíbrio", () => {
    const input = exportOofem(slabBenchmarkProject(), "EL");
    const raw = runDeck(input.deck, executable!);
    expect(() =>
      parseOofemOutput(raw.replace(/\bGP\s+1\.1\b/, "GP 1.4"), input),
    ).toThrow(/Momentos inválidos/);
    expect(() =>
      parseOofemOutput(
        raw.replace(
          /(iDof\s+3\s+reaction\s+)\S+/,
          (_, prefix: string) => `${prefix}1e+06`,
        ),
        input,
      ),
    ).toThrow(/equilíbrio/);
  });

  it("pórtico plano de dois pavimentos concorda com a solução independente por rigidez direta", () => {
    const p = createProject();
    p.materials[0].E = portal.e;
    p.sections = portal.sections.map(([width, height], i) => ({
      shape: "rectangle",
      id: `R${i}`,
      name: `Seção R${i}`,
      materialId: p.materials[0].id,
      width,
      height,
    }));
    p.nodes = portal.nodes.map(([x, z], i) => {
      const fixed = portal.fixed.includes(i);
      return {
        id: `N${i}`,
        name: `N${i}`,
        x,
        y: 0,
        z,
        restraints: { ...free(), ux: fixed, uz: fixed, ry: fixed },
      };
    });
    p.members = portal.members.map(([start, end, section], i) => ({
      id: `B${i}`,
      name: `B${i}`,
      start: `N${start}`,
      end: `N${end}`,
      sectionId: `R${section}`,
      roll: 0,
    }));
    p.loadPatterns[0].uniform = portal.uniform.map(([member, qx, qz]) => ({
      ...uniformLoad(`B${member}`),
      qx,
      qz,
    }));
    p.loadPatterns[0].nodal = portal.nodal.map(([node, fx, fz, my]) => ({
      ...nodalLoad(`N${node}`),
      fx,
      fz,
      my,
    }));
    const result = solve(p);
    const nearPrintedForce = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThan(
        0.1 + Math.abs(expected) * 5e-5,
      );
    for (const [i, [fx, fz, my]] of portalExpected.reactions.entries()) {
      const r = result.reactions.find(
        (item) => item.nodeId === `N${portal.fixed[i]}`,
      )!;
      nearPrintedForce(r.fx, fx);
      nearPrintedForce(r.fz, fz);
      nearPrintedForce(r.my, my);
    }
    for (const [
      i,
      [ux, uz, ry],
    ] of portalExpected.roofDisplacements.entries()) {
      const d = result.displacements[`N${i + portal.nodes.length - 2}`];
      expect(d.ux).toBeCloseTo(ux, 9);
      expect(d.uz).toBeCloseTo(uz, 9);
      expect(d.ry).toBeCloseTo(ry, 9);
    }
    const roof = result.members[`B${portal.members.length - 1}`];
    nearPrintedForce(roof[0].m, portalExpected.roofBeamEndMoments[0]);
    nearPrintedForce(roof.at(-1)!.m, portalExpected.roofBeamEndMoments[1]);
  });
  it("viga 6 m: reações de 30 kN, momento de 45 kN.m e flecha de 8,4375 mm", () => {
    const r = solve(beamExample());
    expect(r.reactions.find((r) => r.nodeId === "A")!.fz).toBeCloseTo(30000, 1);
    expect(r.reactions.find((r) => r.nodeId === "B")!.fz).toBeCloseTo(30000, 1);
    const middle = r.members.V1.find((s) => s.t === 0.5)!;
    expect(middle.uz).toBeCloseTo(-0.0084375, 8);
    expect(middle.m).toBeCloseTo(45000, 1);
  });
  it("viga de 6 m íntegra, dividida em 2 + 4 m e reunida conserva reações, flecha e momento", () => {
    const original = beamExample(),
      split = planMemberEdit(original, {
        kind: "split",
        id: "V1",
        reference: { kind: "distance", metres: 2 },
      });
    const joined = planMemberEdit(split.project, {
      kind: "join",
      ids: [...split.after].reverse(),
    });
    for (const [p, middleId, t] of [
      [original, "V1", 0.5],
      [split.project, split.after[1], 0.25],
      [joined.project, "V1", 0.5],
    ] as const) {
      const result = solve(p);
      for (const id of ["A", "B"])
        expect(result.reactions.find((r) => r.nodeId === id)!.fz).toBeCloseTo(
          30000,
          1,
        );
      const atMidspan = result.members[middleId].find((s) => s.t === t)!;
      expect(atMidspan.m).toBeCloseTo(45000, 1);
      expect(atMidspan.uz).toBeCloseTo(-0.0084375, 8);
    }
  });
  it("reparar duas barras invertidas aplica a carga escolhida uma única vez", () => {
    const p = beamExample();
    p.members.push({
      ...p.members[0],
      id: "INV",
      name: "Invertida",
      start: "B",
      end: "A",
    });
    p.loadPatterns[0].uniform.push({
      ...p.loadPatterns[0].uniform[0],
      memberId: "INV",
    });
    const stage = stagedMembers(p, 0.001, []),
      choices = noRepairs();
    choices.members = [{ drop: "V1", keep: "INV" }];
    const preview = planRepair(stage, choices);
    expect(preview.project).toBeNull();
    expect(preview.questions).toHaveLength(1);
    for (const [value, reaction] of [
      ["use:V1", 30000],
      ["all", 60000],
    ] as const) {
      choices.answers[preview.questions[0].key] = value;
      const result = solve(planRepair(stage, choices).project!);
      for (const id of ["A", "B"])
        expect(result.reactions.find((r) => r.nodeId === id)!.fz).toBeCloseTo(
          reaction,
          1,
        );
    }
  });
  it("duplicar a carga duplica deslocamentos e esforços", () => {
    const p = beamExample();
    p.analysisCases[0].factors[0].factor = 2;
    const r = solve(p);
    expect(r.members.V1[4].uz).toBeCloseTo(-0.016875, 8);
    expect(r.members.V1[4].m).toBeCloseTo(90000, 1);
  });
  it("balanço horizontal com força nodal: PL³/3EI e momento negativo na raiz", () => {
    const p = beamExample();
    p.nodes[0].restraints.ry = true;
    p.nodes[1].restraints.uz = false;
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -1000 }];
    const r = solve(p);
    expect(r.displacements.B.uz).toBeCloseTo(
      (-1000 * 6 ** 3) / (3 * 2e11 * 1e-4),
      8,
    );
    expect(r.members.V1[0].m).toBeCloseTo(-6000, 1);
  });
  it("pilar vertical sob carga global horizontal: direção e equilíbrio", () => {
    const p = beamExample();
    p.nodes[1].x = 0;
    p.nodes[1].z = 6;
    p.nodes[0].restraints.ry = true;
    p.nodes[1].restraints.uz = false;
    p.loadPatterns[0].uniform = [{ ...uniformLoad("V1"), qx: 1000 }];
    const r = solve(p);
    expect(r.displacements.B.ux).toBeCloseTo(
      (1000 * 6 ** 4) / (8 * 2e11 * 1e-4),
      8,
    );
    expect(r.reactions[0].fx).toBeCloseTo(-6000, 1);
    expect(r.reactions[0].my).toBeCloseTo(-18000, 1);
  });
  it("balanço inclinado combina parcela axial e flexional em coordenadas globais", () => {
    const p = beamExample();
    p.nodes[1].x = 3;
    p.nodes[1].z = 4;
    p.nodes[0].restraints.ry = true;
    p.nodes[1].restraints.uz = false;
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fx: 1000 }];
    const r = solve(p),
      axial = (1000 * 5) / (2e11 * 0.03),
      bending = (1000 * 5 ** 3) / (3 * 2e11 * 1e-4);
    expect(r.displacements.B.ux).toBeCloseTo(
      axial * 0.6 ** 2 + bending * 0.8 ** 2,
      8,
    );
    expect(r.displacements.B.uz).toBeCloseTo((axial - bending) * 0.6 * 0.8, 8);
  });
  it("balanços espelhados em YZ conservam eixos e sinais em cada estação", () => {
    const p = createProject("spatial");
    const bar = addMember(
      p,
      { x: 2, y: 1, z: 0 },
      { x: 4, y: 1, z: 0 },
      { sectionId: p.sections[0].id, roll: 27 },
    );
    Object.assign(p.sections[0], { width: 0.14, height: 0.32 });
    p.nodes[0].restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    p.loadPatterns[0].nodal = [
      {
        ...nodalLoad(bar.end),
        fx: 1200,
        fy: 800,
        fz: -2600,
        mx: 150,
        my: 70,
        mz: -90,
      },
    ];
    p.loadPatterns[0].uniform = [
      { ...uniformLoad(bar.id), qx: 80, qy: -130, qz: -450 },
    ];
    const plan = planTransform(
      p,
      [{ kind: "member", id: bar.id }],
      { kind: "mirror", center: origin, normal: { ...origin, x: 1 } },
      { supports: true, patterns: ["G"], conflicts: "ask" },
    );
    expect(plan.ready).toBe(true);
    const r = solve(plan.project),
      map = plan.maps[0];
    const u = r.displacements[bar.end],
      U = r.displacements[map.nodes.get(bar.end)!];
    for (const [k, sign] of Object.entries({
      ux: -1,
      uy: 1,
      uz: 1,
      rx: 1,
      ry: -1,
      rz: -1,
    }) as [keyof typeof u, number][])
      expect(U[k]).toBeCloseTo(sign * u[k], 9);
    const root = r.reactions.find((n) => n.nodeId === bar.start)!,
      mirror = r.reactions.find((n) => n.nodeId === map.nodes.get(bar.start))!;
    const check = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThan(
        0.05 + Math.abs(expected) * 0.00005,
      );
    // Independent statics at x=2 m: R = -(F+qL), M = -(M_tip+r×F+r_mid×qL).
    for (const [k, value] of Object.entries({
      fx: -1360,
      fy: -540,
      fz: 3500,
      mx: -150,
      my: -6170,
      mz: -1250,
    }) as ["fx" | "fy" | "fz" | "mx" | "my" | "mz", number][])
      check(root[k], value);
    for (const [k, sign] of Object.entries({
      fx: -1,
      fy: 1,
      fz: 1,
      mx: 1,
      my: -1,
      mz: -1,
    }) as ["fx" | "fy" | "fz" | "mx" | "my" | "mz", number][])
      check(mirror[k], sign * root[k]);
    const original = r.members[bar.id],
      copy = r.members[map.members.get(bar.id)!];
    expect(copy.length).toBe(original.length);
    for (const [i, station] of original.entries()) {
      expect(copy[i].t).toBe(station.t);
      for (const [k, sign] of Object.entries({
        n: 1,
        vy: -1,
        vz: 1,
        mx: -1,
        my: 1,
        mz: -1,
      }) as ["n" | "vy" | "vz" | "mx" | "my" | "mz", number][])
        check(copy[i][k], sign * station[k]);
    }
  });
  it("balanço espacial v9 com retângulo girado: flexão biaxial, normal e torção", () => {
    const p = createProject("spatial");
    const a = addPoint(p, { x: 0, y: 2, z: 1 });
    const b = addPoint(p, { x: 3, y: 2, z: 1 });
    a.restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    p.members = [
      {
        id: "B1",
        name: "B1",
        start: a.id,
        end: b.id,
        sectionId: "rect",
        roll: 90,
      },
    ];
    p.loadPatterns[0].nodal = [
      { ...nodalLoad(b.id), fx: 1800, fy: 1200, fz: -2400, mx: 600 },
    ];
    const { width, height } = rectangle(p.sections[0]);
    const { E, nu } = p.materials[0];
    const iy = (width * height ** 3) / 12;
    const iz = (height * width ** 3) / 12;
    const j = 0.00012180866179401363;
    const g = E / (2 * (1 + nu));
    const migrated = parseProject(JSON.stringify(projectV9(p)));
    expect(migrated).toEqual(p);
    const r = solve(migrated),
      u = r.displacements[b.id];
    expect(u.ux).toBeCloseTo((1800 * 3) / (E * width * height), 9);
    expect(u.uy).toBeCloseTo((1200 * 3 ** 3) / (3 * E * iy), 8);
    expect(u.uz).toBeCloseTo((-2400 * 3 ** 3) / (3 * E * iz), 8);
    expect(u.rx).toBeCloseTo((600 * 3) / (g * j), 8);
    expect(u.ry).toBeCloseTo((2400 * 3 ** 2) / (2 * E * iz), 8);
    expect(u.rz).toBeCloseTo((1200 * 3 ** 2) / (2 * E * iy), 8);
    expect(r.reactions[0]).toEqual({
      nodeId: a.id,
      fx: -1800,
      fy: -1200,
      fz: 2400,
      mx: -600,
      my: -7200,
      mz: -3600,
    });
    const { n, vy, vz, mx, my, mz } = r.members.B1[0];
    expect([n, vy, vz, mx, my, mz]).toEqual([
      1800, -2400, -1200, 600, 3600, -7200,
    ]);
  });
  it("pórtico espacial assimétrico em dois pavimentos concorda com a rigidez direta independente", () => {
    const model = spatialBenchmark();
    expect(spatialBenchmarkDifferences(model, solve(model))).toEqual([]);
  });
  it("KS-19 · inverter a diagonal girada preserva a resposta global e transforma a face de corte", () => {
    const p = spatialBenchmark();
    const before = solve(p);
    reverseMember(p, "B5");
    const after = solve(p);
    for (const original of before.reactions) {
      const reversed = after.reactions.find(
        ({ nodeId }) => nodeId === original.nodeId,
      )!;
      for (const key of ["fx", "fy", "fz", "mx", "my", "mz"] as const)
        expect(Math.abs(reversed[key] - original[key])).toBeLessThan(
          0.01 + 6e-5 * Math.abs(original[key]),
        );
    }
    for (const node of p.nodes) {
      const original = before.displacements[node.id];
      for (const key of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
        expect(after.displacements[node.id][key]).toBeCloseTo(original[key], 9);
    }
    expect(after.members.B5).toHaveLength(before.members.B5.length);
    for (const [index, original] of before.members.B5.entries()) {
      const reversed = after.members.B5.at(-1 - index)!;
      expect(reversed.t).toBeCloseTo(1 - original.t, 12);
      for (const [key, sign] of [
        ["n", 1],
        ["vy", 1],
        ["vz", -1],
        ["mx", 1],
        ["my", 1],
        ["mz", -1],
      ] as const) {
        const value = original[key];
        expect(Math.abs(reversed[key] - sign * value)).toBeLessThan(
          0.01 + 6e-5 * Math.abs(value),
        );
      }
    }
  });

  it("KS-19 · muda o lado da seção interna e mantém a tração positiva nos dois modos", () => {
    const joint = internalJointBeam();
    const before = solve(joint).members.V1;
    reverseMember(joint, "V1");
    const after = solve(joint).members.V1;
    for (const old of before.filter(({ side }) => side)) {
      const newSide = old.side === "left" ? "right" : "left";
      const reversed = after.find((station) => station.side === newSide)!;
      expect(reversed.t).toBeCloseTo(1 - old.t, 12);
      expect(reversed.v).toBeCloseTo(old.v, 2);
      expect(reversed.m).toBeCloseTo(-old.m, 2);
    }
    for (const mode of ["planar", "spatial"] as const) {
      const p = beamExample();
      p.mode = mode;
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
      p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fx: 1800 }];
      for (let orientation = 0; orientation < 2; orientation++) {
        const result = solve(p);
        for (const { n } of result.members.V1) expect(n).toBeCloseTo(1800, 2);
        expect(result.reactions[0].fx).toBeCloseTo(-1800, 2);
        reverseMember(p, "V1");
      }
    }
  });

  it("KS-19 · girar 90° troca as inércias da flexão biaxial do balanço", () => {
    const p = beamExample();
    p.mode = "spatial";
    p.nodes[0].restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    p.nodes[1].restraints = free();
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fy: 1200, fz: -2400 }];
    const span = p.nodes[1].x;
    const { width, height } = rectangle(p.sections[0]);
    const iy = (width * height ** 3) / 12;
    const iz = (height * width ** 3) / 12;
    const deflection = (force: number, inertia: number) =>
      (force * span ** 3) / (3 * p.materials[0].E * inertia);
    const aligned = solve(p).displacements.B;
    expect(aligned.uy).toBeCloseTo(deflection(1200, iz), 8);
    expect(aligned.uz).toBeCloseTo(deflection(-2400, iy), 8);
    p.members[0].roll = 90;
    const rotated = solve(p).displacements.B;
    expect(rotated.uy).toBeCloseTo(deflection(1200, iy), 8);
    expect(rotated.uz).toBeCloseTo(deflection(-2400, iz), 8);
    reverseMember(p, "V1");
    const reversed = solve(p).displacements.B;
    expect(reversed.uy).toBeCloseTo(rotated.uy, 9);
    expect(reversed.uz).toBeCloseTo(rotated.uz, 9);
  });
  it("envelope de pórtico em L mantém os esforços simultâneos de cada combinação governante", async () => {
    const project = parseProject(envelopeExample);
    const [definition] = project.resultEnvelopes;
    const cases = new Map(["EL", "CP"].map((id) => [id, solve(project, id)]));
    const evaluated = await evaluateMemberEnvelope(project, definition, cases);
    const middle = evaluated.V1[4];
    expect(middle.t).toBe(0.5);
    expect(middle.ranges.my.max.combinationId).toBe("CF");
    expect(middle.ranges.my.min.combinationId).toBe("CC");
    expect(middle.ranges.n.min.combinationId).toBe("CC");
    const components = ["n", "vy", "vz", "mx", "my", "mz"] as const;
    const expected = [
      {
        extreme: middle.ranges.my.max,
        factors: [1.2, 0.2],
        values: [-4800, 1560, -5800, 660, 11990, 2680],
      },
      {
        extreme: middle.ranges.n.min,
        factors: [-0.25, 1.3],
        values: [-15100, -1935, 2550, -1345, -4980, -3510],
      },
    ];
    for (const {
      extreme,
      factors: [permanent, compression],
      values,
    } of expected) {
      const directId = `DIRECT-${extreme.combinationId}`;
      project.analysisCases.push({
        id: directId,
        name: directId,
        type: "linear-static",
        factors: [
          { patternId: "G", factor: permanent },
          { patternId: "P", factor: compression },
        ],
      });
      const direct = solve(project, directId).members.V1[4];
      for (const [i, key] of components.entries()) {
        expect(extreme.forces[key], key).toBeCloseTo(values[i], 1);
        expect(extreme.forces[key], key).toBeCloseTo(direct[key], 1);
      }
    }
  });
  it.each([
    ["viga plana", beamExample],
    ["pórtico espacial", spatialBenchmark],
  ] as const)(
    "combinação em %s reproduz um caso direto do OOFEM",
    (_, create) => {
      const p = create();
      const permanent = p.loadPatterns[0];
      const secondary = permanent.nodal.length
        ? permanent.nodal
        : [{ ...nodalLoad("B"), fx: 1400, my: 480 }];
      permanent.nodal = [];
      p.loadPatterns.push({
        id: "W",
        name: "Ações nodais",
        nodal: secondary,
        uniform: [],
        pressure: [],
        selfWeight: { ...permanent.selfWeight },
      });
      const factors = (g: number, w: number) => [
        { patternId: permanent.id, factor: g },
        { patternId: "W", factor: w },
      ];
      const [first] = p.analysisCases;
      first.factors = factors(1.2, 0.25);
      p.analysisCases.push(
        {
          ...first,
          id: "W",
          name: "Segundo caso",
          factors: factors(-0.5, 0.75),
        },
        {
          ...first,
          id: "DIRECT",
          name: "Ações equivalentes",
          factors: factors(2.2, -0.225),
        },
      );
      p.resultCombinations.push({
        id: "C1",
        name: "Combinação de referência",
        type: "linear",
        factors: [
          { caseId: first.id, factor: 1.5 },
          { caseId: "W", factor: -0.8 },
        ],
      });
      const results = new Map(
        p.analysisCases.slice(0, 2).map(({ id }) => [id, solve(p, id)]),
      );
      const combined = combineLinearResults(
        p,
        p.resultCombinations[0],
        results,
      );
      const direct = solve(p, "DIRECT");

      for (const [id, expected] of Object.entries(direct.displacements)) {
        for (const dof of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
          expect(combined.displacements[id][dof], `${id}.${dof}`).toBeCloseTo(
            expected[dof],
            8,
          );
      }
      const compareForce = (actual: number, expected: number, label: string) =>
        expect(Math.abs(actual - expected), label).toBeLessThan(
          0.1 + Math.abs(expected) * 1e-4,
        );
      for (const expected of direct.reactions) {
        const actual = combined.reactions.find(
          ({ nodeId }) => nodeId === expected.nodeId,
        )!;
        for (const component of ["fx", "fy", "fz", "mx", "my", "mz"] as const)
          compareForce(
            actual[component],
            expected[component],
            `${expected.nodeId}.${component}`,
          );
      }
      for (const [id, stations] of Object.entries(direct.members)) {
        expect(combined.members[id]).toHaveLength(stations.length);
        for (const [index, expected] of stations.entries()) {
          const actual = combined.members[id][index];
          expect(actual.t).toBe(expected.t);
          for (const dof of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
            expect(actual[dof], `${id}[${index}].${dof}`).toBeCloseTo(
              expected[dof],
              8,
            );
          for (const component of [
            "n",
            "v",
            "m",
            "vy",
            "vz",
            "mx",
            "my",
            "mz",
          ] as const)
            compareForce(
              actual[component],
              expected[component],
              `${id}[${index}].${component}`,
            );
        }
      }
    },
  );
});
