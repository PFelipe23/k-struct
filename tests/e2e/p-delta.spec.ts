import { expect, test, type Page } from "@playwright/test";
import { serializeProject } from "../../src/domain/model";
import { pDeltaColumn } from "../fixtures/p-delta";
import { runDeck } from "../fixtures/solve-oofem";

async function openComparison(page: Page, executable?: string) {
  if (executable) {
    await page.exposeFunction("solvePDeltaDeck", (deck: string) =>
      runDeck(deck, executable),
    );
  }
  await page.addInitScript(
    ({ draft, solve }) => {
      type Invocation = {
        runId: string;
        runContext: Record<string, string>;
        response: { onmessage: (message: unknown) => void };
        deck: string;
      };
      const w = window as unknown as {
        isTauri: boolean;
        solvePDeltaDeck: (deck: string) => Promise<string>;
        __TAURI_INTERNALS__: {
          transformCallback: () => number;
          invoke: (command: string, args: Invocation) => Promise<unknown>;
        };
      };
      w.isTauri = true;
      localStorage.setItem("kstruct.draft.v32", draft);
      let callbackId = 0;
      let pending: Invocation | null = null;
      const finish = (args: Invocation, output: string | null) => {
        args.response.onmessage({
          output,
          log: {
            summary: {
              ...args.runContext,
              status: output ? "completed" : "cancelled",
              message: output ? "OOFEM concluído." : "Execução cancelada.",
            },
            stdout: "",
            stderr: "",
          },
          historyError: null,
        });
      };
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => ++callbackId,
        invoke: async (command, args) => {
          if (command === "start_oofem") {
            if (solve) finish(args, await w.solvePDeltaDeck(args.deck));
            else pending = args;
          } else if (
            command === "cancel_oofem" &&
            pending?.runContext.runId === args.runId
          ) {
            finish(pending, null);
            pending = null;
            return true;
          } else {
            throw new Error(`Mensagem de teste inesperada: ${command}`);
          }
        },
      };
    },
    { draft: serializeProject(pDeltaColumn()), solve: Boolean(executable) },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page.getByRole("button", { name: "Análise P–Δ", exact: true }).click();
  return page.getByRole("dialog", { name: "Análise estática P–Δ" });
}

test("valida os casos e encaminha o cancelamento ao processo P–Δ ativo", async ({
  page,
}) => {
  const dialog = await openComparison(page);
  const run = dialog.getByRole("button", {
    name: "Comparar primeira ordem e P–Δ",
  });
  const increment = dialog.getByLabel("Incremento lateral");
  await increment.selectOption("gravity");
  await expect(run).toBeDisabled();
  await increment.selectOption("lateral");
  await run.click();
  await expect(dialog.getByRole("status")).toContainText("Pré-carga linear");
  await dialog.getByRole("button", { name: "Cancelar análise P–Δ" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Comparação P–Δ cancelada.",
  );
  await expect(
    dialog.getByRole("heading", { name: /Comparação convergida/ }),
  ).toHaveCount(0);
  await expect(run).toBeEnabled();
});

test("compara a saída real e conserva o último passo quando a iteração falha", async ({
  page,
}) => {
  const executable = process.env.OOFEM_BIN;
  test.skip(!executable, "Requer OOFEM_BIN");
  const dialog = await openComparison(page, executable);
  const run = dialog.getByRole("button", {
    name: "Comparar primeira ordem e P–Δ",
  });
  await run.click();
  await expect(
    dialog.getByRole("heading", { name: "Comparação convergida" }),
  ).toBeVisible();
  const top = dialog
    .getByRole("table", { name: "Deslocamentos" })
    .getByRole("row", { name: /^Topo / });
  await expect(top.getByRole("cell").nth(0)).toHaveText("10");
  await expect(top.getByRole("cell").nth(3)).toHaveText(/^12,(49[0-9]+|5)$/);
  await dialog
    .getByRole("combobox", { name: "Resultado", exact: true })
    .selectOption("reactions");
  await expect(dialog.getByRole("table", { name: "Reações" })).toContainText(
    "Primeira ordem",
  );
  await dialog
    .getByRole("combobox", { name: "Resultado", exact: true })
    .selectOption("forces");
  await expect(dialog.getByRole("table", { name: "Esforços" })).toContainText(
    "Lado da seção",
  );
  await dialog.getByLabel("Limite de iterações por passo").fill("1");
  await run.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "O último passo convergido foi o 0",
  );
});
