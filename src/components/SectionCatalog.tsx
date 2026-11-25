import { useEffect, useRef, useState } from "react";
import {
  nextName,
  sectionLimit,
  uid,
  type Project,
  type Section,
} from "../domain/model";
import {
  defaultGeometry,
  dimensions,
  geometryErrors,
  shapeNames,
  type Dimension,
  type SectionShape,
} from "../domain/sections";
import { parseNumberInput } from "./numberInput";
import SectionPreview from "./SectionPreview";

type Edit = (fn: (draft: Project) => void) => string | null;

function SectionForm({
  initial,
  project,
  onSave,
  onCancel,
}: {
  initial: Section;
  project: Project;
  onSave: (section: Section) => string | null;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [materialId, setMaterialId] = useState(initial.materialId);
  const [shape, setShape] = useState<SectionShape>(initial.shape);
  const [draft, setDraft] = useState<Partial<Record<Dimension, string>>>({});
  const [problem, setProblem] = useState("");
  const base = shape === initial.shape ? initial : defaultGeometry[shape];
  const geometry = { ...base };
  // Keep the original SI values for every untouched field, including when renaming.
  for (const { key } of dimensions(base)) {
    const raw = draft[key];
    if (raw !== undefined)
      Object.assign(geometry, { [key]: parseNumberInput(raw) / 100 });
  }
  const errors = geometryErrors(geometry),
    valid = !Object.keys(errors).length;
  return (
    <form
      className="load-definition-fields"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !valid) return;
        setProblem(
          onSave({
            ...geometry,
            id: initial.id,
            name: name.trim(),
            materialId,
          }) ?? "",
        );
      }}
    >
      <label>
        Nome da seção
        <input
          autoFocus
          value={name}
          maxLength={120}
          required
          aria-invalid={!name.trim()}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="material-fields">
        <label>
          Forma da seção
          <select
            value={shape}
            onChange={(e) => {
              setShape(e.target.value as SectionShape);
              setDraft({});
              setProblem("");
            }}
          >
            {(Object.keys(shapeNames) as SectionShape[]).map((key) => (
              <option key={key} value={key}>
                {shapeNames[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Material da seção
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
          >
            {project.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="material-fields">
        {dimensions(base).map(({ key, label, value }) => (
          <div key={key}>
            <label>
              {label} (cm)
              <input
                inputMode="decimal"
                value={
                  draft[key] ?? String(Number((value * 100).toPrecision(12)))
                }
                aria-invalid={!!errors[key]}
                aria-describedby={
                  errors[key] ? `section-error-${key}` : undefined
                }
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
            {errors[key] && (
              <small id={`section-error-${key}`} className="launch-error">
                {errors[key]}
              </small>
            )}
          </div>
        ))}
      </div>
      {geometry.shape === "tube" && valid && (
        <p className="help">
          Diâmetro interno:{" "}
          {Number(
            (
              (geometry.outerDiameter - 2 * geometry.thickness) *
              100
            ).toPrecision(10),
          ).toLocaleString("pt-BR")}{" "}
          cm.
        </p>
      )}
      {shape === "i" && (
        <p className="help">
          Perfil idealizado com mesas iguais e cantos vivos. Para a torção de
          Saint-Venant, use b/tf ≥ 10 e (h − 2tf)/tw ≥ 10.
        </p>
      )}
      {valid && <SectionPreview geometry={geometry} />}
      {problem && (
        <p role="alert" className="launch-error">
          {problem}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancelar edição
        </button>
        <button
          type="submit"
          className="primary"
          disabled={!name.trim() || !valid}
        >
          Salvar seção
        </button>
      </div>
    </form>
  );
}

export default function SectionCatalog({
  project,
  initialId,
  edit,
  onClose,
}: {
  project: Project;
  initialId: string;
  edit: Edit;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [selected, setSelected] = useState(initialId);
  const section =
    project.sections.find((s) => s.id === selected) ?? project.sections[0];
  const [editor, setEditor] = useState<{
    section: Section;
    creating: boolean;
  } | null>(null);
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal material-library"
      aria-labelledby="sections-title"
      onCancel={(e) => {
        e.preventDefault();
        if (editor) setEditor(null);
        else onClose();
      }}
    >
      <h2 id="sections-title">Catálogo de seções</h2>
      {editor ? (
        <SectionForm
          key={editor.section.id}
          initial={editor.section}
          project={project}
          onCancel={() => setEditor(null)}
          onSave={(values) => {
            const problem = edit((p) => {
              if (editor.creating) {
                if (p.sections.length >= sectionLimit)
                  throw new Error(
                    `O projeto comporta até ${sectionLimit} seções.`,
                  );
                p.sections.push(values);
              } else {
                const index = p.sections.findIndex((s) => s.id === values.id);
                if (index < 0)
                  throw new Error("A seção em edição não existe no projeto.");
                p.sections[index] = values;
              }
            });
            if (!problem) {
              setSelected(values.id);
              setEditor(null);
            }
            return problem;
          }}
        />
      ) : (
        <>
          <div className="definition-picker material-picker">
            <label>
              Seção do projeto
              <select
                value={section.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {project.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={project.sections.length >= sectionLimit}
              onClick={() =>
                setEditor({
                  creating: true,
                  section: {
                    ...defaultGeometry.rectangle,
                    id: uid(),
                    name: nextName("Seção S", project.sections),
                    materialId: section.materialId,
                  },
                })
              }
            >
              Nova seção
            </button>
            <button onClick={() => setEditor({ creating: false, section })}>
              Editar seção
            </button>
          </div>
          <p>
            {shapeNames[section.shape]} ·{" "}
            {project.materials.find((m) => m.id === section.materialId)?.name}
          </p>
          <SectionPreview geometry={section} />
          <div className="modal-actions">
            <button onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </dialog>
  );
}
