import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_UNITS,
  QUANTITY_LABELS,
  UNIT_OPTIONS,
  parseUnitPreferences,
  type UnitPreferences,
  type UnitQuantity,
} from "../units";

const storageKey = "kstruct.units";

function readUnits(): UnitPreferences {
  try {
    return parseUnitPreferences(
      JSON.parse(localStorage.getItem(storageKey) ?? "null"),
    );
  } catch {
    return { ...DEFAULT_UNITS };
  }
}

const UnitsContext = createContext<{
  units: UnitPreferences;
  setUnits: (next: UnitPreferences) => void;
}>({ units: DEFAULT_UNITS, setUnits: () => undefined });

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [units, updateUnits] = useState(readUnits);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(units));
    } catch {
      // A preferência continua ativa nesta janela se o armazenamento falhar.
    }
  }, [units]);
  return (
    <UnitsContext.Provider
      value={{
        units,
        setUnits: (next) => updateUnits(parseUnitPreferences(next)),
      }}
    >
      {children}
    </UnitsContext.Provider>
  );
}

export const useUnits = () => useContext(UnitsContext);

export function UnitsDialog({ onClose }: { onClose: () => void }) {
  const { units, setUnits } = useUnits();
  const [draft, setDraft] = useState(units);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal units-dialog"
      aria-labelledby="units-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="units-title">Unidades</h2>
      <p>
        Escolha as unidades dos campos, vistas, tabelas e exportações. A
        preferência fica guardada neste computador.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setUnits(draft);
          onClose();
        }}
      >
        <div className="units-fields">
          {(Object.keys(DEFAULT_UNITS) as UnitQuantity[]).map((quantity) => (
            <label className="stack-field" key={quantity}>
              {QUANTITY_LABELS[quantity]}
              <select
                value={draft[quantity]}
                onChange={(event) =>
                  setDraft(
                    parseUnitPreferences({
                      ...draft,
                      [quantity]: event.target.value,
                    }),
                  )
                }
              >
                {UNIT_OPTIONS[quantity].map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => setDraft({ ...DEFAULT_UNITS })}>
            Restaurar padrão
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Aplicar unidades
          </button>
        </div>
      </form>
    </dialog>
  );
}
