import { useEffect, useRef, useState } from "react";
import {
  assignMaterial,
  duplicateSection,
  materialUsage,
  newMaterial,
  removeMaterial,
  saveMaterial,
} from "../domain/materials";
import type { Material, Project, SelectedObject } from "../domain/model";
import MaterialProperties, { materialFields } from "./MaterialProperties";
import { parseNumberInput } from "./numberInput";
import { formatUnitInput, parseUnitInput, unitLabel } from "../units";
import { useUnits } from "./Units";

type Edit = (change: (draft: Project) => void) => string | null;
type MaterialEdit = { mode: "create" | "edit"; material: Material };

// Existing projects can contain different objects with the same display name.
function objectName(
  item: { id: string; name: string },
  siblings: readonly { id: string; name: string }[],
) {
  return siblings.some(
    (other) => other.id !== item.id && other.name === item.name,
  )
    ? `${item.name} (${item.id})`
    : item.name;
}

function Usage({ project, id }: { project: Project; id: string }) {
  const { sections, slabs } = materialUsage(project, id);
  return (
    <section className="material-usage" aria-label="Uso do material">
      <h3>Uso no projeto</h3>
      <p>
        <strong>
          {sections.length} {sections.length === 1 ? "seção" : "seções"}
        </strong>
        {sections.length > 0 &&
          ` · ${sections.map((s) => objectName(s, project.sections)).join(", ")}`}
      </p>
      {slabs.length > 0 && (
        <p>
          <strong>{slabs.length} laje</strong> ·{" "}
          {slabs.map((s) => s.name).join(", ")}
        </p>
      )}
    </section>
  );
}

function MaterialForm({
  project,
  editor,
  onSave,
  onCancel,
}: {
  project: Project;
  editor: MaterialEdit;
  onSave: (values: Material) => string | null;
  onCancel: () => void;
}) {
  const { units } = useUnits();
  const initial = editor.material;
  const [name, setName] = useState(initial.name);
  const [fields, setFields] = useState(() => ({
    E: formatUnitInput(initial.E, "modulus", units),
    nu: String(initial.nu),
    density: String(initial.density),
    alpha: String(initial.alpha),
  }));
  const [error, setError] = useState("");
  return (
    <form
      className="load-definition-fields"
      onChange={() => setError("")}
      onSubmit={(event) => {
        event.preventDefault();
        const material = { ...initial, name };
        for (const { key, quantity } of materialFields) {
          // Renaming a material must preserve every unchanged SI value exactly.
          material[key] = quantity
            ? (parseUnitInput(fields[key], quantity, units, initial[key]) ??
              NaN)
            : parseNumberInput(fields[key]);
        }
        setError(onSave(material) ?? "");
      }}
    >
      <label>
        Nome do material
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus
        />
      </label>
      <div className="material-fields">
        {materialFields.map(({ key, label, unit, quantity }) => (
          <label key={key}>
            {label}
            {(quantity || unit) &&
              ` (${quantity ? unitLabel(quantity, units) : unit})`}
            <input
              inputMode="decimal"
              value={fields[key]}
              onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {editor.mode === "edit" && <Usage project={project} id={initial.id} />}
      {error && (
        <p role="alert" className="launch-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancelar edição
        </button>
        <button className="primary" type="submit">
          Salvar material
        </button>
      </div>
    </form>
  );
}

export default function MaterialLibrary({
  project,
  selection,
  edit,
  onClose,
}: {
  project: Project;
  selection: SelectedObject[];
  edit: Edit;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const targets = [
    ...project.sections.map((s) => ({
      ...s,
      kind: "section" as const,
      key: `section:${s.id}`,
    })),
    ...project.slabs.map((s) => ({
      ...s,
      kind: "slab" as const,
      key: `slab:${s.id}`,
    })),
  ];
  const [targetKey, setTargetKey] = useState(() => {
    const single = selection.length === 1 ? selection[0] : null;
    if (single?.kind === "slab") return `slab:${single.id}`;
    const member =
      single?.kind === "member" &&
      project.members.find((m) => m.id === single.id);
    return member ? `section:${member.sectionId}` : targets[0].key;
  });
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const [materialId, setMaterialId] = useState(target.materialId);
  const material =
    project.materials.find((m) => m.id === materialId) ?? project.materials[0];
  const assigned = project.materials.find((m) => m.id === target.materialId)!;
  const [editor, setEditor] = useState<MaterialEdit | null>(null);
  const [error, setError] = useState("");
  const begin = (choice: MaterialEdit) => {
    setError("");
    setEditor(choice);
  };
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal material-library"
      aria-labelledby="materials-title"
      onCancel={(event) => {
        event.preventDefault();
        if (editor) setEditor(null);
        else onClose();
      }}
    >
      <h2 id="materials-title">Biblioteca de materiais</h2>
      {editor ? (
        <MaterialForm
          project={project}
          editor={editor}
          onCancel={() => setEditor(null)}
          onSave={(values) => {
            const problem = edit((p) => saveMaterial(p, values, editor.mode));
            if (!problem) {
              setMaterialId(values.id);
              setEditor(null);
            }
            return problem;
          }}
        />
      ) : (
        <>
          <div className="definition-picker material-picker">
            <label>
              Material do projeto
              <select
                aria-label="Material do projeto"
                value={material.id}
                onChange={(e) => {
                  setMaterialId(e.target.value);
                  setError("");
                }}
              >
                {project.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {objectName(m, project.materials)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                begin({ mode: "create", material: newMaterial(project) })
              }
            >
              Novo material
            </button>
            <button
              onClick={() =>
                begin({
                  mode: "create",
                  material: newMaterial(project, material),
                })
              }
            >
              Duplicar material
            </button>
          </div>
          <div className="material-columns">
            <div>
              <MaterialProperties material={material} />
              <Usage project={project} id={material.id} />
              <div className="material-actions">
                <button onClick={() => begin({ mode: "edit", material })}>
                  Editar material
                </button>
                <button
                  onClick={() =>
                    setError(edit((p) => removeMaterial(p, material.id)) ?? "")
                  }
                >
                  Excluir material
                </button>
              </div>
            </div>
            <fieldset className="load-definition-fields">
              <legend>Atribuição</legend>
              <label>
                Seção ou laje de destino
                <select
                  aria-label="Seção ou laje de destino"
                  value={target.key}
                  onChange={(e) => {
                    setTargetKey(e.target.value);
                    setError("");
                  }}
                >
                  {targets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.kind === "section" ? "Seção" : "Laje"} ·{" "}
                      {objectName(
                        t,
                        t.kind === "section" ? project.sections : project.slabs,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Material atual de {target.name}
                <br />
                <strong>{objectName(assigned, project.materials)}</strong>
              </p>
              <button
                disabled={assigned.id === material.id}
                onClick={() =>
                  setError(
                    edit((p) => assignMaterial(p, target, material.id)) ?? "",
                  )
                }
              >
                Atribuir material
              </button>
              {target.kind === "section" && (
                <button
                  onClick={() => {
                    let id = "";
                    const problem = edit((p) => {
                      id = duplicateSection(p, target.id);
                    });
                    if (!problem) setTargetKey(`section:${id}`);
                    setError(problem ?? "");
                  }}
                >
                  Duplicar seção
                </button>
              )}
            </fieldset>
          </div>
          {error && (
            <p role="alert" className="launch-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </dialog>
  );
}
