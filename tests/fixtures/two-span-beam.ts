import { beamExample, uniformLoad } from "../../src/domain/model";

export function twoSpanBeam() {
  const project = beamExample();
  project.name = "Viga contínua de dois vãos";
  project.nodes.push({ ...project.nodes[1], id: "C", name: "N3", x: 12 });
  project.members.push({
    ...project.members[0],
    id: "V2",
    name: "B2",
    start: "B",
    end: "C",
  });
  project.loadPatterns[0].uniform.push({ ...uniformLoad("V2"), qz: -5000 });
  project.mesh.segmentsPerMember = 2;
  return project;
}
