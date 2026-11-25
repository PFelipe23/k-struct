import SectionPreview from "./SectionPreview";
import { dimensions, geometryErrors, shapeNames } from "../domain/sections";
import MaterialProperties from "./MaterialProperties";
import { useEffect, useRef, useState } from "react";
import {
  Box,
  CircleDot,
  MoveRight,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import {
  beamAxes,
  coordinates,
  distance,
  localComponents,
  tolerance,
} from "../domain/geometry";
import { reverseMember } from "../domain/editing";
import {
  free,
  nodalLoad,
  slabDivisionLimit,
  uniformLoad,
  type NodalLoad,
  type UniformLoad,
  type Project,
  type SelectedObject,
  type Slab,
} from "../domain/model";
import { parseNumberInput } from "./numberInput";
import { formatResult } from "./resultFormatting";
import SupportFrameEditor from "./SupportFrameEditor";
import BatchAssignPanel from "./BatchAssignPanel";

export function NumberField({
  label,
  value,
  unit,
  onChange,
  min,
  max,
  integer = false,
  validate,
}: {
  label: string;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  validate?: (value: number) => string | undefined;
}) {
  const [draft, setDraft] = useState(String(value)),
    [invalid, setInvalid] = useState(false);
  const [detail, setDetail] = useState<string>();
  const cancelling = useRef(false);
  useEffect(() => {
    setDraft(String(Number(value.toPrecision(10))));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    if (cancelling.current) {
      cancelling.current = false;
      return;
    }
    const n = parseNumberInput(draft);
    const error = validate?.(n);
    setDetail(error);
    if (
      error ||
      !Number.isFinite(n) ||
      (integer && !Number.isInteger(n)) ||
      (min !== undefined && n < min) ||
      (max !== undefined && n > max)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(n);
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          aria-invalid={invalid}
          inputMode={integer ? "numeric" : "decimal"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelling.current = true;
              setDraft(String(value));
              setInvalid(false);
              e.currentTarget.blur();
            }
          }}
        />
        {unit && <small>{unit}</small>}
      </div>
      {invalid && (
        <em>
          {detail ??
            `${integer ? "Informe um número inteiro" : "Informe um valor válido"}${min !== undefined ? ` (mín. ${min})` : ""}.`}
        </em>
      )}
    </label>
  );
}

const nodalComponents = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const uniformComponents = ["qx", "qy", "qz"] as const;
type Pattern = Project["loadPatterns"][number];

function sumNodal(pattern: Pattern, id: string) {
  const values = nodalLoad(id);
  for (const load of pattern.nodal)
    if (load.nodeId === id)
      for (const key of nodalComponents) values[key] += load[key];
  return values;
}

function sumUniform(pattern: Pattern, id: string) {
  const values = uniformLoad(id);
  for (const load of pattern.uniform)
    if (load.memberId === id)
      for (const key of uniformComponents) values[key] += load[key];
  return values;
}

function SlabFields({
  project,
  slab,
  pattern,
  edit,
  onMaterials,
}: {
  project: Project;
  slab: Slab;
  pattern: Pattern;
  edit: (fn: (p: Project) => void) => void;
  onMaterials: () => void;
}) {
  const material = project.materials.find(({ id }) => id === slab.materialId)!;
  const updateSlab = (changes: Partial<Slab>) =>
    edit((draft) => {
      Object.assign(draft.slabs.find(({ id }) => id === slab.id)!, changes);
    });
  const pressure =
    pattern.pressure.find(({ slabId }) => slabId === slab.id)?.pz ?? 0;
  return (
    <>
      <label className="stack-field">
        Nome da laje
        <input
          value={slab.name}
          maxLength={120}
          onChange={(e) => {
            if (e.target.value.trim()) updateSlab({ name: e.target.value });
          }}
        />
      </label>
      <label className="stack-field">
        Pavimento da laje
        <select
          value={slab.levelId}
          onChange={(e) => updateSlab({ levelId: e.target.value })}
        >
          {project.guides.z.map((level) => (
            <option key={level.id} value={level.id}>
              {level.name} · {level.position} m
            </option>
          ))}
        </select>
      </label>
      <h4>Geometria da laje</h4>
      {(
        [
          ["x", "X inicial"],
          ["y", "Y inicial"],
          ["lengthX", "Lado X"],
          ["lengthY", "Lado Y"],
        ] as const
      ).map(([key, label]) => (
        <NumberField
          key={key}
          label={label}
          value={slab[key]}
          unit="m"
          min={key === "lengthX" || key === "lengthY" ? tolerance : undefined}
          onChange={(value) => updateSlab({ [key]: value })}
        />
      ))}
      <NumberField
        label="Espessura"
        unit="cm"
        min={0.0001}
        value={slab.thickness * 100}
        onChange={(value) => updateSlab({ thickness: value / 100 })}
      />
      <h4>Material elástico isotrópico</h4>
      <label className="stack-field">
        Material da laje
        <select
          value={material.id}
          onChange={(e) => updateSlab({ materialId: e.target.value })}
        >
          {project.materials.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <MaterialProperties material={material} />
      <button onClick={onMaterials}>Abrir material na biblioteca</button>
      <h4>Apoios de borda</h4>
      <p className="help">
        Marque as bordas com apoio simples. Bordas desmarcadas ficam livres. Use
        pelo menos duas bordas apoiadas.
      </p>
      <div className="restraints">
        {(
          [
            ["xMin", "X mín."],
            ["xMax", "X máx."],
            ["yMin", "Y mín."],
            ["yMax", "Y máx."],
          ] as const
        ).map(([edge, label]) => (
          <label key={edge}>
            <input
              type="checkbox"
              checked={slab.supports[edge]}
              aria-label={`Apoio simples na borda ${label}`}
              onChange={(e) =>
                updateSlab({
                  supports: { ...slab.supports, [edge]: e.target.checked },
                })
              }
            />
            Borda {label}
          </label>
        ))}
      </div>
      <h4>Malha de análise</h4>
      <label className="stack-field">
        Elemento de placa
        <select
          value={slab.formulation}
          onChange={(e) =>
            updateSlab({
              formulation: e.target.value === "dkt" ? "dkt" : "qdkt",
            })
          }
        >
          <option value="qdkt">Quadrilateral QDKT</option>
          <option value="dkt">Triangular DKT</option>
        </select>
      </label>
      {(
        [
          ["divisionsX", "Subdivisões em X"],
          ["divisionsY", "Subdivisões em Y"],
        ] as const
      ).map(([key, label]) => (
        <NumberField
          key={key}
          label={label}
          value={slab[key]}
          min={2}
          max={slabDivisionLimit}
          integer
          onChange={(value) => updateSlab({ [key]: value })}
        />
      ))}
      <p className="help">
        {slab.formulation === "qdkt"
          ? `${slab.divisionsX * slab.divisionsY} quadriláteros QDKT · apoio simples nas quatro bordas`
          : `${2 * slab.divisionsX * slab.divisionsY} triângulos DKT`}
      </p>
      <h4>
        Pressão uniforme <span>{pattern.name}</span>
      </h4>
      <NumberField
        label="Pressão pZ"
        unit="kN/m²"
        value={pressure / 1000}
        onChange={(value) =>
          edit((draft) => {
            draft.loadPatterns.find(({ id }) => id === pattern.id)!.pressure =
              value === 0 ? [] : [{ slabId: slab.id, pz: value * 1000 }];
          })
        }
      />
      <p className="help">
        Use pZ negativo para pressão descendente. Inclua o peso próprio na
        pressão quando aplicável.
      </p>
    </>
  );
}

export default function Inspector({
  project: p,
  selection,
  patternId,
  edit,
  onMaterials,
  onSections,
}: {
  project: Project;
  selection: SelectedObject[];
  patternId: string;
  edit: (fn: (p: Project) => void) => string | null | void;
  onMaterials: () => void;
  onSections: (id: string) => void;
}) {
  const single = selection.length === 1 ? selection[0] : null;
  const spatial = p.mode === "spatial";
  const dofs = spatial
    ? (["ux", "uy", "uz", "rx", "ry", "rz"] as const)
    : (["ux", "uz", "ry"] as const);
  const axes = spatial ? coordinates : (["x", "z"] as const);
  const node =
    single?.kind === "node"
      ? p.nodes.find((n) => n.id === single.id)
      : undefined;
  const member =
    single?.kind === "member"
      ? p.members.find((m) => m.id === single.id)
      : undefined;
  const slab =
    single?.kind === "slab"
      ? p.slabs.find(({ id }) => id === single.id)
      : undefined;
  const section = p.sections.find(
    (s) => s.id === (member?.sectionId ?? p.sections[0].id),
  )!;
  const material = p.materials.find((m) => m.id === section.materialId)!;
  const pattern = p.loadPatterns.find((l) => l.id === patternId)!;
  const nl = sumNodal(pattern, node?.id ?? "");
  const ul = sumUniform(pattern, member?.id ?? "");
  const start = member && p.nodes.find((n) => n.id === member.start)!;
  const end = member && p.nodes.find((n) => n.id === member.end)!;
  const span = start && end ? distance(start, end) : 0;
  const localLoad =
    member && start && end && span >= tolerance
      ? localComponents(
          { x: ul.qx, y: ul.qy, z: ul.qz },
          beamAxes(start, end, member.roll, p.mode),
        )
      : undefined;
  const nodeLoad = (key: Exclude<keyof NodalLoad, "nodeId">, value: number) =>
    edit((p) => {
      const pat = p.loadPatterns.find((l) => l.id === patternId)!;
      const next = sumNodal(pat, node!.id);
      if (next[key] / 1000 === value) return;
      next[key] = value * 1000;
      pat.nodal = pat.nodal.filter((l) => l.nodeId !== node!.id);
      if (nodalComponents.some((k) => next[k])) pat.nodal.push(next);
    });
  const setUniformLoad = (
    key: Exclude<keyof UniformLoad, "memberId">,
    value: number,
  ) =>
    edit((p) => {
      const pat = p.loadPatterns.find((l) => l.id === patternId)!;
      const next = sumUniform(pat, member!.id);
      if (next[key] / 1000 === value) return;
      next[key] = value * 1000;
      pat.uniform = pat.uniform.filter((l) => l.memberId !== member!.id);
      if (uniformComponents.some((k) => next[k])) pat.uniform.push(next);
    });
  const selectedNodes = new Set(
    selection.filter((s) => s.kind === "node").map((s) => s.id),
  );
  const applyRestraints = (fixed: boolean) =>
    edit((p) => {
      for (const n of p.nodes) {
        if (!selectedNodes.has(n.id)) continue;
        n.restraints = free();
        for (const k of dofs) n.restraints[k] = fixed;
      }
    });
  const supportPresets = (
    <div className="support-presets">
      <button onClick={() => applyRestraints(true)}>
        {node ? "Engastar nó" : "Engastar nós"}
      </button>
      <button onClick={() => applyRestraints(false)}>Liberar apoios</button>
    </div>
  );
  return (
    <aside className="inspector">
      <div className="panel-title">
        <SlidersHorizontal size={15} />
        Propriedades
      </div>
      <div className="inspector-scroll" key={single?.id ?? "default"}>
        <div className="object-heading">
          <div className="object-icon">
            {node ? (
              <CircleDot />
            ) : member ? (
              <MoveRight />
            ) : slab ? (
              <Square />
            ) : (
              <Box />
            )}
          </div>
          <div>
            <small>
              {node
                ? "NÓ ESTRUTURAL"
                : member
                  ? "BARRA ESTRUTURAL"
                  : slab
                    ? "LAJE RETANGULAR"
                    : "MODELO"}
            </small>
            <h3>
              {node?.name ??
                member?.name ??
                slab?.name ??
                (selection.length > 1
                  ? "Seleção múltipla"
                  : "Definições iniciais")}
            </h3>
          </div>
        </div>
        {selection.length > 1 && (
          <>
            <p className="help">
              {selectedNodes.size} nós ·{" "}
              {selection.filter(({ kind }) => kind === "member").length} barras
              {selection.some(({ kind }) => kind === "slab") && " · 1 laje"}
            </p>
            {selectedNodes.size > 0 && supportPresets}
            <BatchAssignPanel
              project={p}
              selection={selection}
              patternId={patternId}
              edit={edit}
            />
          </>
        )}
        {!selection.length && (
          <p className="help">
            Selecione um objeto em qualquer vista para editar suas propriedades.
          </p>
        )}
        {node && (
          <>
            <h4>Coordenadas globais</h4>
            {axes.map((k) => (
              <NumberField
                key={k}
                label={k.toUpperCase()}
                value={node[k]}
                unit="m"
                onChange={(v) =>
                  edit((p) => {
                    p.nodes.find((n) => n.id === node.id)![k] = v;
                  })
                }
              />
            ))}
            {!spatial && (
              <div className="property-line">
                <span>Y</span>
                <b>0,00 m</b>
              </div>
            )}
            <h4>Apoios e restrições</h4>
            <SupportFrameEditor
              mode={p.mode}
              frame={node.supportFrame}
              onChange={(frame) =>
                edit((draft) => {
                  const target = draft.nodes.find(({ id }) => id === node.id)!;
                  if (frame) target.supportFrame = frame;
                  else delete target.supportFrame;
                })
              }
            />
            <p className="help">Marque os graus de liberdade impedidos.</p>
            <div className="restraints">
              {dofs.map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    aria-label={`Restringir ${k}${node.supportFrame ? " local" : ""}`}
                    checked={node.restraints[k]}
                    onChange={(e) =>
                      edit((p) => {
                        p.nodes.find((n) => n.id === node.id)!.restraints[k] =
                          e.target.checked;
                      })
                    }
                  />
                  <span>
                    {`${k[0] === "r" ? "Rotação" : "Translação"} ${k[1].toUpperCase()}`}
                    {node.supportFrame && " local"}
                    {node.supportFrame?.kind === "planar" &&
                      (k === "ux"
                        ? " · tangente"
                        : k === "uz"
                          ? " · normal"
                          : "")}
                  </span>
                </label>
              ))}
            </div>
            {supportPresets}
            <h4>
              Carga nodal <span>{pattern.name}</span>
            </h4>
            {(spatial ? nodalComponents : (["fx", "fz", "my"] as const)).map(
              (k) => (
                <NumberField
                  key={`${patternId}-${k}`}
                  label={`${k[0] === "f" ? "Força" : "Momento"} ${k[1].toUpperCase()}`}
                  value={nl[k] / 1000}
                  unit={k[0] === "f" ? "kN" : "kN·m"}
                  onChange={(v) => nodeLoad(k, v)}
                />
              ),
            )}
            <p className="help">
              Z positivo para cima. Momentos globais pela regra da mão direita.
            </p>
          </>
        )}
        {member && (
          <>
            <label className="stack-field">
              Nome da barra
              <input
                key={member.name}
                defaultValue={member.name}
                maxLength={120}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (!name || name === member.name) {
                    e.currentTarget.value = member.name;
                    return;
                  }
                  edit((draft) => {
                    draft.members.find((m) => m.id === member.id)!.name = name;
                  });
                }}
              />
            </label>
            <h4>Conectividade</h4>
            <div className="property-line">
              <span>Sentido i → j</span>
              <b>
                {start?.name} → {end?.name}
              </b>
            </div>
            <div className="property-line">
              <span>Comprimento</span>
              <b>{span.toFixed(3)} m</b>
            </div>
            <button
              onClick={() => edit((draft) => reverseMember(draft, member.id))}
            >
              Inverter i/j
            </button>
            <p className="help">
              A inversão conserva a orientação física da seção e as cargas
              globais.
            </p>
            <label className="stack-field">
              Seção
              <select
                aria-label="Seção da barra"
                value={member.sectionId}
                onChange={(e) =>
                  edit((p) => {
                    p.members.find((m) => m.id === member.id)!.sectionId =
                      e.target.value;
                  })
                }
              >
                {p.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {spatial ? (
              <NumberField
                label="Rotação em torno de x local"
                value={member.roll}
                unit="°"
                min={-360}
                max={360}
                onChange={(v) =>
                  edit((p) => {
                    p.members.find((m) => m.id === member.id)!.roll = v;
                  })
                }
              />
            ) : (
              <div className="property-line">
                <span>Rotação da seção em XZ</span>
                <b>0°</b>
              </div>
            )}
            <h4>
              Carga distribuída <span>{pattern.name}</span>
            </h4>
            {axes.map((k) => (
              <NumberField
                key={`${patternId}-${k}`}
                label={`q${k.toUpperCase()} global`}
                unit="kN/m"
                value={ul[`q${k}`] / 1000}
                onChange={(v) => setUniformLoad(`q${k}`, v)}
              />
            ))}
            {localLoad && (
              <dl
                className="material-values"
                aria-label="Projeção local da carga distribuída"
              >
                {axes.map((key) => (
                  <div key={key}>
                    <dt>q{key} local</dt>
                    <dd>
                      {formatResult(
                        Math.abs(localLoad[key]) < 1e-8
                          ? 0
                          : localLoad[key] / 1000,
                      )}{" "}
                      kN/m
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="help">
              Carga uniforme por metro de barra. Use qZ negativo para cargas
              verticais descendentes.
            </p>
          </>
        )}
        {slab && (
          <SlabFields
            project={p}
            slab={slab}
            pattern={pattern}
            edit={edit}
            onMaterials={onMaterials}
          />
        )}
        {!slab &&
          !node &&
          selection.length < 2 &&
          (member || !p.slabs.length) && (
            <>
              <h4>
                {shapeNames[section.shape]} · {section.name}
              </h4>
              <p className="help">
                Alterações se aplicam a todas as barras que usam esta seção.
              </p>
              {dimensions(section).map(({ key, label, value }) => (
                <NumberField
                  key={`${section.id}-${key}`}
                  label={label}
                  unit="cm"
                  value={value * 100}
                  validate={(v) =>
                    Object.values(
                      geometryErrors({ ...section, [key]: v / 100 }),
                    )[0]
                  }
                  onChange={(v) =>
                    edit((draft) => {
                      Object.assign(
                        draft.sections.find((s) => s.id === section.id)!,
                        { [key]: v / 100 },
                      );
                    })
                  }
                />
              ))}
              <SectionPreview geometry={section} roll={member?.roll} />
              <button onClick={() => onSections(section.id)}>
                Catálogo de seções
              </button>
              <h4>Material da seção</h4>
              <div className="property-line">
                <span>{section.name}</span>
                <b>{material.name}</b>
              </div>
              <MaterialProperties material={material} />
              <button onClick={onMaterials}>
                Abrir material na biblioteca
              </button>
            </>
          )}
        {!slab && (member || node || !p.slabs.length) && (
          <div className="scope-note">
            <b>Estática linear · {spatial ? "Espacial" : "Plano XZ"}</b>
            <p>
              Barras de Euler–Bernoulli, ligações rígidas e cargas globais. Peso
              próprio deve ser aplicado como carga.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
