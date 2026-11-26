import {
  createProject,
  type SurfacePanel,
  type Project,
} from "../../src/domain/model";
import { origin, add, scale } from "../../src/domain/geometry";
import type { Basis } from "../../src/domain/surfacePanel";
import { globalBasis } from "../../src/domain/surfacePanel";

export function cantileverPanel(
  kind: SurfacePanel["kind"] = "shell",
  axes: Basis = globalBasis,
  n = 8,
): Project {
  const p = createProject("spatial");
  p.name = "Faixa em balanço";
  Object.assign(p.materials[0], {
    id: "mat",
    name: "Material de referência",
    E: 30e9,
    nu: 0,
    density: 2500,
  });
  p.sections[0].materialId = "mat";
  const a = { x: 1, y: -2, z: 4 };
  p.surfacePanels = [
    {
      id: "P1",
      name: "Painel 1",
      kind,
      materialId: "mat",
      a,
      b: add(a, scale(axes[0], 3)),
      d: add(a, scale(axes[1], 1.2)),
      thickness: 0.1,
      nu: n,
      nv: 4,
      fixed: ["DA"],
    },
  ];
  p.loadPatterns[0].panelActions = [
    {
      panelId: "P1",
      edge: "BC",
      traction: {
        x: kind === "plate" ? 0 : 100000,
        y: 0,
        z: kind === "membrane" ? 0 : -1000,
      },
      pressure: 0,
    },
  ];
  return p;
}
export function foldedPanels(): Project {
  const p = cantileverPanel(),
    wall = p.surfacePanels![0];
  Object.assign(wall, {
    id: "P1",
    name: "Parede",
    a: { ...origin },
    b: { ...origin, z: 3 },
    d: { ...origin, y: 1.2 },
  });
  p.surfacePanels!.push({
    ...wall,
    id: "P2",
    name: "Laje",
    a: { ...origin, z: 3 },
    b: { x: 3, y: 0, z: 3 },
    d: { x: 0, y: 1.2, z: 3 },
    fixed: [],
  });
  p.name = "Parede e laje em balanço";
  p.loadPatterns[0].panelActions = [
    {
      panelId: "P2",
      edge: "BC",
      traction: { x: 0, y: 0, z: -1000 },
      pressure: 0,
    },
  ];
  return p;
}
