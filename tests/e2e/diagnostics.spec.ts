import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { beamExample, serializeProject } from "../../src/domain/model";

const output = readFileSync(
  new URL("../fixtures/beam-oofem.txt", import.meta.url),
  "utf8",
);

test("navega de um diagnóstico para o nó isolado identificado", async ({
  page,
}) => {
  const project = beamExample();
  project.nodes.push({
    ...project.nodes[0],
    id: "isolated",
    name: "N-isolado",
    x: 8,
    z: 2,
  });
  await page.addInitScript((solverOutput) => {
    type NativeArgs = {
      runContext: Record<string, string>;
      response: { onmessage: (payload: unknown) => void };
    };
    const windowWithTauri = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: {
        transformCallback: () => number;
        invoke: (cmd: string, args: NativeArgs) => Promise<void>;
      };
    };
    windowWithTauri.isTauri = true;
    windowWithTauri.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd !== "start_oofem") throw new Error(`Unexpected IPC: ${cmd}`);
        args.response.onmessage({
          output: solverOutput,
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
    };
  }, output);
  await page.addInitScript((source) => {
    localStorage.setItem("kstruct.draft.v11", source);
  }, serializeProject(project));
  await page.goto("/");
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page.getByRole("button", { name: "Analisar" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Análise não iniciada. 2 problema",
  );
  const inspect = page
    .getByRole("button", {
      name: "Inspecionar 1 objeto(s)",
    })
    .first();
  await expect(inspect).toBeVisible();
  await inspect.click();
  await expect(page.getByRole("status")).toContainText(
    "Inspecione os objetos destacados",
  );
  await expect(
    page.getByRole("heading", { name: "N-isolado", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.locator(".explorer").getByRole("button", { name: /N-isolado/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
});
