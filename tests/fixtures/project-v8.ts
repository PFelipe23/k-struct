import type { Project } from "../../src/domain/model";

// v1–v8 stored the elastic properties without a thermal expansion coefficient.
export function projectV8(project: Project) {
  return {
    ...project,
    schemaVersion: 8,
    materials: project.materials.map(({ alpha, ...properties }) => properties),
  };
}
