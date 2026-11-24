import { useEffect, useRef, useState } from "react";
import { uid, type Project, type SelectedObject } from "../domain/model";
import {
  allObjects,
  combineSelection,
  filterObjects,
  type SelectionFilter,
  type SelectionMode,
} from "../domain/selection";

type Props = {
  project: Project;
  selection: SelectedObject[];
  onSelect: (objects: SelectedObject[]) => void;
  edit: (fn: (draft: Project) => void) => string | null;
  onClose: () => void;
};

export default function SelectionDialog({
  project,
  selection,
  onSelect,
  edit,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState(allObjects);
  const [mode, setMode] = useState<SelectionMode>("replace");
  const [groupId, setGroupId] = useState(project.selectionGroups[0]?.id ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const group = project.selectionGroups.find((g) => g.id === groupId);
  const matches = filterObjects(project, filter);
  const combined = combineSelection(selection, matches, mode);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  function changeFilter(key: keyof SelectionFilter, value: string) {
    setFilter((old) => ({ ...old, [key]: value }));
  }
  function saveGroup(rename: boolean) {
    const label = name.trim();
    if (!label) {
      setError("Informe um nome para o grupo.");
      return;
    }
    const id = rename ? group!.id : uid();
    const problem = edit((draft) => {
      if (rename) draft.selectionGroups.find((g) => g.id === id)!.name = label;
      else
        draft.selectionGroups.push({
          id,
          name: label,
          objects: selection.map((o) => ({ ...o })),
        });
    });
    setError(problem ?? "");
    if (!problem) {
      setGroupId(id);
      setName("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal selection-dialog"
      aria-labelledby="selection-title"
      onCancel={onClose}
    >
      <h2 id="selection-title">Seleção e grupos</h2>
      <p>
        Seleção atual · {selection.length}{" "}
        {selection.length === 1 ? "objeto" : "objetos"}
      </p>
      <fieldset>
        <legend>Selecionar por critérios</legend>
        <div className="selection-fields">
          <label>
            Tipo de objeto
            <select
              value={filter.kind}
              onChange={(e) => changeFilter("kind", e.target.value)}
            >
              <option value="">Todos</option>
              <option value="node">Nós</option>
              <option value="member">Barras</option>
              <option value="slab">Lajes</option>
            </select>
          </label>
          <label>
            Pavimento
            <select
              value={filter.levelId}
              onChange={(e) => changeFilter("levelId", e.target.value)}
            >
              <option value="">Todos</option>
              {[...project.guides.z]
                .sort((a, b) => a.position - b.position)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {g.position} m
                  </option>
                ))}
            </select>
          </label>
          <label>
            Material
            <select
              value={filter.materialId}
              onChange={(e) => changeFilter("materialId", e.target.value)}
            >
              <option value="">Todos</option>
              {project.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seção
            <select
              value={filter.sectionId}
              onChange={(e) => changeFilter("sectionId", e.target.value)}
            >
              <option value="">Todas</option>
              {project.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          O filtro de pavimento inclui barras com as duas extremidades na cota
          escolhida. Barras entre pisos aparecem em “Todos”. O material da barra
          vem da seção.
        </p>
        <label>
          Combinar com a seleção
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SelectionMode)}
          >
            <option value="replace">Substituir</option>
            <option value="add">Adicionar</option>
            <option value="subtract">Remover coincidências</option>
            <option value="intersect">Manter coincidências</option>
          </select>
        </label>
        <p aria-live="polite">
          {matches.length}{" "}
          {matches.length === 1 ? "objeto encontrado" : "objetos encontrados"} ·{" "}
          {combined.length} na seleção após aplicar
        </p>
        <button onClick={() => onSelect(combined)}>Aplicar critérios</button>
      </fieldset>
      <fieldset>
        <legend>Grupos do projeto</legend>
        <label>
          Grupo salvo
          <select
            value={group?.id ?? ""}
            onChange={(e) => {
              setGroupId(e.target.value);
              setName("");
              setError("");
            }}
          >
            <option value="">Escolha um grupo</option>
            {project.selectionGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.objects.length})
              </option>
            ))}
          </select>
        </label>
        <div className="selection-actions">
          <button
            disabled={!group}
            onClick={() => {
              onSelect(group!.objects.slice());
              onClose();
            }}
          >
            Recuperar grupo
          </button>
          <button
            disabled={!group}
            onClick={() => {
              const problem = edit((draft) => {
                draft.selectionGroups = draft.selectionGroups.filter(
                  (g) => g.id !== group!.id,
                );
              });
              setError(problem ?? "");
              if (!problem) {
                setGroupId("");
                setName("");
              }
            }}
          >
            Excluir grupo
          </button>
        </div>
        <label>
          Nome do grupo
          <input
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
          />
        </label>
        <div className="selection-actions">
          <button disabled={!selection.length} onClick={() => saveGroup(false)}>
            Salvar seleção como grupo
          </button>
          <button disabled={!group} onClick={() => saveGroup(true)}>
            Renomear grupo
          </button>
        </div>
        {error && (
          <p className="launch-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <div className="modal-actions">
        <button onClick={onClose}>Fechar</button>
      </div>
    </dialog>
  );
}
