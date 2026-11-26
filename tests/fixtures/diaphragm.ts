import {
  appendMember,
  createProject,
  free,
  nodalLoad,
} from "../../src/domain/model";

export function diaphragmBenchmark() {
  const p = createProject("spatial");
  p.mesh.segmentsPerMember = 2;
  for (const [id, y] of [
    ["S", -2],
    ["C", 0],
    ["E", 1],
    ["N", 2],
  ] as const)
    p.nodes.push({ id, name: id, x: 0, y, z: 3, restraints: free() });
  for (const [start, end] of [
    ["S", "C"],
    ["C", "E"],
    ["E", "N"],
  ])
    appendMember(p, { start, end, sectionId: p.sections[0].id, roll: 0 });
  const [south, center, , north] = p.nodes;
  south.springs = { ux: 6e6 };
  north.springs = { ux: 6e6 };
  south.restraints.uz = north.restraints.uz = true;
  south.restraints.ry = true;
  center.restraints.uy = true;
  p.diaphragms = [
    {
      id: "D1",
      name: "Piso 1",
      levelId: "level1",
      reference: { x: 0, y: 0 },
      nodeIds: p.nodes.map((n) => n.id),
    },
  ];
  p.loadPatterns[0].nodal = [{ ...nodalLoad("C"), fx: 12000 }];
  return p;
}
