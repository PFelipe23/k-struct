import type { Material, SurfacePanel } from "../domain/model";
import {
  bendingKeys,
  directionalProperties,
  membraneKeys,
  panelComponents,
  panelTrig,
} from "../domain/panelStiffness";
import type { PanelAssembly } from "../domain/surfacePanel";
import { elasticMaterialRecord } from "./elasticMaterial";

const elementNames = {
  membrane: "trplanestressrotallman3d",
  plate: "dktplate3d",
  shell: "tr_shell02",
};
type Kind = SurfacePanel["kind"];

// T maps engineering strains from the triangle frame to the resistant frame.
function bendingMaterial(id: number, mat: Material, p: SurfacePanel) {
  const { c, s } = panelTrig(p.angleDeg),
    { q11, q22, q12, g12 } = directionalProperties(mat, p.stiffness!, "plate");
  const columns = [
    [c * c, s * s, -2 * c * s],
    [s * s, c * c, 2 * c * s],
    [c * s, -c * s, c * c - s * s],
  ];
  const q = (i: number, j: number) => {
    const [a, b, d] = columns[i],
      [u, v, w] = columns[j];
    return a * (q11 * u + q12 * v) + b * (q12 * u + q22 * v) + d * g12 * w;
  };
  const g = mat.E / (2 * (1 + mat.nu));
  // AnisoLE reads the upper triangle of C in xx,yy,zz,yz,zx,xy order.
  // The out-of-plane normal is uncoupled. DKT uses the in-plane block.
  const stiff = [
    q(0, 0),
    q(0, 1),
    0,
    0,
    0,
    q(0, 2),
    q(1, 1),
    0,
    0,
    0,
    q(1, 2),
    mat.E,
    0,
    0,
    0,
    g,
    0,
    0,
    g,
    0,
    q(2, 2),
  ];
  if (!stiff.every(Number.isFinite))
    throw new Error(
      `${p.name} · a rotação da rigidez gera coeficientes fora do intervalo numérico.`,
    );
  return `AnisoLE ${id} d ${mat.density} stiff 21 ${stiff.join(" ")} tAlpha 6 ${mat.alpha} ${mat.alpha} ${mat.alpha} 0 0 0`;
}
function membraneMaterial(id: number, mat: Material, p: SurfacePanel) {
  const { e1, e2, nu12, g12 } = directionalProperties(
    mat,
    p.stiffness!,
    "membrane",
  );
  const { c, s } = panelTrig(p.angleDeg),
    g = mat.E / (2 * (1 + mat.nu));
  // Allman also reads Gxy directly for its drilling stabilization.
  return `OrthoLE ${id} d ${mat.density} ex ${e1} ey ${e2} ez ${mat.E} nyxy ${nu12} nyxz 0 nyyz 0 gxy ${g12} gxz ${g} gyz ${g} tAlphaX ${mat.alpha} tAlphaY ${mat.alpha} tAlphaZ ${mat.alpha} lcs 6 ${c} ${s} 0 ${-s} ${c} 0`;
}

export function panelSectionRecords(mesh: PanelAssembly, base: Material[]) {
  const materials: string[] = [],
    sections: string[] = [],
    elements: string[] = [];
  const isotropic = new Map<string, number>();
  const definitions = mesh.panels.map(({ panel }) => {
    const mat = base.find((m) => m.id === panel.materialId)!;
    const modified = panelComponents(panel.kind).some(
      (k) => (panel.stiffness?.[k] ?? 1) !== 1,
    );
    const kinds: Kind[] =
      modified && panel.kind === "shell" ? ["membrane", "plate"] : [panel.kind];
    const parts = kinds.map((kind) => {
      const keys = kind === "membrane" ? membraneKeys : bendingKeys;
      const directional =
        modified && keys.some((k) => (panel.stiffness?.[k] ?? 1) !== 1);
      let material = isotropic.get(mat.id);
      if (directional) {
        material = materials.length + 1;
        materials.push(
          kind === "plate"
            ? bendingMaterial(material, mat, panel)
            : membraneMaterial(material, mat, panel),
        );
      } else if (material === undefined) {
        material = materials.push(
          elasticMaterialRecord(mat, materials.length + 1),
        );
        isotropic.set(mat.id, material);
      }
      const id = sections.length + 1;
      // SimpleCS drops D16/D26 in plate bending. Two through-thickness
      // Gauss points in one homogeneous layer integrate z² exactly.
      sections.push(
        directional && kind === "plate"
          ? `LayeredCS ${id} nlayers 1 layermaterials 1 ${material} thicks 1 ${panel.thickness} widths 1 1 nintegrationpoints 2`
          : `SimpleCS ${id} thick ${panel.thickness} material ${material}`,
      );
      return { id, kind };
    });
    return { parts, modified };
  });
  const sources: { triangle: number; kind: Kind }[] = [];
  for (const [index, e] of mesh.elements.entries()) {
    const { parts, modified } = definitions[e.panel];
    // Each cell is ABC + ACD. The cyclic CDA ordering keeps the same
    // material tensor in both natural frames (AB and CD are antiparallel).
    const [a, b, c] = e.nodes;
    const ids = modified && index % 2 === 1 ? [b, c, a] : e.nodes;
    for (const { id, kind } of parts) {
      const n = sources.push({ triangle: index, kind });
      elements.push(
        `${elementNames[kind]} ${n} nodes 3 ${ids.join(" ")} crossSect ${id} nip 4`,
      );
    }
  }
  return { materials, sections, elements, sources };
}
