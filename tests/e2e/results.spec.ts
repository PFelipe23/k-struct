import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Only the IPC boundary is substituted. This is a captured result from the real
// OOFEM benchmark, not an alternative solver or a fallback in the application.
const output = readFileSync(
  new URL("../fixtures/beam-oofem.txt", import.meta.url),
  "utf8",
);
async function bridge(page: import("@playwright/test").Page, delayed = false) {
  await page.addInitScript(
    ({ output, delayed }) => {
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> };
        finishAnalysis?: () => void;
      };
      w.isTauri = true;
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd) => {
          if (cmd !== "run_oofem")
            throw new Error(`Unexpected test IPC: ${cmd}`);
          if (delayed)
            await new Promise<void>((resolve) => {
              w.finishAnalysis = resolve;
            });
          return { output, log: "Recorded numerical benchmark" };
        },
      };
    },
    { output, delayed },
  );
}

test("resultados calculados são apresentados e invalidados após edição", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue("m");
  await page.getByRole("button", { name: "Reações", exact: true }).click();
  await expect(page.getByRole("cell", { name: "30", exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Esforços", exact: true }).click();
  await expect(page.getByRole("cell", { name: "45", exact: true })).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "Deslocamentos", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "-8,4375", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "test-results/kstruct-analysis.png",
    fullPage: true,
  });
  await page.getByLabel("Visualização dos resultados").selectOption("deformed");
  await expect(page.locator(".elevation polyline")).toHaveCount(1);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page.getByLabel("qZ global").fill("-20");
  await page.getByLabel("qZ global").press("Tab");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );
  await expect(page.getByRole("cell", { name: "45", exact: true })).toHaveCount(
    0,
  );
});

test("resposta antiga é descartada quando o modelo muda durante a execução", async ({
  page,
}) => {
  await bridge(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("em execução");
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page.getByLabel("qZ global").fill("-20");
  await page.getByLabel("qZ global").press("Tab");
  await page.evaluate(() =>
    (window as unknown as { finishAnalysis: () => void }).finishAnalysis(),
  );
  await expect(page.getByRole("status")).toContainText(
    "mudou durante a análise",
  );
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );
});
