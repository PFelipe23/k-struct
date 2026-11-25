import { projectV8 } from "./fixtures/project-v8";
import { expect, it } from "vitest";
import {
  beamStations,
  nearestSection,
  sectionLocations,
} from "../src/domain/beamMesh";
import { addMember, connectMeshJoint } from "../src/domain/editing";
import { tolerance } from "../src/domain/geometry";
import { planMemberEdit } from "../src/domain/memberOperations";
import {
  addPoint,
  analysisErrors,
  createProject,
  free,
  parseProject,
  referenceErrors,
  removeSelection,
  serializeProject,
} from "../src/domain/model";
import { planTransform } from "../src/domain/transform";
import { exportOofem } from "../src/solver/oofem";
import { internalJointBeam } from "./fixtures/internal-joint";

it("ordena a união por x/L, reutiliza o nó real mesmo perto da estação regular e evita segmentos nulos", () => {
  const p = internalJointBeam();
  const joint = addPoint(p, { x: 3 + tolerance / 2, y: 0, z: 0 });
  connectMeshJoint(p, "V1", { kind: "node", id: joint.id });
  p.meshConnections.reverse();
  const before = serializeProject(p);
  const input = exportOofem(p, "EL");
  const layout = beamStations(p).get("V1")!;
  expect(layout.map((s) => s.t)).toEqual([
    0,
    1 / 8,
    2 / 8,
    1 / 3,
    3 / 8,
    joint.x / 6,
    5 / 8,
    6 / 8,
    7 / 8,
    1,
  ]);
  const number = input.nodes.find((n) => n.objectId === joint.id)!.number;
  expect(
    input.elements.filter((e) => e.start === number || e.end === number),
  ).toHaveLength(2);
  expect(input.elements.every((e) => e.end !== e.start && e.t1 > e.t0)).toBe(
    true,
  );
  expect(serializeProject(p)).toBe(before);
  const keys = sectionLocations(layout);
  expect(keys[nearestSection(keys, 1 / 3 - 0.001)].side).toBe("left");
  expect(keys[nearestSection(keys, 1 / 3 + 0.001)].side).toBe("right");
  p.meshConnections.push({ memberId: "V1", nodeId: joint.id });
  expect(() => exportOofem(p, "EL")).toThrow(/repetidas ou coincidentes/);
});

it("conecta somente o par escolhido em XYZ, inclusive quando outras barras atravessam a estação", () => {
  const p = createProject("spatial");
  const pt = (x: number, y: number, z = 0) => ({ x, y, z });
  const chord = addMember(p, pt(0, 0), pt(6, 0));
  const through = addMember(p, pt(2, -1), pt(2, 1));
  const independent = addMember(p, pt(1, -1), pt(3, 1));
  const raised = addMember(p, pt(2, -1, 1), pt(2, 1, 1));
  for (const m of p.members) {
    const n = p.nodes.find((n) => n.id === m.start)!;
    n.restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
  }
  const original = structuredClone(p.members);
  expect(() =>
    connectMeshJoint(p, chord.id, { kind: "member", id: raised.id }),
  ).toThrow(/em XYZ/);
  expect(p.meshConnections).toEqual([]);
  connectMeshJoint(p, chord.id, { kind: "member", id: through.id });
  const nodeId = p.meshConnections[0].nodeId;
  expect(p.meshConnections).toEqual([
    { memberId: chord.id, nodeId },
    { memberId: through.id, nodeId },
  ]);
  expect(p.members).toEqual(original);
  const input = exportOofem(p, "EL"),
    joint = input.nodes.find((n) => n.objectId === nodeId)!.number;
  const owners = input.elements
    .filter((e) => e.start === joint || e.end === joint)
    .map((e) => e.memberId);
  expect(owners).toEqual([chord.id, chord.id, through.id, through.id]);
  expect(
    input.elements.filter(
      (e) => e.memberId === independent.id || e.memberId === raised.id,
    ),
  ).toHaveLength(16);
  expect(() =>
    connectMeshJoint(p, chord.id, { kind: "member", id: through.id }),
  ).toThrow(/já existe/);
});

it("valida apoios na topologia conectada, preserva seleção física e migra v7 sem reunir objetos", () => {
  const p = internalJointBeam();
  p.nodes[0].restraints = p.nodes[1].restraints = free();
  p.nodes[2].restraints = { ...free(), ux: true, uz: true, ry: true };
  expect(analysisErrors(p)).toEqual([]);
  const { meshConnections, ...before } = projectV8(p);
  const legacy = parseProject(JSON.stringify({ ...before, schemaVersion: 7 }));
  expect(legacy.meshConnections).toEqual([]);
  expect(analysisErrors(legacy).join()).toMatch(/apoios insuficientes/);
  expect(parseProject(serializeProject(p))).toEqual(p);
  const divided = planMemberEdit(p, {
    kind: "split",
    id: "V1",
    reference: { kind: "distance", metres: 2 },
  }).project;
  expect(divided.meshConnections).toEqual([]);
  const { meshConnections: _, ...oldSplit } = projectV8(divided);
  const migrated = parseProject(
    JSON.stringify({ ...oldSplit, schemaVersion: 7 }),
  );
  expect(migrated.members).toEqual(divided.members);
  expect(analysisErrors(migrated)).toEqual([]);
});

it("mantém incidências em cópias e cortes e impede afastar um nó conectado do eixo", () => {
  const p = internalJointBeam();
  const c = p.nodes[2];
  c.x = 2.5;
  expect(beamStations(p).get("V1")).toContainEqual({ nodeId: "C", t: 2.5 / 6 });
  c.z = 0.1;
  expect(referenceErrors(p).join()).toMatch(/Remova a conexão/);
  c.z = 0;
  const copy = planTransform(p, [{ kind: "member", id: "V1" }], {
    kind: "translate",
    offset: { x: 0, y: 0, z: 2 },
    copies: 1,
  });
  expect(copy.project.meshConnections).toContainEqual({
    memberId: copy.maps[0].members.get("V1"),
    nodeId: copy.maps[0].nodes.get("C"),
  });
  const cut = planMemberEdit(p, {
    kind: "split",
    id: "V1",
    reference: { kind: "distance", metres: 1 },
  }).project;
  expect(cut.meshConnections).toEqual([
    { memberId: cut.members[1].id, nodeId: "C" },
  ]);
  const merged = planMemberEdit(cut, {
    kind: "join",
    ids: cut.members.map((m) => m.id),
  }).project;
  expect(merged.meshConnections).toEqual(p.meshConnections);
  removeSelection(cut, [{ kind: "node", id: "C" }]);
  expect(cut.meshConnections).toEqual([]);
  expect(cut.members).toHaveLength(2);
  removeSelection(p, [{ kind: "member", id: "V1" }]);
  expect(p.meshConnections).toEqual([]);
  expect(p.nodes).toContain(c);
});
