import { useEffect, useState } from "react";
import { Box, CircleDot, MoveRight, SlidersHorizontal } from "lucide-react";
import type { Project, Selection } from "../domain/model";

export function NumberField({
  label,
  value,
  unit,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value)),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(Number(value.toPrecision(10))));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const n = Number(draft.trim().replace(",", "."));
    if (
      !draft.trim() ||
      !Number.isFinite(n) ||
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
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
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
          Informe um valor válido{min !== undefined ? ` (mín. ${min})` : ""}.
        </em>
      )}
    </label>
  );
}

export default function Inspector({
  project: p,
  selection,
  patternId,
  edit,
}: {
  project: Project;
  selection: Selection;
  patternId: string;
  edit: (fn: (p: Project) => void) => void;
}) {
  const node =
    selection?.kind === "node"
      ? p.nodes.find((n) => n.id === selection.id)
      : undefined;
  const member =
    selection?.kind === "member"
      ? p.members.find((m) => m.id === selection.id)
      : undefined;
  const section = p.sections.find(
    (s) => s.id === (member?.sectionId ?? p.sections[0].id),
  )!;
  const material = p.materials.find((m) => m.id === section.materialId)!;
  const pattern = p.loadPatterns.find((l) => l.id === patternId)!;
  const nl = pattern.nodal
    .filter((l) => l.nodeId === node?.id)
    .reduce((s, l) => ({ fx: s.fx + l.fx, fz: s.fz + l.fz, my: s.my + l.my }), {
      fx: 0,
      fz: 0,
      my: 0,
    });
  const ul = pattern.uniform
    .filter((l) => l.memberId === member?.id)
    .reduce((s, l) => ({ qx: s.qx + l.qx, qz: s.qz + l.qz }), { qx: 0, qz: 0 });
  const nodeLoad = (key: keyof typeof nl, value: number) =>
    edit((p) => {
      const pat = p.loadPatterns.find((l) => l.id === patternId)!;
      pat.nodal = pat.nodal.filter((l) => l.nodeId !== node!.id);
      pat.nodal.push({ nodeId: node!.id, ...nl, [key]: value * 1000 });
    });
  const uniformLoad = (key: keyof typeof ul, value: number) =>
    edit((p) => {
      const pat = p.loadPatterns.find((l) => l.id === patternId)!;
      pat.uniform = pat.uniform.filter((l) => l.memberId !== member!.id);
      pat.uniform.push({ memberId: member!.id, ...ul, [key]: value * 1000 });
    });
  return (
    <aside className="inspector">
      <div className="panel-title">
        <SlidersHorizontal size={15} />
        Propriedades
      </div>
      <div className="inspector-scroll" key={selection?.id ?? "default"}>
        <div className="object-heading">
          <div className="object-icon">
            {node ? <CircleDot /> : member ? <MoveRight /> : <Box />}
          </div>
          <div>
            <small>
              {node ? "NÓ ESTRUTURAL" : member ? "BARRA ESTRUTURAL" : "MODELO"}
            </small>
            <h3>{node?.name ?? member?.name ?? "Definições iniciais"}</h3>
          </div>
        </div>
        {!node && !member && (
          <p className="help">
            Selecione um nó ou uma barra em qualquer vista para editar suas
            propriedades.
          </p>
        )}
        {node && (
          <>
            <h4>Coordenadas globais</h4>
            <NumberField
              label="X"
              value={node.x}
              unit="m"
              onChange={(v) =>
                edit((p) => {
                  p.nodes.find((n) => n.id === node.id)!.x = v;
                })
              }
            />
            <NumberField
              label="Z"
              value={node.z}
              unit="m"
              onChange={(v) =>
                edit((p) => {
                  p.nodes.find((n) => n.id === node.id)!.z = v;
                })
              }
            />
            <div className="property-line">
              <span>Y · Plano de trabalho</span>
              <b>0,00 m</b>
            </div>
            <h4>Apoios e restrições</h4>
            <p className="help">Marque os graus de liberdade impedidos.</p>
            <div className="restraints">
              {(["ux", "uz", "ry"] as const).map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    aria-label={`Restringir ${k}`}
                    checked={node.restraints[k]}
                    onChange={(e) =>
                      edit((p) => {
                        p.nodes.find((n) => n.id === node.id)!.restraints[k] =
                          e.target.checked;
                      })
                    }
                  />
                  <span>
                    {k === "ry"
                      ? "Rotação Y"
                      : `Translação ${k[1].toUpperCase()}`}
                  </span>
                </label>
              ))}
            </div>
            <h4>
              Carga nodal <span>{pattern.name}</span>
            </h4>
            <NumberField
              label="Força X"
              unit="kN"
              value={nl.fx / 1000}
              onChange={(v) => nodeLoad("fx", v)}
            />
            <NumberField
              label="Força Z"
              unit="kN"
              value={nl.fz / 1000}
              onChange={(v) => nodeLoad("fz", v)}
            />
            <NumberField
              label="Momento Y"
              unit="kN·m"
              value={nl.my / 1000}
              onChange={(v) => nodeLoad("my", v)}
            />
            <p className="help">
              Z positivo para cima. Momento positivo pela regra da mão direita
              em Y.
            </p>
          </>
        )}
        {member && (
          <>
            <h4>Conectividade</h4>
            <div className="property-line">
              <span>Início → fim</span>
              <b>
                {p.nodes.find((n) => n.id === member.start)?.name} →{" "}
                {p.nodes.find((n) => n.id === member.end)?.name}
              </b>
            </div>
            <div className="property-line">
              <span>Comprimento</span>
              <b>
                {(() => {
                  const a = p.nodes.find((n) => n.id === member.start)!,
                    b = p.nodes.find((n) => n.id === member.end)!;
                  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(3);
                })()}{" "}
                m
              </b>
            </div>
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
            <h4>
              Carga distribuída <span>{pattern.name}</span>
            </h4>
            <NumberField
              label="qX global"
              unit="kN/m"
              value={ul.qx / 1000}
              onChange={(v) => uniformLoad("qx", v)}
            />
            <NumberField
              label="qZ global"
              unit="kN/m"
              value={ul.qz / 1000}
              onChange={(v) => uniformLoad("qz", v)}
            />
            <p className="help">
              Carga uniforme por metro de barra. Use qZ negativo para cargas
              verticais descendentes.
            </p>
          </>
        )}
        {!node && (
          <>
            <h4>Seção retangular compartilhada</h4>
            <p className="help">
              Alterações se aplicam a todas as barras que usam esta seção.
            </p>
            <NumberField
              label="Largura b"
              unit="cm"
              value={section.width * 100}
              min={0.1}
              onChange={(v) =>
                edit((p) => {
                  p.sections.find((s) => s.id === section.id)!.width = v / 100;
                })
              }
            />
            <NumberField
              label="Altura h"
              unit="cm"
              value={section.height * 100}
              min={0.1}
              onChange={(v) =>
                edit((p) => {
                  p.sections.find((s) => s.id === section.id)!.height = v / 100;
                })
              }
            />
            <div className="section-preview">
              <div
                style={{
                  width: Math.max(
                    15,
                    Math.min(90, (section.width / section.height) * 70),
                  ),
                  height: 70,
                }}
              />
              <span>
                A = {(section.width * section.height * 1e4).toFixed(1)} cm²
                <br />
                IY ={" "}
                {(((section.width * section.height ** 3) / 12) * 1e8).toFixed(
                  1,
                )}{" "}
                cm⁴
              </span>
            </div>
            <h4>Material compartilhado</h4>
            <NumberField
              label="Módulo E"
              unit="GPa"
              value={material.E / 1e9}
              min={0.001}
              onChange={(v) =>
                edit((p) => {
                  p.materials.find((m) => m.id === material.id)!.E = v * 1e9;
                })
              }
            />
            <NumberField
              label="Poisson ν"
              value={material.nu}
              min={0}
              max={0.49}
              onChange={(v) =>
                edit((p) => {
                  p.materials.find((m) => m.id === material.id)!.nu = v;
                })
              }
            />
          </>
        )}
        <div className="scope-note">
          <span>ETAPA 01</span>
          <b>Estática linear · Plano XZ</b>
          <p>
            Barras de Euler–Bernoulli, ligações rígidas e cargas globais. Peso
            próprio deve ser aplicado como carga.
          </p>
        </div>
      </div>
    </aside>
  );
}
