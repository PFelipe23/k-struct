import { describe, expect, it } from "vitest";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { free, nodalLoad, type Project } from "../src/domain/model";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { diaphragmBenchmark } from "./fixtures/diaphragm";

function solve(p: Project) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
}
describe.skipIf(!process.env.OOFEM_BIN)(
  "KS-27 · diafragma no OOFEM 3.0",
  () => {
    it.each([
      ["C", -6000, -6000, 0],
      ["E", -9000, -3000, -0.00025],
    ] as const)(
      "transfere +12 kN em %s às duas molas",
      (id, north, south, theta) => {
        const p = diaphragmBenchmark();
        p.loadPatterns[0].nodal[0].nodeId = id;
        const r = solve(p);
        expect(r.reactions.find((n) => n.nodeId === "N")!.fx).toBeCloseTo(
          north,
          3,
        );
        expect(r.reactions.find((n) => n.nodeId === "S")!.fx).toBeCloseTo(
          south,
          3,
        );
        expect(Object.keys(r.displacements).sort()).toEqual([
          "C",
          "E",
          "N",
          "S",
        ]);
        for (const n of p.nodes) {
          expect(r.displacements[n.id].ux).toBeCloseTo(0.001 - theta * n.y, 10);
          expect(r.displacements[n.id].uy).toBeCloseTo(0, 10);
          expect(r.displacements[n.id].rz).toBeCloseTo(theta, 10);
        }
      },
    );
    it("conserva as respostas físicas ao mudar a referência e recebe momentos nodais", () => {
      const p = diaphragmBenchmark();
      p.loadPatterns[0].nodal = [{ ...nodalLoad("E"), fx: 12000, mz: 6000 }];
      const a = solve(p);
      expect(a.displacements.C.rz).toBeCloseTo(-6000 / 48e6, 11);
      p.diaphragms![0].reference = { x: 0.75, y: -0.375 };
      const b = solve(p);
      for (const n of p.nodes)
        for (const key of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
          expect(b.displacements[n.id][key]).toBeCloseTo(
            a.displacements[n.id][key],
            10,
          );
      b.reactions.forEach((r, i) =>
        expect(r.fx).toBeCloseTo(a.reactions[i].fx, 3),
      );
    });
    it("mantém a flexão vertical e a torção da barra livres no piso", () => {
      const p = diaphragmBenchmark();
      p.loadPatterns[0].nodal = [
        { ...nodalLoad("C"), fz: -1000 },
        { ...nodalLoad("N"), my: 1000 },
      ];
      const withFloor = solve(p);
      // Outside the diaphragm the same reference beam needs three in-plane
      // restraints/springs (already present). Its exact elastic response is the control.
      delete p.diaphragms;
      const beam = solve(p);
      expect(withFloor.displacements.C.uz).toBeCloseTo(
        (-1000 * 4 ** 3) / (48 * 2e11 * ((0.15 * 0.2 ** 3) / 12)),
        10,
      );
      expect(Math.abs(beam.displacements.N.ry)).toBeGreaterThan(1e-6);
      expect(Math.abs(beam.displacements.S.rx)).toBeGreaterThan(1e-6);
      for (const n of p.nodes)
        for (const k of ["uz", "rx", "ry"] as const)
          expect(withFloor.displacements[n.id][k]).toBeCloseTo(
            beam.displacements[n.id][k],
            10,
          );
    });
    it("projeta um apoio inclinado e conserva o movimento global dos participantes", () => {
      const p = diaphragmBenchmark();
      p.loadPatterns[0].nodal = [{ ...nodalLoad("E"), fx: 12000, fz: -1000 }];
      const a = solve(p);
      // Rotate around the restrained Y axis at C. The support is physically unchanged.
      p.nodes[1].supportFrame = {
        kind: "spatial",
        x: { x: 0.8, y: 0, z: 0.6 },
        y: { x: 0, y: 1, z: 0 },
      };
      const b = solve(p);
      for (const n of p.nodes)
        for (const key of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
          expect(b.displacements[n.id][key]).toBeCloseTo(
            a.displacements[n.id][key],
            9,
          );
    });
    it("transfere a força entre componentes ligados apenas pelo diafragma", () => {
      const p = diaphragmBenchmark();
      // Two separate bars S–C and E–N. Their out-of-plane rigid motions need their own supports.
      p.members.splice(1, 1);
      for (const n of p.nodes)
        Object.assign(n.restraints, { uz: true, rx: true, ry: true });
      p.loadPatterns[0].nodal[0].nodeId = "E";
      const r = solve(p);
      expect(r.reactions.find((n) => n.nodeId === "N")!.fx).toBeCloseTo(
        -9000,
        3,
      );
      expect(r.reactions.find((n) => n.nodeId === "S")!.fx).toBeCloseTo(
        -3000,
        3,
      );
      for (const n of p.nodes.slice(2)) n.restraints.uz = false;
      expect(() => exportOofem(p, "EL")).toThrow(/fora do plano/);
    });
    it("preserva o braço de uma face excêntrica ligada ao participante", () => {
      const p = diaphragmBenchmark();
      const end = { eccentricity: { x: 0.2, y: 0, z: 0 }, rigidLength: 0 };
      p.members[0].offsets = {
        i: structuredClone(end),
        j: structuredClone(end),
      };
      p.loadPatterns[0].nodal[0].nodeId = "E";
      const r = solve(p);
      expect(r.reactions.find((n) => n.nodeId === "N")!.fx).toBeCloseTo(
        -9000,
        3,
      );
      expect(r.displacements.E.rz).toBeCloseTo(-0.00025, 10);
    });
    it("resolve um piso sobre molas sem barras auxiliares", () => {
      const p = diaphragmBenchmark();
      p.members = [];
      for (const n of p.nodes)
        Object.assign(n.restraints, { uz: true, rx: true, ry: true });
      p.loadPatterns[0].nodal[0].nodeId = "E";
      const r = solve(p);
      expect(r.reactions.find((n) => n.nodeId === "N")!.fx).toBeCloseTo(
        -9000,
        3,
      );
      expect(r.reactions.find((n) => n.nodeId === "S")!.fx).toBeCloseTo(
        -3000,
        3,
      );
      expect(r.displacements.C.rz).toBeCloseTo(-0.00025, 10);
    });
    it("reconstrói UY e a torção após girar o modelo em planta", () => {
      const p = diaphragmBenchmark();
      for (const n of p.nodes) {
        [n.x, n.y] = [-n.y, n.x];
        [n.restraints.ux, n.restraints.uy] = [n.restraints.uy, n.restraints.ux];
        [n.restraints.rx, n.restraints.ry] = [n.restraints.ry, n.restraints.rx];
        if (n.springs) n.springs = { uy: n.springs.ux };
      }
      p.loadPatterns[0].nodal = [{ ...nodalLoad("E"), fy: 12000 }];
      const result = solve(p);
      for (const n of p.nodes)
        expect(result.displacements[n.id].uy).toBeCloseTo(
          0.001 - 0.00025 * n.x,
          10,
        );
      expect(result.reactions.find((r) => r.nodeId === "N")!.fy).toBeCloseTo(
        -9000,
        3,
      );
      expect(result.reactions.find((r) => r.nodeId === "S")!.fy).toBeCloseTo(
        -3000,
        3,
      );
    });
    it("aplica a cinemática ao participante no interior de um trecho rígido e detecta dupla vinculação", () => {
      const p = diaphragmBenchmark();
      const joint = {
        id: "J",
        name: "J",
        x: 0,
        y: -1.75,
        z: 3,
        restraints: free(),
      };
      p.nodes.push(joint);
      p.meshConnections = [{ memberId: p.members[0].id, nodeId: joint.id }];
      p.members[0].offsets = structuredClone(centeredOffsets);
      p.members[0].offsets.i.rigidLength = 0.5;
      p.diaphragms![0].nodeIds = ["J", "C", "E", "N"];
      p.loadPatterns[0].nodal[0].nodeId = "E";
      const r = solve(p);
      expect(r.reactions.find((n) => n.nodeId === "N")!.fx).toBeCloseTo(
        -9000,
        3,
      );
      expect(r.displacements.J.ux).toBeCloseTo(0.001 + 0.00025 * joint.y, 10);
      p.diaphragms![0].nodeIds.push("S");
      expect(() => exportOofem(p, "EL")).toThrow(/trechos rígidos/);
    });
    it("mantém independentes pavimentos distintos com a mesma referência XY", () => {
      const p = diaphragmBenchmark();
      p.members = [];
      for (const n of p.nodes)
        Object.assign(n.restraints, { uz: true, rx: true, ry: true });
      const top = p.nodes.map((n) => ({
        ...structuredClone(n),
        id: n.id + "2",
        z: 6,
      }));
      p.nodes.push(...top);
      p.diaphragms!.push({
        id: "D2",
        name: "Piso 2",
        reference: { x: 0, y: 0 },
        levelId: "level2",
        nodeIds: top.map((n) => n.id),
      });
      p.loadPatterns[0].nodal[0].nodeId = "E2";
      const r = solve(p);
      expect(r.reactions.find((n) => n.nodeId === "N2")!.fx).toBeCloseTo(
        -9000,
        3,
      );
      expect(r.reactions.find((n) => n.nodeId === "N")!.fx).toBeCloseTo(0, 3);
      expect(r.displacements.C.rz).toBeCloseTo(0, 11);
      expect(r.displacements.C2.rz).toBeCloseTo(-0.00025, 11);
    });
    it("recupera no nó físico a reação de um apoio prescrito", () => {
      const p = diaphragmBenchmark();
      p.loadPatterns[0].nodal = [{ ...nodalLoad("E"), fy: 4200 }];
      const r = solve(p);
      expect(r.reactions.find((n) => n.nodeId === "C")!.fy).toBeCloseTo(
        -4200,
        3,
      );
      expect(r.displacements.E.uy).toBeCloseTo(0, 11);
    });
  },
);
