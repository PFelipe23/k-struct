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
      type InvokeArgs = {
        runContext: { runId: string; projectName: string; caseName: string };
        runId: string;
        response: { onmessage: (outcome: unknown) => void };
      };
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args: InvokeArgs) => Promise<unknown>;
          transformCallback: () => number;
        };
        finishAnalysis?: () => void;
      };
      const engine = {
        origin: "bundled",
        path: "/kstruct/oofem/oofem",
        version: "3.0",
        commit: "214b161",
        sha256: "checksum",
      };
      let callbackId = 0;
      let pending: {
        runId: string;
        finish: (cancelled: boolean) => void;
      } | null = null;
      const records = () =>
        JSON.parse(sessionStorage.getItem("e2e-native-runs") ?? "[]") as Array<{
          summary: { runId: string };
          stdout: string;
        }>;
      w.isTauri = true;
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => ++callbackId,
        invoke: async (cmd, args) => {
          if (cmd === "start_oofem") {
            const finish = (cancelled: boolean) => {
              const log = {
                summary: {
                  ...args.runContext,
                  startedAt: Date.now(),
                  durationMs: 123,
                  engine,
                  status: cancelled ? "cancelled" : "completed",
                  message: cancelled
                    ? "Análise cancelada."
                    : "Execução do OOFEM concluída.",
                },
                stdout: "Saída do OOFEM para a viga de referência",
                stderr: "",
                logTruncated: false,
              };
              sessionStorage.setItem(
                "e2e-native-runs",
                JSON.stringify([log, ...records()]),
              );
              pending = null;
              args.response.onmessage({
                output: cancelled ? null : output,
                log,
                historyError: null,
              });
            };
            if (delayed) {
              pending = { runId: args.runContext.runId, finish };
              w.finishAnalysis = () => finish(false);
            } else finish(false);
            return;
          }
          if (cmd === "cancel_oofem" && pending?.runId === args.runId) {
            const { finish } = pending;
            setTimeout(() => finish(true), 80);
            return true;
          }
          if (cmd === "list_oofem_runs")
            return records().map((log) => log.summary);
          if (cmd === "read_oofem_log")
            return records().find((log) => log.summary.runId === args.runId);
          if (cmd === "diagnose_oofem")
            return {
              ok: true,
              message: "A viga de referência reproduziu os valores esperados.",
              engine,
              benchmark: {
                leftReactionN: 30000,
                rightReactionN: 30000,
                midspanUzM: -0.0084375,
              },
              stdout: "",
              stderr: "",
            };
          throw new Error(`Unexpected test IPC: ${cmd}`);
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

test("cancelamento não publica resultados e o log é recuperado ao reabrir", async ({
  page,
}) => {
  await bridge(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar análise" }).click();
  await expect(page.getByRole("status")).toContainText("Análise cancelada.");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );
  await page.reload();
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page.getByRole("button", { name: "Histórico de análises" }).click();
  const history = page.getByRole("dialog", { name: "Histórico de análises" });
  await expect(
    history.getByRole("heading", { name: "Cancelado" }),
  ).toBeVisible();
  await expect(
    history.getByText("Saída do OOFEM para a viga de referência"),
  ).toBeVisible();
});

test("configurações exibem origem, versão e resultado do diagnóstico", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Configurar OOFEM", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Motor OOFEM" });
  await settings.getByRole("button", { name: "Testar motor" }).click();
  await expect(settings.getByRole("status")).toContainText(
    "Integrado ao KStruct",
  );
  await expect(settings.getByRole("status")).toContainText("OOFEM 3.0");
  await expect(settings.getByRole("status")).toContainText("Flecha -8,4375 mm");
});
