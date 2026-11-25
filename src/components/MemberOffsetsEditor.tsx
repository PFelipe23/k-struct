import { useState } from "react";
import { coordinates, type Point3 } from "../domain/geometry";
import {
  centeredOffsets,
  memberAxis,
  offsetError,
  type MemberOffsets,
} from "../domain/memberOffsets";
import type { Member, Project } from "../domain/model";
import { formatQuantity, formatUnitInput, parseUnitInput } from "../units";
import { useUnits } from "./Units";

type Props = {
  member: Member;
  start: Point3;
  end: Point3;
  mode: Project["mode"];
  onApply: (offsets: MemberOffsets) => void;
};
type Field = keyof Point3 | "rigidLength";
const ends = ["i", "j"] as const;

function Fields({ member, start, end, mode, onApply }: Props) {
  const { units } = useUnits();
  const saved = member.offsets ?? centeredOffsets;
  const axes = mode === "spatial" ? coordinates : (["x", "z"] as const);
  const fields: Field[] = [...axes, "rigidLength"];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const candidate = structuredClone(saved);
  for (const side of ends)
    for (const field of fields) {
      const previous =
        field === "rigidLength"
          ? saved[side].rigidLength
          : saved[side].eccentricity[field];
      const input = draft[`${side}-${field}`];
      const value =
        input === undefined
          ? previous
          : (parseUnitInput(input, "length", units, previous) ?? NaN);
      if (field === "rigidLength") candidate[side].rigidLength = value;
      else candidate[side].eccentricity[field] = value;
    }
  const problem = offsetError(
    { ...member, offsets: candidate },
    start,
    end,
    mode,
  );
  const line = memberAxis({ offsets: candidate }, start, end);
  return (
    <form
      className="support-frame"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem) onApply(candidate);
      }}
    >
      <p className="help">
        Em cada ponta, informe o vetor global do nó até o eixo de inserção. O
        comprimento rígido é medido nesse eixo em direção ao interior da barra.
      </p>
      {ends.map((side) => (
        <fieldset key={side} className="offset-end">
          <legend>Ponta {side}</legend>
          {fields.map((field) => {
            const key = `${side}-${field}`;
            const name =
              field === "rigidLength"
                ? "Trecho rígido"
                : `Excentricidade ${field.toUpperCase()}`;
            const value =
              field === "rigidLength"
                ? saved[side].rigidLength
                : saved[side].eccentricity[field];
            return (
              <label key={key} className="number-field">
                <span>{name}</span>
                <div>
                  <input
                    aria-label={`${name} em ${side}`}
                    inputMode="decimal"
                    value={
                      draft[key] ?? formatUnitInput(value, "length", units)
                    }
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                  />
                  <small>{units.length}</small>
                </div>
              </label>
            );
          })}
        </fieldset>
      ))}
      {problem ? (
        <p className="support-frame-error" role="alert">
          {problem}
        </p>
      ) : (
        <p className="help">
          Eixo de inserção: {formatQuantity(line.span, "length", units)}{" "}
          {units.length}. Trecho deformável:{" "}
          {formatQuantity(line.clear, "length", units)} {units.length}.
        </p>
      )}
      {member.offsets && (
        <p className="help">
          A linha tracejada une os nós de lançamento. Os braços realçados
          terminam nas faces do trecho deformável.
        </p>
      )}
      <button type="submit" disabled={!!problem || !Object.keys(draft).length}>
        Aplicar excentricidades e trechos rígidos
      </button>
    </form>
  );
}

export default function MemberOffsetsEditor(props: Props) {
  const { units } = useUnits();
  return (
    <details className="member-offsets">
      <summary>Excentricidades e trechos rígidos</summary>
      <Fields
        key={JSON.stringify([
          props.member.id,
          props.member.offsets,
          units.length,
        ])}
        {...props}
      />
    </details>
  );
}
