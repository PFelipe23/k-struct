import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { version } from "../../package.json";
import { buildResultTable, type ResultView } from "../components/Results";
import {
  formatResult,
  formatResultCell,
  formatResultQuantity,
  getForceLabel,
} from "../components/resultFormatting";
import { serializeProject, type Project } from "../domain/model";
import { coordinates, type Point3 } from "../domain/geometry";
import { dimensions, shapeNames } from "../domain/sections";
import { slabRings } from "../domain/slabPolygon";
import { panelGeometry, panelKinds } from "../domain/surfacePanel";
import { restrainedDofs, supportBasis } from "../domain/supports";
import { formatQuantity, unitLabel, type UnitPreferences } from "../units";
import { combineLinearResults } from "./combinations";
import type { AnalysisResult } from "./oofem";
import { reportCaseStatus, type ReportRun } from "./reportRuns";
import { panelFields } from "./surfacePanel";

export const reportTables = {
  reactions: "Reações",
  displacements: "Deslocamentos",
  forces: "Esforços",
};
export type ReportTable = keyof typeof reportTables;
export type ReportOptions = {
  sources: string[];
  tables: ReportTable[];
  geometry: boolean;
  diagramMemberId: string;
};
export type ReportSnapshot = {
  project: Project;
  revision: number;
  results: ReadonlyMap<string, AnalysisResult>;
  runs: ReadonlyMap<string, ReportRun>;
  units: UnitPreferences;
  issuedAt: string;
  options: ReportOptions;
  warnings?: readonly string[];
};

export function reportSources(project: Project) {
  return [
    ...project.analysisCases.map((definition) => ({
      scope: "case:" + definition.id,
      kind: "case" as const,
      definition,
    })),
    ...(project.slabs.length || project.surfacePanels?.length
      ? []
      : project.resultCombinations.map((definition) => ({
          scope: "combination:" + definition.id,
          kind: "combination" as const,
          definition,
        }))),
  ];
}

export async function modelFingerprint(project: Project) {
  const json = JSON.stringify(
    JSON.parse(serializeProject(project)),
    (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) =>
              a < b ? -1 : a === b ? 0 : 1,
            ),
          )
        : value,
  );
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return Array.from(new Uint8Array(data), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

type Cell = string | number;
const section = (text: string): Content => ({ text, style: "section" });
const note = (text: string): Content => ({ text, style: "note" });
function table(headers: string[], rows: Cell[][], caption = ""): Content {
  if (!rows.length)
    return note(
      [caption, "Sem registros no escopo selecionado."]
        .filter(Boolean)
        .join(" · "),
    );
  return {
    layout: "lightHorizontalLines",
    table: {
      headerRows: caption ? 2 : 1,
      keepWithHeaderRows: 1,
      widths: headers.map((_, i) => (i === 0 ? "auto" : "*")),
      body: [
        ...(caption
          ? [
              [
                {
                  text: caption,
                  colSpan: headers.length,
                  bold: true,
                  margin: [0, 3, 0, 3] as [number, number, number, number],
                },
                ...headers.slice(1).map(() => ""),
              ],
            ]
          : []),
        headers.map((text) => ({ text, bold: true, fillColor: "#e8eef4" })),
        ...rows.map((row) => row.map((value) => String(value))),
      ],
    },
    fontSize: 8,
    margin: [0, 3, 0, 8],
  };
}

function canonicalFields(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalFields).join(", ") + "]";
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, field]) => `${key}=${canonicalFields(field)}`)
      .join(", ");
  return String(value ?? "");
}

function modelSections({ project: p, units }: ReportSnapshot): Content[] {
  const length = (value: number) => formatQuantity(value, "length", units);
  const xyz = (v: Point3) =>
    coordinates.map((axis) => length(v[axis])).join(" / ");
  return [
    section("Materiais"),
    table(
      [
        "Material",
        `E (${units.modulus})`,
        "ν",
        "Massa específica (kg/m³)",
        "α (1/K)",
      ],
      p.materials.map((m) => [
        `[${m.id}] ${m.name}`,
        formatQuantity(m.E, "modulus", units),
        formatResult(m.nu),
        formatResult(m.density),
        String(m.alpha),
      ]),
    ),
    section("Seções"),
    table(
      ["Seção", "Forma e dimensões", "Material"],
      p.sections.map((s) => [
        `[${s.id}] ${s.name}`,
        `${shapeNames[s.shape]} · ${dimensions(s)
          .map(
            (d) =>
              `${d.label} = ${formatQuantity(d.value, "section", units)} ${units.section}`,
          )
          .join(" / ")}`,
        s.materialId,
      ]),
    ),
    section("Nós e vínculos"),
    table(
      [
        "Nó",
        `XYZ (${units.length})`,
        "Graus rígidos e referencial",
        "Vínculos complementares em SI",
      ],
      p.nodes.map((n) => [
        `[${n.id}] ${n.name}`,
        xyz(n),
        `${
          restrainedDofs(n.restraints)
            .map((v) => v.toUpperCase())
            .join(", ") || "Livre"
        } · ${n.supportFrame ? canonicalFields(supportBasis(n.supportFrame)) : "XYZ global"}`,
        [
          n.springs && "Molas (N/m ou N·m/rad) · " + canonicalFields(n.springs),
          n.foundation &&
            "Fundação · " +
              canonicalFields(n.foundation.matrix) +
              ` · referência ${n.foundation.reference} · offset ${canonicalFields(n.foundation.offset)} m`,
          p.diaphragms?.find((v) => v.nodeIds.includes(n.id))?.name,
        ]
          .filter(Boolean)
          .join("\n"),
      ]),
    ),
    ...(p.diaphragms?.length
      ? [
          note("Diafragmas com referência em m"),
          table(
            ["Diafragma", "Pavimento", "Referência XY (m)", "Nós"],
            p.diaphragms.map((d) => [
              `[${d.id}] ${d.name}`,
              d.levelId,
              canonicalFields(d.reference),
              d.nodeIds.join(", "),
            ]),
          ),
        ]
      : []),
    ...(p.members.length
      ? [
          section("Barras e malha"),
          note(
            `${p.mesh.segmentsPerMember} subdivisões regulares por barra. Conexões e estações de carga também definem pontos de malha.`,
          ),
          table(
            [
              "Barra",
              "Nós i → j",
              "Seção",
              "Rotação e propriedades de extremidade (SI)",
            ],
            p.members.map((m) => [
              `[${m.id}] ${m.name}`,
              `${m.start} → ${m.end}`,
              m.sectionId,
              [
                `${formatResult(m.roll)}°`,
                m.offsets && "Offsets · " + canonicalFields(m.offsets),
                m.connectionI &&
                  "Ligação i · " + canonicalFields(m.connectionI),
                m.connectionJ &&
                  "Ligação j · " + canonicalFields(m.connectionJ),
                m.stiffness &&
                  "Fatores de rigidez · " + canonicalFields(m.stiffness),
                ...p.meshConnections
                  .filter((v) => v.memberId === m.id)
                  .map((v) => `Conexão de malha em ${v.nodeId}`),
              ]
                .filter(Boolean)
                .join("\n"),
            ]),
          ),
        ]
      : []),
    ...(p.slabs.length
      ? [
          section("Lajes e vínculos de borda"),
          table(
            ["Laje", "Material e espessura", "Malha", "Bordas apoiadas"],
            p.slabs.map((s) => [
              `[${s.id}] ${s.name}`,
              `${s.materialId} · ${length(s.thickness)} ${units.length} · nível ${s.levelId}`,
              [
                s.formulation.toUpperCase(),
                s.polygon
                  ? `Refinamento ${s.polygon.refinements}`
                  : `${s.divisionsX} × ${s.divisionsY}`,
                s.sizing &&
                  "Configuração de tamanho (m) · " + canonicalFields(s.sizing),
              ]
                .filter(Boolean)
                .join(" / "),
              slabRings(s)
                .flatMap((r) =>
                  r.filter((v) => v.supported).map((v) => v.edgeId),
                )
                .join(", ") || "Sem apoio de borda",
            ]),
          ),
          ...(p.slabJoint
            ? [
                note(
                  "Ligação das bordas (SI) · " + canonicalFields(p.slabJoint),
                ),
              ]
            : []),
        ]
      : []),
    ...(p.surfacePanels?.length
      ? [
          section("Painéis espaciais"),
          table(
            ["Painel", "Tipo e material", "Malha", "Bordas engastadas"],
            p.surfacePanels.map((s) => [
              `[${s.id}] ${s.name}`,
              `${panelKinds[s.kind]} · ${s.materialId} · espessura ${length(s.thickness)} ${units.length}`,
              `${s.nu} × ${s.nv} · eixo resistente ${s.angleDeg ?? 0}°`,
              s.fixed.join(", ") || "Sem engaste de borda",
            ]),
          ),
        ]
      : []),
  ];
}

const actionLabels: Record<string, string> = {
  nodal: "Forças e momentos nodais (N, N·m)",
  uniform: "Cargas uniformes globais (N/m)",
  prescribed: "Movimentos impostos (m, rad)",
  points: "Cargas pontuais (N, N·m, m ou x/L)",
  distributed: "Cargas por trecho (N/m, m ou x/L)",
  pressure: "Pressões nas lajes (Pa)",
  wind: "Vento de referência (Pa, m, °)",
  thermal: "Temperatura (K ou K/m)",
  panelActions: "Ações de painel (N/m, Pa)",
  tributaryLoads: "Ações em painéis de carga",
  selfWeight: "Peso próprio (m/s²)",
};

function actionSections(project: Project, usedCases: Set<string>): Content[] {
  const patterns = new Set(
    project.analysisCases
      .filter((c) => usedCases.has(c.id))
      .flatMap((c) =>
        c.factors.filter((f) => f.factor !== 0).map((f) => f.patternId),
      ),
  );
  const content: Content[] = [];
  const panels =
    project.loadPanels?.filter((panel) =>
      project.loadPatterns.some(
        (pattern) =>
          patterns.has(pattern.id) &&
          pattern.tributaryLoads?.some((action) => action.panelId === panel.id),
      ),
    ) ?? [];
  if (panels.length)
    content.push(
      section("Painéis de carga do escopo"),
      table(
        ["Painel", "Definição física (SI)"],
        panels.map((p) => [p.id, canonicalFields(p)]),
      ),
    );
  content.push(section("Ações por padrão"));
  for (const { id, name, ...loads } of project.loadPatterns) {
    if (!patterns.has(id)) continue;
    const rows = Object.entries(loads).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map((row) => [
        actionLabels[key] ?? key,
        canonicalFields(row),
      ]),
    );
    content.push(
      note(`[${id}] ${name} · Grandezas de entrada em SI`),
      table(["Tipo", "Registros físicos e parâmetros"], rows),
    );
  }
  return content;
}

function outline(project: Project): Content {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const paths: Point3[][] = project.members.flatMap((m) => {
    const i = nodes.get(m.start),
      j = nodes.get(m.end);
    return i && j ? [[i, j]] : [];
  });
  for (const slab of project.slabs) {
    const z = project.guides.z.find((v) => v.id === slab.levelId)!.position;
    for (const ring of slabRings(slab))
      paths.push([...ring, ring[0]].map((v) => ({ ...v, z })));
  }
  for (const panel of project.surfacePanels ?? []) {
    const { A, B, C, D } = panelGeometry(panel).corners;
    paths.push([A, B, C, D, A]);
  }
  if (!paths.length) return note("Geometria sem barras ou contornos de área.");
  const projectPoint = ({ x, y, z }: Point3) =>
    project.mode === "planar"
      ? { x, y: z }
      : { x: x - 0.65 * y, y: z + 0.42 * (x + y) };
  const projected = paths.map((path) => path.map(projectPoint));
  let left = Infinity,
    right = -Infinity,
    low = Infinity,
    high = -Infinity;
  for (const path of projected)
    for (const { x, y } of path) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
  const zoom = Math.min(470 / (right - left || 1), 135 / (high - low || 1));
  return {
    unbreakable: true,
    stack: [
      section("Figura · Geometria de referência"),
      {
        canvas: projected.map((path) => ({
          type: "polyline",
          lineWidth: 1.25,
          lineColor: "#24516d",
          points: path.map(({ x, y }) => ({
            x: 12 + (x - left) * zoom,
            y: 16 + (high - y) * zoom,
          })),
        })),
        margin: [0, 4, 0, 6],
      },
      note(
        project.mode === "planar"
          ? "Projeção global XZ do modelo físico."
          : "Projeção axonométrica dos eixos globais. Elevações e conectividade constam no modelo e nas tabelas.",
      ),
    ],
  };
}

function momentFigure(
  p: Project,
  view: ResultView,
  memberId: string,
  units: UnitPreferences,
): Content | null {
  const member = p.members.find((m) => m.id === memberId);
  const values = view.result?.members[memberId];
  if (!member || !values?.length) return null;
  const component = p.mode === "planar" ? "m" : "my";
  const label = getForceLabel(component, units);
  const min = Math.min(...values.map((s) => s[component])),
    max = Math.max(...values.map((s) => s[component]));
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  return {
    unbreakable: true,
    stack: [
      section(
        `Figura · ${label.symbol} (${label.unit}) · [${member.id}] ${member.name}`,
      ),
      {
        canvas: [
          {
            type: "rect",
            x: 0,
            y: 0,
            w: 500,
            h: 115,
            lineColor: "#e8eef4",
            lineWidth: 0.5,
          },
          {
            type: "line",
            x1: 12,
            x2: 488,
            y1: 57.5,
            y2: 57.5,
            lineColor: "#778698",
            dash: { length: 3 },
          },
          {
            type: "polyline",
            lineColor: "#24516d",
            lineWidth: 1.5,
            points: values.map((s) => ({
              x: 12 + 476 * s.t,
              y: 57.5 - (50 * s[component]) / scale,
            })),
          },
        ],
        margin: [0, 4, 0, 5],
      },
      note(
        `[${view.definition.id}] ${view.definition.name} · x/L de i (0) a j (1) · linha tracejada no zero · amostras do eixo local. Mínimo ${formatResultQuantity(min, "moment", units)} e máximo ${formatResultQuantity(max, "moment", units)} ${label.unit}.`,
      ),
    ],
  };
}

function areaTables(
  result: AnalysisResult,
  selected: ReportTable[],
  units: UnitPreferences,
  tag: string,
): Content[] {
  const content: Content[] = [];
  for (const slab of result.floor?.panels ??
    (result.slab ? [result.slab] : [])) {
    const force = (v: number) => formatResultQuantity(v, "force", units);
    const moment = (v: number) => formatResultQuantity(v, "moment", units);
    const displacement = (v: number) =>
      formatResultQuantity(v, "displacement", units);
    content.push(
      note(
        `Laje [${slab.slabId}] · ${slab.mesh.elements.length} elementos · soma das reações Z ${force(slab.totalReactionZ)} ${units.force} · carga Z ${force(slab.totalLoadZ)} ${units.force}. Mx e My positivos tracionam a face inferior.`,
      ),
    );
    if (selected.includes("reactions"))
      content.push(
        table(
          ["Nó de malha", `RZ global (${units.force})`],
          slab.reactions.map((r) => [r.node, force(r.fz)]),
          `Reações · Laje [${slab.slabId}] · ${tag}`,
        ),
      );
    if (selected.includes("displacements"))
      content.push(
        table(
          ["Nó de malha", `UZ global (${units.displacement})`],
          slab.nodes.map((n, i) => [
            slab.mesh.nodes[i].number,
            displacement(n.uz),
          ]),
          `Deslocamentos · Laje [${slab.slabId}] · ${tag}`,
        ),
      );
    if (selected.includes("forces"))
      content.push(
        table(
          ["Elemento", `Mx (${units.moment}/m)`, `My (${units.moment}/m)`],
          slab.elements.map((e, i) => [
            slab.mesh.elements[i].number,
            moment(e.mx),
            moment(e.my),
          ]),
          `Esforços · Laje [${slab.slabId}] · ${tag}`,
        ),
      );
  }
  const panels = result.panels;
  if (panels) {
    const vector = (v: Point3, q: "force" | "moment") =>
      coordinates.map((k) => formatResultQuantity(v[k], q, units)).join(" / ");
    content.push(
      note(
        `Equilíbrio XYZ do conjunto verificado. Reações ${vector(panels.force, "force")} ${units.force} e momentos ${vector(panels.moment, "moment")} ${units.moment} em relação a A do primeiro painel.`,
      ),
    );
    if (selected.includes("reactions"))
      content.push(
        table(
          [
            "Nó de malha",
            `RX/RY/RZ global (${units.force})`,
            `MX/MY/MZ global (${units.moment})`,
          ],
          panels.supportReactions.map((r) => [
            r.id,
            vector(r.force, "force"),
            vector(r.couple, "moment"),
          ]),
          `Reações · Painéis espaciais · ${tag}`,
        ),
      );
    for (const panel of panels.panels) {
      content.push(
        note(
          `[${panel.panelId}] ${panel.name} · eixos resistentes ${canonicalFields(panel.axes)}`,
        ),
      );
      if (selected.includes("displacements"))
        content.push(
          table(
            ["Nó de malha", `U1/U2/U3 local (${units.displacement})`],
            panel.nodes.map((r) => [
              r.id,
              coordinates
                .map((k) =>
                  formatResultQuantity(r.local[k], "displacement", units),
                )
                .join(" / "),
            ]),
            `Deslocamentos · [${panel.panelId}] ${panel.name} · ${tag}`,
          ),
        );
      if (selected.includes("forces")) {
        const fields = panelFields.filter((k) =>
          panel.samples.some((s) => s.fields[k] !== undefined),
        );
        const labels = {
          nxx: "N11",
          nyy: "N22",
          nxy: "N12",
          mxx: "M11",
          myy: "M22",
          mxy: "M12",
        };
        content.push(
          table(
            [
              "Elemento · ponto de integração",
              ...fields.map(
                (k) =>
                  `${labels[k]} (${k.startsWith("n") ? units.distributedLoad : units.moment + "/m"})`,
              ),
            ],
            panel.samples.map((s) => [
              `${s.element} · ${s.gp}`,
              ...fields.map((k) =>
                s.fields[k] === undefined
                  ? "—"
                  : formatResultQuantity(
                      s.fields[k],
                      k.startsWith("n") ? "distributedLoad" : "moment",
                      units,
                    ),
              ),
            ]),
            `Esforços · [${panel.panelId}] ${panel.name} · ${tag}`,
          ),
        );
      }
    }
  }
  return content;
}

export async function buildAnalysisReport(
  snapshot: ReportSnapshot,
): Promise<TDocumentDefinitions> {
  const {
    project: p,
    revision,
    results,
    runs,
    units,
    issuedAt,
    options,
  } = snapshot;
  const scopes = reportSources(p).filter((v) =>
    options.sources.includes(v.scope),
  );
  const usedCases = new Set(
    scopes.flatMap((source) =>
      source.kind === "case"
        ? [source.definition.id]
        : source.definition.factors
            .filter((f) => f.factor !== 0)
            .map((f) => f.caseId),
    ),
  );
  const fingerprint = await modelFingerprint(p);
  const content: Content[] = [
    { text: "Relatório de análise", style: "title" },
    {
      text: `${p.name} [${p.id}]`,
      fontSize: 13,
      bold: true,
      margin: [0, 0, 0, 8],
    },
    note(
      `KStruct ${version} · Revisão ${revision} da sessão · Esquema v${p.schemaVersion} · Emissão ${issuedAt} (UTC)`,
    ),
    note(`SHA-256 do conteúdo do modelo: ${fingerprint}`),
    note(
      `Unidades de apresentação: ${units.force}, ${units.length}, ${units.displacement}, ${units.moment} e mrad. As ações tabuladas por padrão usam SI.`,
    ),
    note(
      `Hipóteses · Estática linear de pequenos deslocamentos e material elástico · modelo ${p.mode === "planar" ? "XZ" : "XYZ"}${p.members.length ? " · barras de Euler–Bernoulli" : ""}. A verificação do equilíbrio segue as tolerâncias do leitor do OOFEM.`,
    ),
    ...(snapshot.warnings ?? []).map((warning) =>
      note("Aviso do modelo · " + warning),
    ),
    ...modelSections(snapshot),
  ];
  if (options.geometry) content.push(outline(p));
  content.push(...actionSections(p, usedCases));
  content.push(section("Casos necessários, execução e malha"));
  for (const c of p.analysisCases.filter((c) => usedCases.has(c.id))) {
    const result = results.get(c.id),
      run = runs.get(c.id);
    const factors = c.factors
      .map((f) => `${f.patternId} × ${f.factor}`)
      .join(" + ");
    const status = reportCaseStatus(p.id, revision, run, !!result);
    content.push(
      note(`[${c.id}] ${c.name} · ${status} · Padrões e fatores ${factors}`),
    );
    if (run?.projectId === p.id) {
      const engine = run.summary?.engine;
      const started = run.summary?.startedAt;
      const date =
        started && Number.isFinite(started)
          ? new Date(started).toISOString()
          : result?.completedAt;
      content.push(
        note(
          [
            date && `Execução ${date} (UTC)`,
            engine
              ? `OOFEM ${engine.version ?? "versão indisponível"}${engine.commit ? " · " + engine.commit : ""}`
              : result?.solver,
            run.summary?.runId && `ID ${run.summary.runId}`,
            run.mesh &&
              `${run.mesh.nodes} nós e ${run.mesh.elements} elementos no OOFEM · ${run.mesh.beams} elementos de barra e ${run.mesh.areas} células de área`,
            run.revision !== revision &&
              `Dados da última execução na revisão ${run.revision}`,
            !result && run.detail,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      for (const warning of run.warnings)
        content.push(note("Aviso · " + warning));
    } else if (result)
      content.push(
        note(
          `${result.solver} · leitura concluída em ${result.completedAt} (UTC)`,
        ),
      );
    if (result?.equilibrium) {
      const { residual, tolerance, reference } = result.equilibrium;
      content.push(
        note(
          `Equilíbrio global verificado no polo XYZ (${coordinates.map((k) => formatQuantity(reference[k], "length", units)).join(" / ")}) ${units.length}.`,
        ),
        table(
          ["Componente", "Resíduo", "Tolerância"],
          residual.map((v, i) => {
            const q = i < 3 ? "force" : "moment";
            return [
              `${["FX", "FY", "FZ", "MX", "MY", "MZ"][i]} (${unitLabel(q, units)})`,
              formatQuantity(v, q, units),
              formatQuantity(tolerance[i], q, units),
            ];
          }),
        ),
      );
    }
  }
  for (const source of scopes) {
    const def = source.definition;
    content.push(
      section(
        `${source.kind === "case" ? "Caso" : "Combinação"} [${def.id}] · ${def.name}`,
      ),
    );
    const tag = `[${def.id}] ${def.name}`;
    let view: ResultView;
    if (source.kind === "case")
      view = {
        kind: "case",
        definition: source.definition,
        result: results.get(def.id) ?? null,
      };
    else {
      content.push(
        note(
          source.definition.factors
            .map((f) => `[${f.caseId}] × ${f.factor}`)
            .join(" + "),
        ),
      );
      try {
        view = {
          kind: "combination",
          definition: source.definition,
          result: combineLinearResults(p, source.definition, results),
          problem: "",
        };
      } catch (error) {
        content.push(
          note(error instanceof Error ? error.message : String(error)),
        );
        continue;
      }
    }
    if (!view.result) {
      content.push(
        note(reportCaseStatus(p.id, revision, runs.get(def.id), false)),
      );
      continue;
    }
    for (const key of options.tables) {
      if (!p.members.length) break;
      const title = `${reportTables[key]} · ${tag} · ${key === "forces" ? "eixos locais da barra" : "XYZ global e referencial local quando indicado"}`;
      const { headers, rows } = buildResultTable(
        p,
        key,
        view.result,
        "",
        units,
        view,
        true,
      );
      content.push(
        table(
          headers,
          rows.map((row) =>
            row.map((v, i) =>
              typeof v === "number"
                ? formatResultCell(v, key, headers[i], units)
                : v,
            ),
          ),
          title,
        ),
      );
    }
    if (view.kind === "case" && view.result)
      content.push(...areaTables(view.result, options.tables, units, tag));
    if (options.diagramMemberId) {
      const figure = momentFigure(p, view, options.diagramMemberId, units);
      if (figure) content.push(figure);
    }
  }

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [38, 30, 38, 34],
    info: {
      title: `Relatório de análise · ${p.name}`,
      subject: fingerprint,
      creator: `KStruct ${version}`,
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#1a2a39" },
    styles: {
      title: { fontSize: 24, bold: true, margin: [0, 0, 0, 8] },
      section: {
        fontSize: 12,
        bold: true,
        color: "#183b52",
        margin: [0, 10, 0, 4],
      },
      note: { fontSize: 9, margin: [0, 0, 0, 4] },
    },
    footer: (page, total) => ({
      columns: [
        { text: `KStruct · Revisão ${revision} · ${fingerprint.slice(0, 16)}` },
        { text: `Página ${page} de ${total}`, alignment: "right" },
      ],
      margin: [38, 8, 38, 0],
      fontSize: 8,
    }),
    content,
  };
}

export async function renderAnalysisReport(
  snapshot: ReportSnapshot,
): Promise<Uint8Array> {
  const [pdfmake, fonts, definition] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
    buildAnalysisReport(snapshot),
  ]);
  const doc = pdfmake
    .createPdf(definition, undefined, undefined, fonts.default)
    .getStream();
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    doc.on("data", (data: Uint8Array) => chunks.push(data));
    doc.on("error", reject);
    doc.on("end", () => {
      const result = new Uint8Array(chunks.reduce((n, v) => n + v.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(result);
    });
    doc.end();
  });
}
