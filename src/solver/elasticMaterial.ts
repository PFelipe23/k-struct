import type { Material } from "../domain/model";

export function elasticMaterialRecord(material: Material, number: number) {
  return `IsoLE ${number} d ${material.density} E ${material.E} n ${material.nu} tAlpha ${material.alpha}`;
}
