import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { serializeProject, type Project } from "../../src/domain/model";
import { runDeck } from "./solve-oofem";

export async function analyzeInBrowser(
  page: Page,
  project: Project,
  executable: string,
) {
  // Export the independent reference through the same browser engine. Different
  // engines can round the last digit of nodal direction cosines differently.
  const reference = await page.context().browser()!.newPage();
  let expectedDeck: string;
  try {
    await reference.addInitScript(
      (source) => localStorage.setItem("kstruct.draft.v13", source),
      serializeProject(project),
    );
    await reference.goto(page.url());
    await reference
      .getByRole("button", { name: "Análise", exact: true })
      .click();
    const download = reference.waitForEvent("download");
    await reference
      .getByRole("button", { name: "Entrada OOFEM", exact: true })
      .click();
    expectedDeck = await readFile((await (await download).path())!, "utf8");
  } finally {
    await reference.close();
  }
  await page.exposeFunction("solveKStructDeck", (submitted: string) => {
    expect(submitted).toBe(expectedDeck);
    return runDeck(submitted, executable);
  });
  await page.evaluate(() => {
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
          if (cmd !== "start_oofem") throw new Error(cmd);
          const output = await (
            window as unknown as {
              solveKStructDeck: (deck: string) => Promise<string>;
            }
          ).solveKStructDeck(args.deck);
          args.response.onmessage({
            output,
            log: {
              summary: {
                ...args.runContext,
                status: "completed",
                message: "OOFEM concluído.",
              },
            },
            historyError: null,
          });
        },
      },
    });
  });
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
}
