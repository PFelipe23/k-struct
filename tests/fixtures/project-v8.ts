import type { Project, Section } from "../../src/domain/model";

export function rectangle(section: Section) {
  if (section.shape !== "rectangle")
    throw new Error("A referência exige uma seção retangular.");
  return section;
}

// v1–v9 stored untagged rectangles. Preserve the original dimensions and IDs.
export function projectV9(project: Project) {
  return {
    ...project,
    schemaVersion: 9,
    loadPatterns: project.loadPatterns.map(({ selfWeight, ...pattern }) => {
      void selfWeight;
      return pattern;
    }),
    sections: project.sections.map((s) => {
      const { shape, ...legacy } = rectangle(s);
      return legacy;
    }),
  };
}

export function projectV8(project: Project) {
  return {
    ...projectV9(project),
    schemaVersion: 8,
    materials: project.materials.map(({ alpha, ...properties }) => properties),
  };
}
