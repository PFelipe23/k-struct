import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDeck } from "./fixtures/solve-oofem";

const executable = process.env.OOFEM_BIN;

describe.skipIf(!executable)(
  "KS-22 · referências independentes de barras articuladas",
  () => {
    it.each([
      {
        file: "pinned-truss.in",
        steps: 2,
        model: "treliça plana e flexão local do banzo",
      },
      {
        file: "pinned-brace-3d.in",
        steps: 1,
        model: "contraventamento e pórtico espacial no mesmo nó",
      },
    ])("$model", ({ file, steps }) => {
      const deck = readFileSync(
        new URL(`./fixtures/${file}`, import.meta.url),
        "utf8",
      );
      // errorcheck compara reações, esforços e deslocamentos antes de o solver encerrar cada passo.
      const output = runDeck(deck, executable!);
      expect(output.match(/^Output for time /gm)).toHaveLength(steps);
      expect(output).toMatch(/^Finishing analysis on:/m);
    });
  },
);
