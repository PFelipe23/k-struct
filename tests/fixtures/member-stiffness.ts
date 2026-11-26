import { addMember } from "../../src/domain/editing";
import { addPoint, createProject, nodalLoad } from "../../src/domain/model";

export function stiffnessCantilevers() {
  const project = createProject("spatial");
  project.materials[0].alpha = 0.000012;
  for (const y of [0, 4]) {
    const root = addPoint(project, { x: 0, y, z: 0 });
    const tip = addPoint(project, { x: 3, y, z: 0 });
    root.restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: true,
      ry: true,
      rz: true,
    };
    addMember(project, root, tip);
    project.loadPatterns[0].nodal.push({
      ...nodalLoad(tip.id),
      fx: 1200,
      fy: 300,
      fz: -900,
      mx: 15,
    });
  }
  return project;
}
