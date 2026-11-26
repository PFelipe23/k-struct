import { readFileSync } from "node:fs";
import { parseProject } from "../../src/domain/model";
const example = readFileSync(
  new URL("../../examples/duas-lajes-viga-comum.kstruct.json", import.meta.url),
  "utf8",
);
export function jointedSlabs(n = 4) {
  const p = parseProject(example);
  for (const s of p.slabs) {
    if (s.polygon) throw new Error("O exemplo requer painéis retangulares.");
    s.divisionsX = n;
    s.divisionsY = n;
  }
  p.mesh.segmentsPerMember = n;
  p.slabJoint!.kind = "hinged";
  delete p.slabJoint!.stiffness;
  return p;
}
