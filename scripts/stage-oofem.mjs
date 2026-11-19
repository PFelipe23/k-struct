import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pin = JSON.parse(
  readFileSync(join(root, "crates/solver-runner/oofem.json"), "utf8"),
);
const work = join(root, ".oofem-dist");
const source = join(work, "source");
const build = join(work, "build");
const resourceParent = join(root, "src-tauri", "resources");
const resource = join(resourceParent, "oofem");
const windows = process.platform === "win32";
const executable = windows ? "oofem.exe" : "oofem";

const capture = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8" }).trim();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const git = (args) => capture("git", ["-C", source, ...args]);
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function checkout() {
  mkdirSync(source, { recursive: true });
  if (!existsSync(join(source, ".git"))) {
    run("git", ["init", source]);
    run("git", [
      "-C",
      source,
      "remote",
      "add",
      "origin",
      `${pin.repository}.git`,
    ]);
  }
  // Upstream CMake generates this documentation include in the source tree.
  const changes = git(["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter((line) => line && line !== "?? doc/include/include.tex");
  if (changes.length) {
    throw new Error(`A pasta de fontes do OOFEM contém alterações: ${source}`);
  }
  if (!git(["tag", "--list", pin.tag])) {
    run("git", [
      "-C",
      source,
      "fetch",
      "--depth=1",
      `${pin.repository}.git`,
      `refs/tags/${pin.tag}:refs/tags/${pin.tag}`,
    ]);
  }
  if (git(["rev-parse", `${pin.tag}^{commit}`]) !== pin.commit) {
    throw new Error(
      `A tag ${pin.tag} não aponta para o commit esperado ${pin.commit}.`,
    );
  }
  run("git", ["-C", source, "checkout", "--detach", pin.commit]);
}

function stage() {
  if (process.arch !== "x64" || !(windows || process.platform === "linux")) {
    throw new Error(
      "O pacote integrado é produzido para Linux e Windows x86-64.",
    );
  }
  const cmakeVersion = capture("cmake", ["--version"]).split("\n")[0];
  checkout();
  const bin = join(build, "bin");
  const flags = [
    "-DCMAKE_BUILD_TYPE=Release",
    `-DOOFEM_VERSION=${pin.version}`,
    "-DUSE_OOFEM_EXE=ON",
    "-DUSE_SHARED_LIB=OFF",
    "-DUSE_SM=ON",
    "-DUSE_FM=OFF",
    "-DUSE_TM=OFF",
    "-DUSE_AM=OFF",
    "-DUSE_MPM=OFF",
    "-DUSE_PYBIND_BINDINGS=OFF",
    "-DUSE_PYTHON_EXTENSION=OFF",
    "-DUSE_VTK=OFF",
    "-DUSE_MPI_PARALLEL=OFF",
    "-DUSE_OPENMP_PARALLEL=OFF",
  ];
  if (windows) flags.push("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
  const generatorName = windows
    ? process.env.KSTRUCT_OOFEM_WINDOWS_GENERATOR || "Visual Studio 17 2022"
    : "Ninja";
  const generator = ["-G", generatorName, ...(windows ? ["-A", "x64"] : [])];
  run("cmake", [
    "-S",
    source,
    "-B",
    build,
    ...generator,
    ...flags,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${bin}`,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE=${bin}`,
  ]);
  run("cmake", [
    "--build",
    build,
    "--config",
    "Release",
    "--target",
    "oofem",
    "--parallel",
    String(Math.min(4, availableParallelism())),
  ]);

  mkdirSync(resourceParent, { recursive: true });
  const staged = mkdtempSync(join(resourceParent, "oofem-stage-"));
  try {
    const binary = join(staged, executable);
    copyFileSync(join(bin, executable), binary);
    if (!windows) {
      chmodSync(binary, 0o755);
      chmodSync(staged, 0o755);
    }
    const sourceArchive = `oofem-${pin.version}-source.zip`;
    const archive = join(staged, sourceArchive);
    run("git", [
      "-C",
      source,
      "archive",
      "--format=zip",
      `--prefix=oofem-${pin.version}/`,
      `--output=${archive}`,
      pin.commit,
    ]);
    copyFileSync(
      join(source, "COPYING.LGPLv2.1"),
      join(staged, "COPYING.LGPLv2.1"),
    );
    copyFileSync(join(source, "README"), join(staged, "OOFEM-README.txt"));
    copyFileSync(
      join(root, "THIRD_PARTY_NOTICES.md"),
      join(staged, "THIRD_PARTY_NOTICES.md"),
    );
    const manifest = {
      ...pin,
      platform: process.platform,
      arch: process.arch,
      executable,
      sha256: sha256(binary),
      sourceArchive,
      sourceSha256: sha256(archive),
      cmakeVersion,
      buildFlags: flags,
      generator: generatorName,
    };
    writeFileSync(
      join(staged, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    writeFileSync(
      join(staged, "BUILD.txt"),
      [
        `OOFEM ${pin.version} (${pin.commit})`,
        `Fonte exata: ${sourceArchive}. Licença: COPYING.LGPLv2.1.`,
        "Extraia o ZIP e execute os comandos a partir da pasta que contém o diretório extraído.",
        "A versão é informada explicitamente ao compilar fora de um checkout Git.",
        `cmake -S oofem-${pin.version} -B build ${generator.map((arg) => JSON.stringify(arg)).join(" ")} ${flags.join(" ")} -DSKBUILD_PROJECT_VERSION=${pin.version}.0`,
        "cmake --build build --config Release --target oofem --parallel 4",
        "",
      ].join("\n"),
    );
    rmSync(resource, { recursive: true, force: true });
    renameSync(staged, resource);
    console.log(`OOFEM integrado: ${resource} (${manifest.sha256})`);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

stage();
