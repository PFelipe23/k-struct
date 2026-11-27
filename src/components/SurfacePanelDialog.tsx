import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  add,
  coordinates,
  origin,
  scale,
  type Point3,
} from "../domain/geometry";
import {
  uid,
  type PanelAction,
  type PanelFactors,
  type PanelEdge,
  type Project,
  type SurfacePanel,
} from "../domain/model";
import {
  panelAngle,
  panelComponents,
  membraneKeys,
  bendingKeys,
} from "../domain/panelStiffness";
import { stiffnessFactorError } from "../domain/memberStiffness";
import { panelEdges, panelGeometry, panelKinds } from "../domain/surfacePanel";
import {
  formatUnitInput,
  parseUnitInput,
  parseUnitNumber,
  type UnitQuantity,
} from "../units";
import {
  SurfacePressureFields,
  readPressureForm,
} from "./SurfacePressureFields";
import { panelPressureVertices } from "../domain/surfacePressure";
import { useUnits } from "./Units";

export function newSurfacePanel(p: Project): SurfacePanel {
  const first = p.surfacePanels?.[0],
    g = first && panelGeometry(first);
  return {
    id: uid(),
    name: first ? "Laje 2" : "Painel 1",
    kind: "shell",
    materialId: first?.materialId ?? p.materials[0].id,
    a: g ? g.corners.B : { ...origin },
    b: g
      ? add(g.corners.B, scale(g.axes[2], g.axes[2].z > 0.5 ? 3 : -3))
      : { ...origin, z: 3 },
    d: g ? g.corners.C : { ...origin, y: 3 },
    thickness: first?.thickness ?? 0.12,
    nu: 8,
    nv: first?.nv ?? 8,
    fixed: first ? [] : ["DA"],
  };
}
type Props = {
  panel: SurfacePanel;
  project: Project;
  patternId: string;
  apply: (panel: SurfacePanel, action: PanelAction) => string | null;
  remove?: () => void;
  close: () => void;
};
export function SurfacePanelDialog({
  panel,
  project,
  patternId,
  apply,
  remove,
  close,
}: Props) {
  const { units } = useUnits(),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const pat = project.loadPatterns.find((p) => p.id === patternId)!;
  const old = pat.panelActions?.find((a) => a.panelId === panel.id);
  const vertices = panelPressureVertices(panelGeometry(panel).corners);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(panel.kind);
  const [factors, setFactors] = useState(() =>
    Object.fromEntries(
      panelComponents("shell").map((k) => [
        k,
        String(panel.stiffness?.[k] ?? 1),
      ]),
    ),
  );
  function factorFields(keys: typeof membraneKeys | typeof bendingKeys) {
    return (
      <div className="panel-columns">
        {keys.map((k) => (
          <label key={k} className="stack-field">
            Fator {k.toUpperCase()}
            <input
              inputMode="decimal"
              required
              value={factors[k]}
              onChange={(e) => setFactors({ ...factors, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
    );
  }
  function field(
    key: string,
    label: string,
    value: number,
    quantity?: UnitQuantity,
  ) {
    return (
      <label className="stack-field" key={key}>
        {label}
        <input
          name={key}
          aria-label={label}
          inputMode="decimal"
          required
          defaultValue={
            quantity ? formatUnitInput(value, quantity, units) : String(value)
          }
        />
      </label>
    );
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget),
      txt = (key: string) => String(data.get(key) ?? "");
    function num(key: string, q?: UnitQuantity, original?: number) {
      const n = q
        ? parseUnitInput(txt(key), q, units, original)
        : parseUnitNumber(txt(key));
      if (n === null)
        throw new Error("Preencha os campos numéricos com valores finitos.");
      return n;
    }
    const point = (k: "a" | "b" | "d"): Point3 => ({
      x: num(k + "x", "length", panel[k].x),
      y: num(k + "y", "length", panel[k].y),
      z: num(k + "z", "length", panel[k].z),
    });
    try {
      const next: SurfacePanel = {
        ...panel,
        name: txt("name").trim(),
        kind,
        materialId: txt("material"),
        a: point("a"),
        b: point("b"),
        d: point("d"),
        thickness: num("h", "section", panel.thickness),
        nu: num("nu"),
        nv: num("nv"),
        fixed: data.getAll("fixed") as PanelEdge[],
      };
      if (!next.name || next.thickness <= 0)
        throw new Error("Informe um nome e uma espessura positiva.");
      if (
        ![next.nu, next.nv].every(
          (n) => Number.isInteger(n) && n >= 1 && n <= 32,
        )
      )
        throw new Error(
          "Adote de 1 a 32 subdivisões inteiras em cada direção.",
        );
      const angle = panelAngle(num("angle"));
      if (angle) next.angleDeg = angle;
      else delete next.angleDeg;
      const modifiers: PanelFactors = {};
      for (const k of panelComponents(kind)) {
        const v = parseUnitNumber(factors[k]);
        const message = stiffnessFactorError(v);
        if (message || v === null)
          throw new Error(k.toUpperCase() + " · " + message);
        if (v !== 1) modifiers[k] = v;
      }
      if (Object.keys(modifiers).length) next.stiffness = modifiers;
      else delete next.stiffness;
      panelGeometry(next);
      const t = old?.traction ?? origin;
      const area = readPressureForm(data, units, vertices);
      const action: PanelAction = {
        panelId: panel.id,
        edge: txt("edge") as PanelEdge,
        pressure: area.uniform,
        ...area.spec,
        traction: {
          x: num("tx", "distributedLoad", t.x),
          y: num("ty", "distributedLoad", t.y),
          z: num("tz", "distributedLoad", t.z),
        },
      };
      const problem = apply(next, action);
      if (problem) setError(problem);
      else close();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <dialog
      ref={ref}
      className="slab-sizing-dialog spatial-panel-dialog"
      aria-label="Painel espacial"
      onCancel={close}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form onSubmit={save}>
        <h2>{remove ? "Editar painel espacial" : "Novo painel espacial"}</h2>
        <div className="panel-columns">
          <label className="stack-field">
            Nome do painel
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={panel.name}
            />
          </label>
          <label className="stack-field">
            Formulação
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SurfacePanel["kind"])}
            >
              {Object.entries(panelKinds).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="stack-field">
            Material
            <select name="material" defaultValue={panel.materialId}>
              {project.materials.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Geometria global ({units.length})</legend>
          <div className="panel-columns">
            {(["a", "b", "d"] as const).flatMap((key) =>
              coordinates.map((k) =>
                field(
                  key + k,
                  key.toUpperCase() + " · " + k.toUpperCase(),
                  panel[key][k],
                  "length",
                ),
              ),
            )}
          </div>
          <p>
            A, B e D definem o paralelogramo. O eixo geométrico 1 segue AB. A
            normal AB × AD aponta para a face +3. A face −3 fica do lado oposto.
          </p>
        </fieldset>
        <div className="panel-columns">
          {field(
            "h",
            `Espessura (${units.section})`,
            panel.thickness,
            "section",
          )}
          {field("nu", "Subdivisões AB", panel.nu)}
          {field("nv", "Subdivisões AD", panel.nv)}
        </div>
        <fieldset>
          <legend>Orientação e rigidez</legend>
          {field(
            "angle",
            "Ângulo dos eixos resistentes (°)",
            panel.angleDeg ?? 0,
          )}
          <p>
            O ângulo parte de AB. Visto da face +3, o giro positivo é
            anti-horário. Os fatores multiplicam a rigidez do material nas
            direções resistentes. O valor 1 conserva a propriedade de
            referência.
          </p>
          {kind !== "plate" && (
            <>
              <b>Membrana</b>
              {factorFields(membraneKeys)}
              <p>
                N11 e N22 controlam a extensão. N12 controla o cisalhamento no
                plano.
              </p>
            </>
          )}
          {kind !== "membrane" && (
            <>
              <b>Flexão</b>
              {factorFields(bendingKeys)}
              <p>
                M11 e M22 controlam a flexão. M12 controla a torção da placa.
              </p>
            </>
          )}
          <p>
            A formulação selecionada define quais fatores são salvos. Espessura
            e peso próprio conservam seus valores físicos.
          </p>
        </fieldset>
        <fieldset>
          <legend>Bordas engastadas</legend>
          <div className="panel-edges">
            {panelEdges.map((edge) => (
              <label key={edge}>
                <input
                  type="checkbox"
                  name="fixed"
                  value={edge}
                  defaultChecked={panel.fixed.includes(edge)}
                />{" "}
                {edge}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Cargas · {pat.name}</legend>
          <p>
            As componentes q1 e q2 seguem os eixos geométricos. O giro dos eixos
            resistentes conserva as cargas aplicadas.
          </p>
          <label className="stack-field">
            Borda carregada
            <select name="edge" defaultValue={old?.edge ?? "BC"}>
              {panelEdges.map((edge) => (
                <option key={edge}>{edge}</option>
              ))}
            </select>
          </label>
          <div className="panel-columns">
            {coordinates.map((k, i) =>
              field(
                "t" + k,
                `q${i + 1} local (${units.distributedLoad})`,
                (old?.traction ?? origin)[k],
                "distributedLoad",
              ),
            )}
          </div>
        </fieldset>
        <SurfacePressureFields
          vertices={vertices}
          spec={old}
          uniform={old?.pressure ?? 0}
        />
        <p>
          Membrana aceita cargas tangentes, placa aceita cargas normais e casca
          aceita ambas.
        </p>
        {error && (
          <p role="alert" className="solver-error">
            {error}
          </p>
        )}
        <footer>
          {remove && (
            <button type="button" onClick={remove}>
              Excluir painel
            </button>
          )}
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Aplicar painel
          </button>
        </footer>
      </form>
    </dialog>
  );
}
