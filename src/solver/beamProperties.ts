import type { Project } from "../domain/model";
import {
  activeStiffnessComponents,
  beamShearCoefficient,
  equivalentBeamProperties,
} from "../domain/memberStiffness";
import { sectionProperties } from "../domain/sections";
import { elasticMaterialRecord } from "./elasticMaterial";

type BeamSection = ReturnType<typeof sectionProperties> & {
  shear: number;
  material: number;
  elements: number[];
};

export function beamPropertyRecords(
  project: Project,
  memberElements: ReadonlyMap<string, number[]>,
  addSet: (value: string) => number,
) {
  const materials = [...project.materials];
  const materialNumbers = new Map(materials.map(({ id }, i) => [id, i + 1]));
  const sections: BeamSection[] = project.sections.map((section) => ({
    ...sectionProperties(section),
    shear: beamShearCoefficient,
    material: materialNumbers.get(section.materialId)!,
    elements: [],
  }));
  const sectionById = new Map(
    project.sections.map(({ id }, i) => [id, sections[i]]),
  );
  const modifiedSections = new Map<string, BeamSection>();
  const modifiedMaterials = new Map<string, number>();
  const components = activeStiffnessComponents(project.mode);
  for (const member of project.members) {
    const base = sectionById.get(member.sectionId)!;
    const factors = components.map((key) => member.stiffness?.[key] ?? 1);
    let section = base;
    if (factors.some((factor) => factor !== 1)) {
      const key = JSON.stringify([member.sectionId, ...factors]);
      let modified = modifiedSections.get(key);
      if (!modified) {
        const material = materials[base.material - 1];
        const { E, ...properties } = equivalentBeamProperties(
          base,
          material,
          member.stiffness,
        );
        let materialNumber = base.material;
        if (E !== material.E) {
          const materialKey = JSON.stringify([material.id, E]);
          materialNumber = modifiedMaterials.get(materialKey) ?? 0;
          if (!materialNumber) {
            materialNumber = materials.push({ ...material, E });
            modifiedMaterials.set(materialKey, materialNumber);
          }
        }
        modified = { ...properties, material: materialNumber, elements: [] };
        sections.push(modified);
        modifiedSections.set(key, modified);
      }
      section = modified;
    }
    section.elements.push(...memberElements.get(member.id)!);
  }
  return {
    sections: sections.map(({ A, Iy, Iz, J, material, shear, elements }, i) => {
      const spatial = project.mode === "spatial" ? ` Iz ${Iz} Ik ${J}` : "";
      const set = addSet(`elements ${elements.length} ${elements.join(" ")}`);
      const shearField =
        shear === beamShearCoefficient ? "1.e18" : String(shear);
      return `SimpleCS ${i + 1} area ${A} Iy ${Iy}${spatial} beamShearCoeff ${shearField} material ${material} set ${set}`;
    }),
    materials: materials.map((material, i) =>
      elasticMaterialRecord(material, i + 1),
    ),
  };
}
