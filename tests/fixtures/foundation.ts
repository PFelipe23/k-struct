import { createProject, free, nodalLoad } from "../../src/domain/model";
import { parseFoundationCsv } from "../../src/domain/foundationCsv";

export const coupledCsv =
  '\uFEFF"MolaStruct";"Fundação de ensaio";"kN;m;rad"\r\n' +
  [
    "GDL;ux (m);uy (m);uz (m);theta_x (rad);theta_y (rad);theta_z (rad)",
    "Fx (kN);10000;0;0;0;2000;0",
    "Fy (kN);0;5000;0;0;0;0",
    "Fz (kN);0;0;6000;0;0;0",
    "Mx (kN.m);0;0;0;3000;0;0",
    "My (kN.m);2000;0;0;0;4000;0",
    "Mz (kN.m);0;0;0;0;0;7000",
    '"GDL livres";"Nenhum"',
  ].join("\r\n");

export function foundationBenchmark() {
  const p = createProject("spatial");
  p.nodes.push({
    id: "A",
    name: "N1",
    x: 3,
    y: -1,
    z: 2,
    restraints: free(),
    foundation: parseFoundationCsv(coupledCsv, "ensaio.csv"),
  });
  p.loadPatterns[0].nodal.push({ ...nodalLoad("A"), fx: 22000, my: 8000 });
  return p;
}
