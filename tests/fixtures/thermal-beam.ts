import { beamExample, type Project } from "../../src/domain/model";
import { setThermalField } from "../../src/domain/thermalLoads";

export function thermalBeam(
  mode: Project["mode"] = "planar",
  uniform = 0,
  deltaZ = 0,
  deltaY = 0,
) {
  const p = beamExample();
  p.mode = mode;
  p.name = "Viga térmica de 5 m";
  p.nodes[1].x = 5;
  p.materials[0].E = 2e11;
  p.materials[0].alpha = 12e-6;
  p.sections[0] = {
    id: "rect",
    name: "5 × 200 mm",
    materialId: p.materials[0].id,
    shape: "rectangle",
    width: 0.005,
    height: 0.2,
  };
  p.loadPatterns[0].uniform = [];
  if (mode === "spatial") {
    p.nodes[0].restraints.uy = p.nodes[0].restraints.rx = true;
    p.nodes[1].restraints.uy = true;
  }
  setThermalField(p.loadPatterns[0], {
    memberId: "V1",
    uniform,
    deltaY,
    deltaZ,
  });
  return p;
}
