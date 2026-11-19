import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beamExample, createProject, type Project } from "../src/domain/model";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import portal from "./fixtures/portal-planar.json";
import portalExpected from "./fixtures/portal-expected.json";

const executable = process.env.OOFEM_BIN;
function solve(p: Project) {
  const input = exportOofem(p, "EL"),
    dir = mkdtempSync(join(tmpdir(), "kstruct-test-"));
  try {
    writeFileSync(join(dir, "analysis.in"), input.deck);
    execFileSync(executable!, ["-f", "analysis.in"], {
      cwd: dir,
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return parseOofemOutput(
      readFileSync(join(dir, "analysis.out"), "utf8"),
      input,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!executable)("OOFEM real · benchmarks analíticos", () => {
  it("pórtico plano de dois pavimentos concorda com a solução independente por rigidez direta", () => {
    const p = createProject();
    p.materials[0].E = portal.e;
    p.sections = portal.sections.map(([width, height], i) => ({
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
        restraints: { ux: fixed, uz: fixed, ry: fixed },
      };
    });
    p.members = portal.members.map(([start, end, section], i) => ({
      id: `B${i}`,
      name: `B${i}`,
      start: `N${start}`,
      end: `N${end}`,
      sectionId: `R${section}`,
    }));
    p.loadPatterns[0].uniform = portal.uniform.map(([member, qx, qz]) => ({
      memberId: `B${member}`,
      qx,
      qz,
    }));
    p.loadPatterns[0].nodal = portal.nodal.map(([node, fx, fz, my]) => ({
      nodeId: `N${node}`,
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
    p.loadPatterns[0].nodal = [{ nodeId: "B", fx: 0, fz: -1000, my: 0 }];
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
    p.loadPatterns[0].uniform = [{ memberId: "V1", qx: 1000, qz: 0 }];
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
    p.loadPatterns[0].nodal = [{ nodeId: "B", fx: 1000, fz: 0, my: 0 }];
    const r = solve(p),
      axial = (1000 * 5) / (2e11 * 0.03),
      bending = (1000 * 5 ** 3) / (3 * 2e11 * 1e-4);
    expect(r.displacements.B.ux).toBeCloseTo(
      axial * 0.6 ** 2 + bending * 0.8 ** 2,
      8,
    );
    expect(r.displacements.B.uz).toBeCloseTo((axial - bending) * 0.6 * 0.8, 8);
  });
});
