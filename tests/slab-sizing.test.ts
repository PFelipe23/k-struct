import { expect, it } from "vitest";
import { addPolygonSlab, newSlabRing } from "../src/domain/editing";
import {
  createProject,
  parseProject,
  serializeProject,
} from "../src/domain/model";
import { meshSlab } from "../src/domain/slab";
import { previewSlabMesh, inspectSlabMesh } from "../src/domain/slabQuality";
import { cross2, footprintProperties } from "../src/domain/slabPolygon";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { querySlab } from "../src/solver/slab";
import {
  navierSlabCenter,
  slabBenchmarkProject,
} from "./fixtures/slab-benchmark";
import { runDeck } from "./fixtures/solve-oofem";

function panel() {
  const p = createProject("spatial");
  const ring = (xy: number[][], supported = true) =>
    newSlabRing(
      xy.map(([x, y]) => ({ x, y })),
      supported,
    );
  const slab = addPolygonSlab(p, "level1", [
    ring([
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 4],
      [0, 4],
    ]),
    ring(
      [
        [1, 0.5],
        [2, 0.5],
        [2, 1.5],
        [1, 1.5],
      ],
      false,
    ),
  ]);
  p.loadPatterns[0].pressure = [{ slabId: slab.id, pz: -5000 }];
  const edges = slab.polygon.rings[1].map((v) => ({
    edgeId: v.edgeId,
    size: 0.25,
  }));
  edges.push({ edgeId: slab.polygon.rings[0][1].edgeId, size: 0.25 });
  return { p, slab, edges };
}
const bin = process.env.OOFEM_BIN;
function solve(p: ReturnType<typeof createProject>) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, bin!), input).slab!;
}
it("refina localmente os dois contornos com malha determinística, conforme e sem sobreposição", () => {
  const { p, slab, edges } = panel();
  slab.sizing = { target: 1, edges: [] };
  const coarse = meshSlab(slab, 3);
  slab.sizing.edges = edges;
  const fine = meshSlab(slab, 3),
    quality = inspectSlabMesh(slab, fine);
  expect(quality.issues.filter((i) => i.level === "invalid")).toEqual([]);
  expect(quality.area).toBeCloseTo(17, 11);
  expect(fine).toEqual(meshSlab(parseProject(serializeProject(p)).slabs[0], 3));
  for (const control of edges) {
    const line = fine.edges[control.edgeId];
    expect(line.length).toBeGreaterThan(coarse.edges[control.edgeId].length);
    for (const [i, n] of line.slice(1).entries()) {
      const a = fine.nodes[line[i] - 1],
        b = fine.nodes[n - 1];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(
        0.25 + 1e-12,
      );
    }
  }
  const original = slab.polygon.rings[0][0];
  expect(
    fine.edges[original.edgeId].every((n) =>
      fine.nodes[n - 1].restraints.includes(3),
    ),
  ).toBe(true);
  const lengths = fine.elements.map((e) => {
    const [a, b, c] = e.nodes.map((i) => fine.nodes[i - 1]);
    return cross2(a, b, c) / 2;
  });
  expect(Math.min(...lengths)).toBeGreaterThan(0);
  expect(Math.max(...lengths)).toBeGreaterThan(8 * Math.min(...lengths));
  // Away from the selected boundaries some coarse triangles still coincide exactly.
  const key = (mesh: typeof fine, ids: number[]) =>
    ids
      .map((i) => {
        const p = mesh.nodes[i - 1];
        return [p.x, p.y].join("/");
      })
      .sort()
      .join(",");
  const coarseKeys = new Set(coarse.elements.map((e) => key(coarse, e.nodes)));
  expect(fine.elements.some((e) => coarseKeys.has(key(fine, e.nodes)))).toBe(
    true,
  );
  const h = slab.polygon.rings;
  expect(footprintProperties(h).area).toBe(17);
});
it("rejeita referências inválidas e pedidos excessivos antes de alocar a malha", () => {
  const { p, slab, edges } = panel();
  for (const sizing of [
    { target: 0, edges: [] },
    { target: 1e-12, edges: [] },
    { target: 1, edges: [{ ...edges[0], size: 1e-12 }] },
    { target: 1, edges: [{ edgeId: "ausente", size: 0.2 }] },
    { target: 1, edges: [edges[0], edges[0]] },
  ]) {
    slab.sizing = sizing;
    expect(previewSlabMesh(slab).error).toBeTruthy();
    expect(() => exportOofem(p, "EL")).toThrow();
  }
  const rect = slabBenchmarkProject();
  rect.slabs[0].sizing = { target: 1e-15, edges: [] };
  expect(previewSlabMesh(rect.slabs[0]).error).toMatch(/limite/);
});
it("separa aviso de ângulo, distorção e malha degenerada, identifica o elemento e bloqueia a exportação", () => {
  const { p, slab } = panel();
  slab.polygon.rings = [
    newSlabRing(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 0.1 },
      ],
      true,
    ),
  ];
  let preview = previewSlabMesh(slab);
  expect(preview.quality?.issues[0]).toMatchObject({
    level: "warning",
    element: 1,
  });
  expect(() => exportOofem(p, "EL")).not.toThrow();
  slab.polygon.rings[0][1].x = 1e10;
  preview = previewSlabMesh(slab);
  expect(
    preview.quality?.issues.some((v) => v.level === "invalid" && v.element > 0),
  ).toBe(true);
  expect(() => exportOofem(p, "EL")).toThrow(/Malha inválida.*elemento/);
  const rect = slabBenchmarkProject(),
    q = rect.slabs[0];
  q.formulation = "qdkt";
  q.lengthX = 100;
  const mesh = meshSlab(q, 3);
  expect(inspectSlabMesh(q, mesh).issues[0].level).toBe("warning");
  mesh.elements[0].nodes.reverse();
  expect(inspectSlabMesh(q, mesh).issues[0].reason).toMatch(/Jacobiano/);
});
it("mantém v25 e a seleção dos graus no retângulo refinado junto à borda", () => {
  const p = slabBenchmarkProject(),
    s = p.slabs[0];
  expect(parseProject(JSON.stringify({ ...p, schemaVersion: 25 }))).toEqual(p);
  s.sizing = { target: 1, edges: [{ edgeId: "xMin", size: 0.25 }] };
  const mesh = meshSlab(s, 3);
  expect(mesh.edges.xMin).toHaveLength(13);
  expect(mesh.grid!.x[1]).toBeCloseTo(0.25);
  expect(mesh.grid!.x.at(-1)! - mesh.grid!.x.at(-2)!).toBeGreaterThan(0.25);
  expect(
    mesh.edges.xMin.every((i) => mesh.nodes[i - 1].restraints.includes(4)),
  ).toBe(true);
});
it.skipIf(!bin)(
  "OOFEM 3.0 · compara a placa por tamanho com Navier nas mesmas coordenadas físicas",
  () => {
    for (const formulation of ["qdkt", "dkt"] as const) {
      const p = slabBenchmarkProject(),
        slab = p.slabs[0];
      slab.formulation = formulation;
      const exact = navierSlabCenter();
      let preceding = Infinity;
      for (const target of [0.5, 0.25, 0.125]) {
        slab.sizing = { target, edges: [] };
        const r = solve(p),
          pt = { x: 2, y: 1.5 },
          sample = querySlab(r, pt)!;
        expect(r.samplePoint).toMatchObject(pt);
        expect(sample).toEqual(r.center);
        const err = Math.abs(sample.uz / exact.uz - 1);
        expect(err).toBeLessThan(preceding);
        preceding = err;
        expect(Math.abs(r.totalReactionZ - 60000)).toBeLessThan(3);
        if (target === 0.125)
          for (const k of ["uz", "mx", "my"] as const)
            expect(Math.abs(sample[k] / exact[k] - 1)).toBeLessThan(0.002);
        const off = querySlab(r, { x: 1.23, y: 1.07 });
        expect(off?.uz).toBeLessThan(0);
        expect(querySlab(r, { x: 5, y: 1 })).toBeNull();
        console.info(
          "KS-42 placa",
          formulation,
          target,
          r.elements.length,
          r.totalReactionZ,
          sample,
        );
      }
    }
  },
);
it.skipIf(!bin)(
  "OOFEM 3.0 · conserva −85 kN no painel com refinamento junto ao furo e ao apoio",
  () => {
    const { p, slab, edges } = panel();
    for (const controls of [[], edges]) {
      slab.sizing = { target: 1, edges: controls };
      const r = solve(p),
        quality = inspectSlabMesh(slab, r.mesh);
      expect(r.totalLoadZ).toBe(-85000);
      expect(Math.abs(r.totalReactionZ - 85000)).toBeLessThan(3);
      expect(querySlab(r, { x: 1.5, y: 1 })).toBeNull();
      expect(querySlab(r, { x: 5, y: 3 })).toBeNull();
      expect(querySlab(r, { x: 2.5, y: 1.7 })!.uz).toBeLessThan(0);
      console.info(
        "KS-42 painel",
        controls.length,
        r.elements.length,
        r.nodes.length,
        quality.minAngle,
        r.totalReactionZ,
      );
    }
  },
);

it.skipIf(!bin)(
  "consulta uma malha QDKT graduada nas coordenadas do pavimento",
  () => {
    const project = slabBenchmarkProject(),
      slab = project.slabs[0];
    if (slab.polygon) throw new Error("O ensaio requer o painel retangular");
    slab.formulation = "qdkt";
    slab.sizing = { target: 0.75, edges: [{ edgeId: "xMin", size: 0.25 }] };
    const first = solve(project),
      point = { x: 1.23, y: 1.07 };
    const sample = querySlab(first, point)!;
    expect(sample.uz).toBeLessThan(0);
    slab.x += 12;
    slab.y -= 4;
    const moved = solve(project),
      p = { x: point.x + 12, y: point.y - 4 };
    const translated = querySlab(moved, p)!;
    for (const k of ["uz", "mx", "my"] as const)
      expect(translated[k]).toBeCloseTo(sample[k], 8);
    expect(Math.abs(moved.totalReactionZ - 60000)).toBeLessThan(3);
    // Bilinear interpolation must reproduce an affine field inside any graded cell.
    const grid = moved.mesh.nodes;
    const field = {
      ...moved,
      nodes: moved.nodes.map((n, i) => ({
        ...n,
        uz: 2 * grid[i].x - 3 * grid[i].y,
      })),
    };
    expect(querySlab(field, p)!.uz).toBeCloseTo(2 * p.x - 3 * p.y, 12);
  },
);
