import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analysisErrors,
  appendMember,
  free,
  nodalLoad,
  parseProject,
  serializeProject,
  type Project,
} from "../src/domain/model";
import {
  foundationModes,
  globalFoundationMatrix,
} from "../src/domain/foundation";
import { parseFoundationCsv } from "../src/domain/foundationCsv";
import { supportDofs } from "../src/domain/supports";
import { geometryOnly, planTransform } from "../src/domain/transform";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { coupledCsv, foundationBenchmark } from "./fixtures/foundation";
import { diaphragmBenchmark } from "./fixtures/diaphragm";

const sample = (name: string) =>
  parseFoundationCsv(
    readFileSync(
      new URL(`./fixtures/${name}-matriz.csv`, import.meta.url),
      "utf8",
    ),
    `${name}-matriz.csv`,
  );
const close = (a: number[], b: number[], tol: number) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) =>
    expect(Math.abs(v - b[i])).toBeLessThanOrEqual(
      tol * Math.max(1, Math.abs(b[i])),
    ),
  );
};
const solve = (p: Project) => {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
};
const forceKeys = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const numerical = it.skipIf(!process.env.OOFEM_BIN);

describe("KS-26 · fundações acopladas", () => {
  it("lê a exportação real, os metadados e a liberação declarada de B16", () => {
    const f = sample("F01");
    expect(f.matrix[0][4]).toBeCloseTo(-33111150.217, 5);
    expect(
      f.metadata.find(([name]) => name === "Reação horizontal")?.[1],
    ).toContain("; 24 elementos");
    expect(sample("B16-rotulada").freeDofs).toEqual(["rx"]);
    const weak = sample("F01");
    weak.matrix[5][5] = 1e-16;
    expect(foundationModes(weak)).toHaveLength(6);
  });
  it("identifica linhas e colunas pela legenda e aceita separadores e aspas no nome", () => {
    const [first, header, ...rows] = coupledCsv.split("\r\n");
    const order = [2, 0, 5, 1, 4, 3];
    function reorder(line: string) {
      const [label, ...values] = line.split(";");
      return [label, ...order.map((i) => values[i])].join("\t");
    }
    const source = [
      first.replace('";"Fundação de ensaio";"', '"\t"Bloco; ""B"""\t"'),
      reorder(header),
      ...order.map((i) => reorder(rows[i])),
      rows[6].replace('";"', '"\t"'),
    ].join("\r\n");
    const actual = parseFoundationCsv(source, "b.csv");
    expect(actual.name).toBe('Bloco; "B"');
    expect(actual.matrix).toEqual(
      parseFoundationCsv(coupledCsv, "a.csv").matrix,
    );
  });
  it.each([
    [coupledCsv.replace(";2000;0\r\n", ";2001;0\r\n"), /assimétrica/],
    [coupledCsv.replaceAll("2000;0", "20000;0"), /Energia/],
    [coupledCsv.replace("10000;", "Infinity;"), /Coeficiente inválido/],
    [coupledCsv.replace("10000;", ";"), /Coeficiente inválido/],
    [coupledCsv.replace("uy (m)", "ux (m)"), /repetido/],
    [coupledCsv.replace("theta_y (rad)", "theta_y (graus)"), /unidade/],
    [coupledCsv.replace("Nenhum", "theta_y (rad)"), /GDL livres/],
    [coupledCsv.split("\r\n").slice(0, 5).join("\n"), /incompleta/],
  ])("rejeita o CSV incompatível %#", (source, problem) => {
    expect(() => parseFoundationCsv(source as string, "invalido.csv")).toThrow(
      problem as RegExp,
    );
  });
  it("preserva modelos v15, reabre a matriz em SI e detecta a liberdade RX", () => {
    const existing = diaphragmBenchmark();
    expect(
      parseProject(JSON.stringify({ ...existing, schemaVersion: 15 })),
    ).toEqual(existing);
    const p = foundationBenchmark();
    p.nodes[0].foundation = sample("B16-rotulada");
    expect(analysisErrors(p).join(" ")).toMatch(/corpo rígido/);
    p.nodes[0].restraints.rx = true;
    expect(analysisErrors(p)).toEqual([]);
    expect(parseProject(serializeProject(p))).toEqual(p);
    p.mode = "planar";
    expect(analysisErrors(p).join(" ")).toMatch(/nó espacial/);
  });
  it("exige conexão explícita se o nó da fundação estiver no interior de uma barra", () => {
    const p = foundationBenchmark(),
      node = p.nodes[0];
    p.nodes.push(
      { ...node, id: "B", name: "N2", x: 1, foundation: undefined },
      { ...node, id: "C", name: "N3", x: 5, foundation: undefined },
    );
    appendMember(p, {
      start: "B",
      end: "C",
      sectionId: p.sections[0].id,
      roll: 0,
    });
    expect(analysisErrors(p).join(" ")).toMatch(/N1.*interior/);
  });
  it("espelha forças polares e momentos axiais ao copiar a fundação", () => {
    const p = foundationBenchmark(),
      n = p.nodes[0];
    n.foundation!.reference = "offset";
    n.foundation!.offset = { x: 0.15, y: 0.3, z: -0.2 };
    const K = globalFoundationMatrix(n.foundation!);
    const plan = planTransform(
      p,
      [{ kind: "node", id: "A" }],
      {
        kind: "mirror",
        center: { x: 0, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
      },
      { ...geometryOnly, supports: true },
    );
    const copy = plan.project.nodes.find((n) => n.id !== "A")!;
    expect(copy.foundation!.matrix).toEqual(n.foundation!.matrix);
    const mirrored = globalFoundationMatrix(
      copy.foundation!,
      copy.supportFrame,
    );
    const signs = [-1, 1, 1, 1, -1, -1];
    mirrored.forEach((row, i) =>
      close(
        row,
        K[i].map((v, j) => signs[i] * v * signs[j]),
        1e-9,
      ),
    );
  });
  numerical("resolve o bloco ux/θy e as seis reações no OOFEM 3.0", () => {
    const result = solve(foundationBenchmark());
    close(
      supportDofs.map((k) => result.displacements.A[k]),
      [0.002, 0, 0, 0, 0.001, 0],
      1e-12,
    );
    close(
      forceKeys.map((k) => result.reactions[0][k]),
      [-22000, 0, 0, 0, -8000, 0],
      1e-10,
    );
    expect(Object.keys(result.displacements)).toEqual(["A"]);
    const restrained = foundationBenchmark();
    restrained.nodes[0].restraints.ux = true;
    const combined = solve(restrained);
    close(
      supportDofs.map((k) => combined.displacements.A[k]),
      [0, 0, 0, 0, 0.002, 0],
      1e-12,
    );
    close(
      forceKeys.map((k) => combined.reactions[0][k]),
      [-22000, 0, 0, 0, -8000, 0],
      1e-9,
    );
  });
  numerical(
    "gira 90° e transfere a origem: seis componentes por trabalho virtual",
    () => {
      const p = foundationBenchmark(),
        n = p.nodes[0];
      n.supportFrame = {
        kind: "spatial",
        x: { x: 0, y: 1, z: 0 },
        y: { x: -1, y: 0, z: 0 },
      };
      n.foundation!.reference = "offset";
      n.foundation!.offset = { x: 0, y: 0, z: 0.5 };
      // Source solution: u=(2,-1,3) mm, theta=(2,1,-1) mrad.
      // Multiply the given CSV by q at its origin; transport M_N=M_O+r×F,
      // u_N=u_O−theta×r and rotate both vectors +90° about Z by inspection.
      const load = {
        fx: 5000,
        fy: 22000,
        fz: 18000,
        mx: -19000,
        my: 8500,
        mz: -7000,
      };
      p.loadPatterns[0].nodal = [{ nodeId: "A", ...load }];
      const result = solve(p);
      close(
        supportDofs.map((k) => result.displacements.A[k]),
        [0, 0.0015, 0.003, -0.001, 0.002, -0.001],
        1e-12,
      );
      close(
        forceKeys.map((k) => result.reactions[0][k]),
        forceKeys.map((k) => -load[k]),
        1e-9,
      );
    },
  );
  numerical(
    "analisa o CSV F01 real com sinal do acoplamento e o RX livre de B16",
    () => {
      const p = foundationBenchmark();
      p.nodes[0].foundation = sample("F01");
      // The imposed pair of actions is taken directly from the first printed CSV column.
      p.loadPatterns[0].nodal = [
        { ...nodalLoad("A"), fx: 30892.548165, my: -33111.150217 },
      ];
      const result = solve(p);
      close(
        supportDofs.map((k) => result.displacements.A[k]),
        [0.001, 0, 0, 0, 0, 0],
        1e-12,
      );
      close(
        forceKeys.map((k) => result.reactions[0][k]),
        [-30892.548165, 0, 0, 0, 33111.150217, 0],
        1e-8,
      );
      p.nodes[0].foundation = sample("B16-rotulada");
      p.nodes[0].restraints.rx = true;
      p.loadPatterns[0].nodal = [{ ...nodalLoad("A"), mx: 1800 }];
      const released = solve(p);
      close(
        forceKeys.map((k) => released.reactions[0][k]),
        [0, 0, 0, -1800, 0, 0],
        1e-9,
      );
    },
  );
  numerical(
    "mantém os 36 termos de uma matriz densa em eixos oblíquos e origem excêntrica",
    () => {
      const p = foundationBenchmark(),
        node = p.nodes[0],
        f = node.foundation!;
      const axes = [
        [0.36, 0.48, -0.8],
        [-0.8, 0.6, 0],
        [0.48, 0.64, 0.6],
      ];
      node.supportFrame = {
        kind: "spatial",
        x: { x: 0.36, y: 0.48, z: -0.8 },
        y: { x: -0.8, y: 0.6, z: 0 },
      };
      const [x, y, z] = [0.25, -0.5, 0.125];
      f.reference = "offset";
      f.offset = { x, y, z };
      f.matrix = supportDofs.map((_, i) =>
        supportDofs.map((_, j) =>
          i === j ? (i + 2) * 1e6 : (i + j + 1) * 2e4,
        ),
      );
      // Independent dense congruence. q_O = T q_N with the upper-right block
      // -[r]× Rᵀ. No Cholesky, support-basis or reaction helper in the reference.
      const negativeSkew = [
        [0, z, -y],
        [-z, 0, x],
        [y, -x, 0],
      ];
      const T = supportDofs.map((_, i) =>
        supportDofs.map((_, j) => {
          if (i < 3 && j >= 3)
            return negativeSkew[i].reduce(
              (sum, r, k) => sum + r * axes[k][j - 3],
              0,
            );
          if (i >= 3 && j < 3) return 0;
          return axes[i % 3][j % 3];
        }),
      );
      const K = supportDofs.map((_, i) =>
        supportDofs.map((_, j) =>
          f.matrix.reduce(
            (sum, row, k) =>
              sum +
              row.reduce((entry, v, l) => entry + T[k][i] * v * T[l][j], 0),
            0,
          ),
        ),
      );
      const transformed = globalFoundationMatrix(f, node.supportFrame);
      K.forEach((row, i) => close(transformed[i], row, 1e-11));
      const q = [0.001, -0.002, 0.0005, 0.0007, -0.0003, 0.0012];
      const actions = K.map((row) =>
        row.reduce((sum, v, j) => sum + v * q[j], 0),
      );
      const load = nodalLoad(node.id);
      forceKeys.forEach((k, i) => {
        load[k] = actions[i];
      });
      p.loadPatterns[0].nodal = [load];
      const result = solve(parseProject(serializeProject(p)));
      close(
        supportDofs.map((k) => result.displacements.A[k]),
        q,
        1e-11,
      );
      close(
        forceKeys.map((k) => result.reactions[0][k]),
        actions.map((v) => -v),
        1e-7,
      );
    },
  );

  numerical(
    "combina as matrizes com os vínculos do diafragma em dois nós",
    () => {
      const p = foundationBenchmark(),
        a = p.nodes[0];
      Object.assign(a, { x: 0, y: 0, z: 3 });
      const b = { ...structuredClone(a), id: "B", name: "N2", x: 2 };
      p.nodes.push(b);
      p.diaphragms = [
        {
          id: "D1",
          name: "D1",
          levelId: "level1",
          reference: { x: 1, y: 0 },
          nodeIds: ["A", "B"],
        },
      ];
      p.loadPatterns[0].nodal.push({
        ...p.loadPatterns[0].nodal[0],
        nodeId: "B",
      });
      const result = solve(p);
      for (const node of [a, b]) {
        close(
          supportDofs.map((k) => result.displacements[node.id][k]),
          [0.002, 0, 0, 0, 0.001, 0],
          1e-12,
        );
        const reaction = result.reactions.find((r) => r.nodeId === node.id)!;
        close(
          forceKeys.map((k) => reaction[k]),
          [-22000, 0, 0, 0, -8000, 0],
          1e-9,
        );
      }
    },
  );
  numerical(
    "reproduz a KS-25 no limite diagonal com uma barra conectada",
    () => {
      const p = foundationBenchmark();
      const n = p.nodes[0],
        f = n.foundation!;
      f.matrix[0][4] = f.matrix[4][0] = 0;
      const fixed = free();
      supportDofs.forEach((k) => {
        fixed[k] = true;
      });
      p.nodes.push({
        id: "B",
        name: "N2",
        x: 5,
        y: 1,
        z: 4,
        restraints: fixed,
      });
      appendMember(p, {
        start: "A",
        end: "B",
        sectionId: p.sections[0].id,
        roll: 0,
      });
      const matrixResult = solve(p);
      n.springs = Object.fromEntries(
        supportDofs.map((k, i) => [k, f.matrix[i][i]]),
      );
      delete n.foundation;
      const scalarResult = solve(p);
      close(
        supportDofs.map((k) => matrixResult.displacements.A[k]),
        supportDofs.map((k) => scalarResult.displacements.A[k]),
        1e-11,
      );
      close(
        forceKeys.map((k) => matrixResult.reactions[0][k]),
        forceKeys.map((k) => scalarResult.reactions[0][k]),
        1e-7,
      );
    },
  );
});
