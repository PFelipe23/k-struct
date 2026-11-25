import { expect, type Page } from "@playwright/test";
import type { Project } from "../../src/domain/model";
import { exportOofem } from "../../src/solver/oofem";
import { runDeck } from "./solve-oofem";

export async function analyzeInBrowser(
  page: Page,
  project: Project,
  executable: string,
) {
  const { deck } = exportOofem(project, "EL");
  const output = runDeck(deck, executable);
  await page.evaluate(
    ({ deck, output }) => {
      let callback = 0;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback: () => ++callback,
          invoke: async (
            cmd: string,
            args: {
              deck: string;
              runContext: Record<string, string>;
              response: { onmessage: (payload: unknown) => void };
            },
          ) => {
            if (cmd !== "start_oofem" || args.deck !== deck)
              throw new Error("Entrada OOFEM divergente.");
            args.response.onmessage({
              output,
              log: {
                summary: {
                  ...args.runContext,
                  status: "completed",
                  message: "OOFEM concluído.",
                },
                historyError: null,
              },
            });
          },
        },
      });
    },
    { deck, output },
  );
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
}
