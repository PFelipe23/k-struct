import { nextName, uid, type Project } from "../domain/model";
import { distributeWind, type WindStrip } from "../domain/wind";
import { tolerance } from "../domain/geometry";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { maximumSignificantDigits: 6 });
function WindPreview({
  project,
  strip,
}: {
  project: Project;
  strip: WindStrip;
}) {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  try {
    const { center, force, momentAtBase, loads, area } = distributeWind(
      nodes,
      project.mode,
      strip,
    );
    return (
      <div aria-label="Prévia da faixa">
        <p>
          Área tributária {fmt(area)} m². Resultante (FX, FY) = (
          {fmt(force.x / 1000)}, {fmt(force.y / 1000)}) kN, pela linha
          horizontal na direção do vento que passa por ({fmt(center.x)},{" "}
          {fmt(center.y)}, {fmt(center.z)}) m.
        </p>
        <p>
          Momento no nó inferior (MX, MY) = ({fmt(momentAtBase.x / 1000)},{" "}
          {fmt(momentAtBase.y / 1000)}) kN·m.
        </p>
        <ul>
          {loads.map((l) => (
            <li key={l.nodeId}>
              {nodes.get(l.nodeId)!.name} [{l.nodeId}] · (FX, FY) = (
              {fmt(l.fx / 1000)}, {fmt(l.fy / 1000)}) kN
            </li>
          ))}
        </ul>
      </div>
    );
  } catch (error) {
    return <p role="alert">{(error as Error).message}</p>;
  }
}

export default function WindStrips({
  project,
  strips,
  onChange,
}: {
  project: Project;
  strips: WindStrip[];
  onChange: (strips: WindStrip[]) => void;
}) {
  const addStrip = () => {
    const topFor = (a: Project["nodes"][number]) =>
      project.nodes.find(
        (b) =>
          b.z - a.z >= tolerance &&
          Math.hypot(b.x - a.x, b.y - a.y) <= tolerance,
      );
    const base = project.nodes.find((n) => topFor(n)) ?? project.nodes[0];
    const top = base && topFor(base);
    onChange([
      ...strips,
      {
        id: uid(),
        name: nextName("Faixa ", strips),
        bottomId: base?.id ?? "",
        topId: top?.id ?? "",
        width: 4,
        from: 0,
        to: 1,
        angle: 0,
        pressure: 800,
        coefficient: 1,
      },
    ]);
  };
  return (
    <fieldset className="case-factors">
      <legend>Vento estático por faixa</legend>
      <button
        type="button"
        disabled={project.nodes.length < 2 || strips.length >= 500}
        onClick={addStrip}
      >
        Adicionar faixa de vento
      </button>
      {strips.length > 0 && (
        <p>
          A faixa é centrada na vertical dos dois nós e perpendicular à direção
          informada. Use pressão de referência positiva e coeficiente com sinal
          (negativo para sucção). Para pressão líquida, use o módulo e
          coeficiente +1 ou −1.
        </p>
      )}
      {strips.map((strip) => {
        function update(values: Partial<WindStrip>) {
          onChange(
            strips.map((w) => (w.id === strip.id ? { ...w, ...values } : w)),
          );
        }
        function numberField(
          key: "width" | "from" | "to" | "angle" | "pressure" | "coefficient",
          label: string,
          factor = 1,
        ) {
          const value = strip[key] * factor;
          return (
            <label>
              {label}
              <input
                type="number"
                step="any"
                required
                value={
                  Number.isFinite(value) ? Number(value.toPrecision(15)) : ""
                }
                onChange={(e) =>
                  update({ [key]: e.target.valueAsNumber / factor })
                }
              />
            </label>
          );
        }
        return (
          <fieldset key={strip.id}>
            <legend>{strip.name || "Faixa de vento"}</legend>
            <label>
              Nome da faixa
              <input
                required
                maxLength={120}
                value={strip.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            {(["bottomId", "topId"] as const).map((key) => (
              <label key={key}>
                {key === "bottomId" ? "Nó inferior" : "Nó superior"}
                <select
                  value={strip[key]}
                  required
                  onChange={(e) => update({ [key]: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {project.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} [{n.id}]
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {numberField("width", "Largura tributária (m)")}
            {numberField("from", "Início da faixa (% da altura)", 100)}
            {numberField("to", "Fim da faixa (% da altura)", 100)}
            {project.mode === "spatial" ? (
              numberField("angle", "Azimute de +X para +Y (°, de −360 a 360)")
            ) : (
              <label>
                Sentido global
                <select
                  value={Math.abs(strip.angle % 360)}
                  onChange={(e) => update({ angle: Number(e.target.value) })}
                >
                  <option value={0}>+X</option>
                  <option value={180}>−X</option>
                </select>
              </label>
            )}
            {numberField("pressure", "Pressão de referência (kN/m²)", 0.001)}
            {numberField("coefficient", "Coeficiente de pressão")}
            <WindPreview project={project} strip={strip} />
            <button
              type="button"
              onClick={() => onChange(strips.filter((w) => w.id !== strip.id))}
            >
              Excluir faixa
            </button>
          </fieldset>
        );
      })}
      {strips.length > 0 && (
        <p>
          Aplicar definições substitui as parcelas das faixas editadas neste
          padrão e mantém as cargas independentes. Cancelar descarta a prévia.
        </p>
      )}
    </fieldset>
  );
}
