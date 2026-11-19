import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
const finite = z.number().finite();
const text = z.string().min(1).max(120);
export const nodeSchema = z
  .object({
    id,
    name: text,
    x: finite,
    y: finite,
    z: finite,
    restraints: z
      .object({ ux: z.boolean(), uz: z.boolean(), ry: z.boolean() })
      .strict(),
  })
  .strict();
const materialSchema = z
  .object({
    id,
    name: text,
    E: finite.positive(),
    nu: finite.min(0).lt(0.5),
    density: finite.positive(),
  })
  .strict();
const sectionSchema = z
  .object({
    id,
    name: text,
    materialId: id,
    width: finite.positive(),
    height: finite.positive(),
  })
  .strict();
const memberSchema = z
  .object({ id, name: text, start: id, end: id, sectionId: id })
  .strict();
const patternSchema = z
  .object({
    id,
    name: text,
    nodal: z
      .array(
        z.object({ nodeId: id, fx: finite, fz: finite, my: finite }).strict(),
      )
      .max(5000),
    uniform: z
      .array(z.object({ memberId: id, qx: finite, qz: finite }).strict())
      .max(5000),
  })
  .strict();
export const projectSchema = z
  .object({
    format: z.literal("kstruct"),
    schemaVersion: z.literal(1),
    id,
    name: text,
    units: z.literal("N-m-kg-s"),
    nodes: z.array(nodeSchema).max(1000),
    members: z.array(memberSchema).max(1000),
    materials: z.array(materialSchema).min(1).max(100),
    sections: z.array(sectionSchema).min(1).max(100),
    loadPatterns: z.array(patternSchema).min(1).max(100),
    analysisCases: z
      .array(
        z
          .object({
            id,
            name: text,
            type: z.literal("linear-static"),
            factors: z
              .array(z.object({ patternId: id, factor: finite }).strict())
              .min(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    mesh: z
      .object({ segmentsPerMember: z.number().int().min(2).max(32) })
      .strict(),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
export type StructuralNode = Project["nodes"][number];
export type Member = Project["members"][number];
export type Selection = { kind: "node" | "member"; id: string } | null;
export const uid = () => crypto.randomUUID();
export const free = () => ({ ux: false, uz: false, ry: false });

export function createProject(): Project {
  return {
    format: "kstruct",
    schemaVersion: 1,
    id: uid(),
    name: "Projeto sem título",
    units: "N-m-kg-s",
    nodes: [],
    members: [],
    materials: [
      {
        id: "steel",
        name: "Aço · E = 200 GPa",
        E: 2e11,
        nu: 0.3,
        density: 7850,
      },
    ],
    sections: [
      {
        id: "rect",
        name: "Retangular 15 × 20 cm",
        materialId: "steel",
        width: 0.15,
        height: 0.2,
      },
    ],
    loadPatterns: [
      { id: "G", name: "Carga permanente", nodal: [], uniform: [] },
    ],
    analysisCases: [
      {
        id: "EL",
        name: "EL · Estática linear",
        type: "linear-static",
        factors: [{ patternId: "G", factor: 1 }],
      },
    ],
    mesh: { segmentsPerMember: 8 },
  };
}

export function beamExample(): Project {
  const p = createProject();
  p.name = "Viga biapoiada · 6 m";
  p.nodes = [
    {
      id: "A",
      name: "N1",
      x: 0,
      y: 0,
      z: 0,
      restraints: { ux: true, uz: true, ry: false },
    },
    {
      id: "B",
      name: "N2",
      x: 6,
      y: 0,
      z: 0,
      restraints: { ux: false, uz: true, ry: false },
    },
  ];
  p.members = [
    { id: "V1", name: "B1", start: "A", end: "B", sectionId: "rect" },
  ];
  p.loadPatterns[0].uniform = [{ memberId: "V1", qx: 0, qz: -10000 }];
  return p;
}

export function serializeProject(p: Project) {
  return JSON.stringify(projectSchema.parse(p), null, 2);
}
export function parseProject(source: string): Project {
  if (source.length > 5_000_000)
    throw new Error("O arquivo excede o limite inicial de 5 MB.");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("O arquivo não contém um JSON válido.");
  }
  const parsed = projectSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Formato incompatível. Use um projeto KStruct versão 1, com valores numéricos finitos.",
    );
  const errors = referenceErrors(parsed.data);
  if (errors.length) throw new Error(errors.join("\n"));
  return parsed.data;
}

export function referenceErrors(p: Project): string[] {
  const errors: string[] = [];
  for (const list of [
    p.nodes,
    p.members,
    p.materials,
    p.sections,
    p.loadPatterns,
    p.analysisCases,
  ]) {
    if (new Set(list.map((v) => v.id)).size !== list.length)
      errors.push("Há identificadores duplicados no projeto.");
  }
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  for (const m of p.members) {
    const a = nodes.get(m.start),
      b = nodes.get(m.end);
    if (!a || !b) errors.push(`${m.name}: nó de extremidade inexistente.`);
    if (!p.sections.some((s) => s.id === m.sectionId))
      errors.push(`${m.name}: seção inexistente.`);
  }
  for (const s of p.sections)
    if (!p.materials.some((m) => m.id === s.materialId))
      errors.push(`${s.name}: material inexistente.`);
  for (const pat of p.loadPatterns) {
    if (pat.nodal.some((l) => !nodes.has(l.nodeId)))
      errors.push(`${pat.name}: carga em nó inexistente.`);
    if (pat.uniform.some((l) => !p.members.some((m) => m.id === l.memberId)))
      errors.push(`${pat.name}: carga em barra inexistente.`);
  }
  for (const c of p.analysisCases)
    if (
      c.factors.some((f) => !p.loadPatterns.some((l) => l.id === f.patternId))
    )
      errors.push(`${c.name}: padrão de carga inexistente.`);
  return errors;
}

function rank(rows: number[][]): number {
  const a = rows.map((r) => [...r]);
  let r = 0;
  for (let c = 0; c < 3 && r < a.length; c++) {
    const pivot = a.findIndex((v, i) => i >= r && Math.abs(v[c]) > 1e-8);
    if (pivot < 0) continue;
    [a[r], a[pivot]] = [a[pivot], a[r]];
    const v = a[r][c];
    a[r] = a[r].map((x) => x / v);
    for (let i = r + 1; i < a.length; i++) {
      const f = a[i][c];
      a[i] = a[i].map((x, j) => x - f * a[r][j]);
    }
    r++;
  }
  return r;
}

export function analysisErrors(p: Project): string[] {
  const errors = referenceErrors(p);
  if (errors.length) return errors;
  for (const m of p.members) {
    const a = p.nodes.find((n) => n.id === m.start)!,
      b = p.nodes.find((n) => n.id === m.end)!;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6)
      errors.push(`${m.name}: comprimento nulo.`);
  }
  if (!p.members.length)
    errors.push("Lance pelo menos uma barra para analisar.");
  if (p.nodes.some((n) => Math.abs(n.y) > 1e-8))
    errors.push("Esta etapa analisa somente o plano XZ (Y = 0).");
  const edges = new Map(p.nodes.map((n) => [n.id, new Set<string>()]));
  const pairs = new Set<string>();
  for (const m of p.members) {
    edges.get(m.start)!.add(m.end);
    edges.get(m.end)!.add(m.start);
    const key = [m.start, m.end].sort().join("|");
    if (pairs.has(key)) errors.push(`${m.name}: barra duplicada.`);
    pairs.add(key);
  }
  if (p.nodes.some((n) => !edges.get(n.id)!.size))
    errors.push("Remova ou conecte os nós isolados antes de analisar.");
  for (let i = 0; i < p.nodes.length; i++) {
    const a = p.nodes[i];
    if (
      p.nodes
        .slice(i + 1)
        .some((b) => Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y) < 1e-6)
    ) {
      errors.push(
        "Há nós coincidentes com IDs distintos. Conecte as barras ao mesmo nó.",
      );
      break;
    }
  }
  const visited = new Set<string>();
  for (const seed of p.nodes) {
    if (visited.has(seed.id)) continue;
    const stack = [seed.id],
      component: string[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      stack.push(...edges.get(id)!);
    }
    const constraints: number[][] = [];
    for (const n of p.nodes.filter((n) => component.includes(n.id))) {
      if (n.restraints.ux) constraints.push([1, 0, n.z - seed.z]);
      if (n.restraints.uz) constraints.push([0, 1, -(n.x - seed.x)]);
      if (n.restraints.ry) constraints.push([0, 0, 1]);
    }
    if (rank(constraints) < 3)
      errors.push(
        `Estrutura ligada a ${seed.name}: apoios insuficientes para impedir movimento de corpo rígido no plano.`,
      );
  }
  // Endpoints inside another member must be explicitly split, never silently connected.
  for (const m of p.members) {
    const a = p.nodes.find((n) => n.id === m.start)!,
      b = p.nodes.find((n) => n.id === m.end)!;
    const dx = b.x - a.x,
      dz = b.z - a.z,
      l2 = dx * dx + dz * dz;
    if (!l2) continue;
    for (const n of p.nodes) {
      if (n.id === a.id || n.id === b.id) continue;
      const t = ((n.x - a.x) * dx + (n.z - a.z) * dz) / l2;
      if (
        t > 1e-6 &&
        t < 1 - 1e-6 &&
        Math.hypot(n.x - a.x - t * dx, n.z - a.z - t * dz) < 1e-6
      )
        errors.push(
          `${n.name} está no interior de ${m.name}. Divida a barra nesse nó.`,
        );
    }
  }
  return [...new Set(errors)];
}

export function addPoint(p: Project, x: number, z: number): StructuralNode {
  const existing = p.nodes.find(
    (n) => Math.hypot(n.x - x, n.z - z) < 1e-6 && n.y === 0,
  );
  if (existing) return existing;
  const n: StructuralNode = {
    id: uid(),
    name: `N${p.nodes.length + 1}`,
    x,
    y: 0,
    z,
    restraints: free(),
  };
  p.nodes.push(n);
  return n;
}

export function removeSelection(p: Project, s: Selection) {
  if (!s) return;
  const removed = p.members
    .filter((m) =>
      s.kind === "member" ? m.id === s.id : m.start === s.id || m.end === s.id,
    )
    .map((m) => m.id);
  p.members = p.members.filter((m) => !removed.includes(m.id));
  if (s.kind === "node") p.nodes = p.nodes.filter((n) => n.id !== s.id);
  for (const pat of p.loadPatterns) {
    pat.uniform = pat.uniform.filter((l) => !removed.includes(l.memberId));
    if (s.kind === "node")
      pat.nodal = pat.nodal.filter((l) => l.nodeId !== s.id);
  }
}
