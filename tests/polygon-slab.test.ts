import { MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { slabSurface } from "../src/components/slabSurface";
import { describe, expect, it } from "vitest";
import {
  addPolygonSlab,
  addSlabOpening,
  newSlabRing,
} from "../src/domain/editing";
import {
  analysisErrors,
  createProject,
  parseProject,
  serializeProject,
} from "../src/domain/model";
import { objectsInWindow } from "../src/domain/selection";
import { meshSlab } from "../src/domain/slab";
import {
  cross2,
  footprintProperties,
  inMaterial,
  normalizeRings,
  polygonError,
  type XY,
} from "../src/domain/slabPolygon";
import { materialSample } from "../src/domain/polygonMesh";
import { selfWeightSummary } from "../src/domain/selfWeight";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { slabBenchmarkProject } from "./fixtures/slab-benchmark";

const loop = (coords: number[][], supported = true) =>
  newSlabRing(
    coords.map(([x, y]) => ({ x, y })),
    supported,
  );
const outer = () =>
  loop([
    [0, 0],
    [6, 0],
    [6, 2],
    [3, 2],
    [3, 4],
    [0, 4],
  ]);
const hole = () =>
  loop(
    [
      [1, 0.5],
      [2, 0.5],
      [2, 1.5],
      [1, 1.5],
    ],
    false,
  );
function projectWith(rings = [outer(), hole()]) {
  const project = createProject("spatial");
  const slab = addPolygonSlab(project, "level1", rings);
  project.loadPatterns[0].pressure = [{ slabId: slab.id, pz: -5000 }];
  return { project, slab };
}

// Clip a triangle against an axis-aligned rectangle. A shared boundary has zero area.
function overlapArea(
  triangle: XY[],
  left: number,
  bottom: number,
  right: number,
  top: number,
) {
  let polygon = triangle;
  for (const [axis, limit, sign] of [
    ["x", left, 1],
    ["x", right, -1],
    ["y", bottom, 1],
    ["y", top, -1],
  ] as const) {
    const clipped: XY[] = [];
    for (const [i, a] of polygon.entries()) {
      const b = polygon[(i + 1) % polygon.length],
        da = sign * (a[axis] - limit),
        db = sign * (b[axis] - limit);
      if (da >= 0) clipped.push(a);
      if (da < 0 !== db < 0) {
        const t = da / (da - db);
        clipped.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    polygon = clipped;
  }
  return polygon.length > 2 ? Math.abs(footprintProperties([polygon]).area) : 0;
}

describe("KS-41 · contornos físicos da laje", () => {
  it("preserva os apoios físicos ao inverter o traçado, editar e reabrir os dois formatos", () => {
    const ring = outer().reverse();
    ring[1].supported = false;
    const segment = ring[1],
      end = ring[2];
    const { project, slab } = projectWith([ring, hole()]);
    const normalized = slab.polygon.rings[0];
    const i = normalized.findIndex((v) => v.edgeId === segment.edgeId);
    expect(normalized[i]).toMatchObject({
      x: end.x,
      y: end.y,
      supported: false,
    });
    expect(normalized[(i + 1) % normalized.length]).toMatchObject({
      x: segment.x,
      y: segment.y,
    });
    normalized[0].y += 0.1;
    expect(parseProject(serializeProject(project))).toEqual(project);
    const old = slabBenchmarkProject();
    expect(parseProject(JSON.stringify({ ...old, schemaVersion: 23 }))).toEqual(
      old,
    );
  });

  it("abre um furo no retângulo legado e conserva o painel, a pressão e os apoios na conversão para DKT", () => {
    const project = slabBenchmarkProject(),
      original = structuredClone(project.slabs[0]);
    project.slabs[0].formulation = "qdkt";
    project.slabs[0].supports.xMin = false;
    addSlabOpening(project, original.id, hole());
    const saved = parseProject(serializeProject(project)),
      converted = saved.slabs[0];
    expect(converted).toMatchObject({
      id: original.id,
      materialId: original.materialId,
      thickness: original.thickness,
      formulation: "dkt",
    });
    expect(
      converted.polygon!.rings[0].map((v) => [v.edgeId, v.supported]),
    ).toEqual([
      ["yMin", true],
      ["xMax", true],
      ["yMax", true],
      ["xMin", false],
    ]);
    expect(saved.loadPatterns[0].pressure).toEqual([
      { slabId: original.id, pz: -5000 },
    ]);
  });

  it("seleciona por janela o material e as bordas de aberturas múltiplas", () => {
    const { project, slab } = projectWith([
      loop([
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ]),
      hole(),
      loop(
        [
          [4, 0.5],
          [5, 0.5],
          [5, 1.5],
          [4, 1.5],
        ],
        false,
      ),
    ]);
    const mesh = meshSlab(slab, 3);
    expect(
      mesh.elements.reduce((n, face) => {
        const [a, b, c] = face.nodes.map((id) => mesh.nodes[id - 1]);
        return n + cross2(a, b, c) / 2;
      }, 0),
    ).toBeCloseTo(30, 11);
    const pick = (u: number, end: number) =>
      objectsInWindow(
        project,
        { kind: "XY", offset: 3 },
        { u, v: 0.75 },
        { u: end, v: 1.25 },
      );
    expect(pick(1.8, 1.2)).toHaveLength(0);
    expect(pick(4.8, 4.2)).toHaveLength(0);
    expect(pick(4.2, 3.8)).toEqual([{ kind: "slab", id: slab.id }]);
  });

  it("a perspectiva intercepta a superfície de concreto e deixa passar a seleção pelos vazios", () => {
    const { slab } = projectWith(),
      material = new MeshBasicMaterial();
    const surface = slabSurface(slab, 3, material);
    surface.updateMatrixWorld(true);
    const cast = (x: number, y: number) =>
      new Raycaster(
        new Vector3(x, 10, -y),
        new Vector3(0, -1, 0),
      ).intersectObject(surface);
    expect(cast(1.5, 1)).toHaveLength(0);
    expect(cast(5, 3)).toHaveLength(0);
    expect(cast(3, 1)[0].point.y).toBeCloseTo(3.05, 6);
    surface.geometry.dispose();
    material.dispose();
  });

  it("localiza cruzamentos, vértices repetidos, bordas em retorno e aberturas inválidas", () => {
    expect(
      polygonError([
        loop([
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
        ]),
      ]),
    ).toMatch(/borda.*cruza.*borda/);
    expect(
      polygonError([
        loop([
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 0],
        ]),
      ]),
    ).toMatch(/vértices|borda/);
    expect(
      polygonError([
        loop([
          [0, 0],
          [1, 0],
          [2, 0],
        ]),
      ]),
    ).toMatch(/bordas|área/);
    for (const [coords, expected] of [
      [
        [
          [4, 3],
          [5, 3],
          [5, 3.5],
        ],
        /fora/,
      ],
      [
        [
          [0, 1],
          [1, 1],
          [1, 2],
        ],
        /toca/,
      ],
      [
        [
          [2, 1],
          [2.5, 1],
          [2.5, 1.5],
        ],
        /toca/,
      ],
      [
        [
          [1.1, 0.6],
          [1.9, 0.6],
          [1.1, 1.4],
        ],
        /sobrepostas/,
      ],
    ] as const)
      expect(
        polygonError([
          outer(),
          hole(),
          loop(
            coords.map((c) => [...c]),
            false,
          ),
        ]),
      ).toMatch(expected);
    const split = loop(
      [
        [0, 0],
        [2, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      false,
    );
    split[0].supported = split[1].supported = true;
    expect(analysisErrors(projectWith([split]).project).join(" ")).toMatch(
      /mesma reta/,
    );
  });

  it("mantém as fronteiras do recorte e da abertura, distribui pressão e peso próprio pela área líquida", () => {
    const { project, slab } = projectWith();
    const { area, centroid } = footprintProperties(slab.polygon.rings);
    expect(footprintProperties([outer()]).area).toBe(18);
    expect(area).toBe(17);
    expect(centroid.x).toBeCloseTo(43.5 / 17, 12);
    expect(centroid.y).toBeCloseTo(29 / 17, 12);
    const mesh = meshSlab(slab, 3);
    let sum = 0;
    for (const el of mesh.elements) {
      const points = el.nodes.map((i) => mesh.nodes[i - 1]);
      const part = cross2(points[0], points[1], points[2]) / 2;
      expect(part).toBeGreaterThan(0);
      sum += part;
      expect(overlapArea(points, 1, 0.5, 2, 1.5)).toBeCloseTo(0, 12);
      expect(overlapArea(points, 3, 2, 6, 4)).toBeCloseTo(0, 12);
    }
    expect(sum).toBeCloseTo(17, 12);
    for (const v of slab.polygon.rings.flat())
      expect(mesh.edges[v.edgeId]).toHaveLength(5);
    const pattern = project.loadPatterns[0];
    Object.assign(pattern.selfWeight, { enabled: true, gravity: 10 });
    expect(selfWeightSummary(project, pattern).slabs[0].totalZ).toBeCloseTo(
      -42500,
      8,
    );
  });

  it("consulta o material se o centroide cair na abertura e conserva vértices colineares", () => {
    const { slab } = projectWith([
      loop([
        [0, 0],
        [2, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
      loop(
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
        false,
      ),
    ]);
    const mesh = meshSlab(slab, 0);
    const sample = materialSample(mesh, { x: 2, y: 2 });
    expect(sample.relocated).toBe(true);
    expect(inMaterial(sample.point, slab.polygon.rings)).toBe(true);
    expect(normalizeRings(slab.polygon.rings)).toEqual(slab.polygon.rings);
  });
});

const bin = process.env.OOFEM_BIN;
function solve(project: ReturnType<typeof createProject>) {
  const input = exportOofem(project, "EL");
  return parseOofemOutput(runDeck(input.deck, bin!), input).slab!;
}
it.skipIf(!bin)(
  "OOFEM 3.0 · painel em L com abertura equilibra a força e os dois momentos",
  () => {
    const { project } = projectWith();
    const r = solve(project);
    expect(r.totalLoadZ).toBe(-85000);
    expect(Math.abs(r.totalReactionZ - 85000)).toBeLessThan(2);
    const moments = r.reactions.reduce(
      ([mx, my], reaction) => {
        const p = r.mesh.nodes[reaction.node - 1];
        return [
          mx + reaction.mx + p.y * reaction.fz,
          my + reaction.my - p.x * reaction.fz,
        ];
      },
      [0, 0],
    );
    expect(Math.abs(moments[0] - 145000)).toBeLessThan(4);
    expect(Math.abs(moments[1] + 217500)).toBeLessThan(4);
    expect(r.center.uz).toBeLessThan(0);
    console.info("KS-41", {
      elements: r.elements.length,
      nodes: r.nodes.length,
      rz: r.totalReactionZ,
      moments,
      sample: r.center,
    });
  },
);
it.skipIf(!bin)(
  "OOFEM 3.0 · girar os apoios oblíquos conserva flecha e gira rotações e reações globais",
  () => {
    const rotate = ({ x, y }: XY) => ({
      x: 0.8 * x - 0.6 * y,
      y: 0.6 * x + 0.8 * y,
    });
    const ring = loop([
      [0, 0],
      [4, 0],
      [0, 3],
    ]);
    ring[1].supported = false;
    const original = solve(projectWith([ring]).project);
    const rotated = solve(
      projectWith([ring.map((v) => ({ ...v, ...rotate(v) }))]).project,
    );
    for (const [i, n] of original.mesh.nodes.entries()) {
      const p = rotate(n);
      const j = rotated.mesh.nodes.findIndex(
        (v) => Math.hypot(p.x - v.x, p.y - v.y) < 1e-9,
      );
      expect(j).toBeGreaterThanOrEqual(0);
      const a = original.nodes[i],
        b = rotated.nodes[j];
      expect(b.uz).toBeCloseTo(a.uz, 9);
      const spin = rotate({ x: a.rx, y: a.ry });
      expect(b.rx).toBeCloseTo(spin.x, 9);
      expect(b.ry).toBeCloseTo(spin.y, 9);
      const reaction = original.reactions.find((r) => r.node === i + 1);
      if (!reaction) continue;
      const measured = rotated.reactions.find((r) => r.node === j + 1)!;
      const moment = rotate({ x: reaction.mx, y: reaction.my });
      expect(Math.abs(measured.fz - reaction.fz)).toBeLessThan(0.2);
      expect(Math.abs(measured.mx - moment.x)).toBeLessThan(0.05);
      expect(Math.abs(measured.my - moment.y)).toBeLessThan(0.05);
    }
  },
);
