use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineOrigin {
    Bundled,
    Custom,
    Environment,
    Path,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub origin: EngineOrigin,
    pub path: String,
    pub version: Option<String>,
    pub commit: Option<String>,
    pub sha256: Option<String>,
}

#[derive(Debug)]
pub struct Engine {
    pub path: PathBuf,
    pub info: EngineInfo,
    pub(crate) _temporary: Option<tempfile::TempDir>,
}

const MAX_BINARY: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
struct Pin {
    version: String,
    commit: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: String,
    commit: String,
    platform: String,
    arch: String,
    executable: String,
    sha256: String,
    #[cfg(target_os = "linux")]
    payload: String,
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "oofem.exe"
    } else {
        "oofem"
    }
}

fn absolute_engine(path: &Path, origin: EngineOrigin) -> Result<Engine, String> {
    if !path.is_absolute() {
        return Err("Selecione um caminho absoluto para o executável OOFEM.".into());
    }
    if cfg!(windows)
        && !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("Selecione um executável .exe do OOFEM.".into());
    }
    if !path.is_file() {
        return Err(format!(
            "Executável OOFEM não encontrado em {}.",
            path.display()
        ));
    }
    Ok(Engine {
        path: path.to_path_buf(),
        _temporary: None,
        info: EngineInfo {
            origin,
            path: path.display().to_string(),
            version: None,
            commit: None,
            sha256: None,
        },
    })
}

fn bundled_engine(dir: &Path) -> Result<Engine, String> {
    let repair = |detail: &str| {
        format!(
        "O OOFEM integrado está incompleto ou alterado ({detail}). Reinstale o KStruct ou selecione outro executável."
    )
    };
    let manifest_path = dir.join("manifest.json");
    let mut manifest_bytes = Vec::new();
    File::open(manifest_path)
        .and_then(|file| file.take(8193).read_to_end(&mut manifest_bytes))
        .map_err(|_| repair("manifesto ausente"))?;
    if manifest_bytes.len() > 8192 {
        return Err(repair("manifesto excede o tamanho esperado"));
    }
    let manifest: Manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| repair("manifesto inválido"))?;
    let pin: Pin = serde_json::from_str(include_str!("../oofem.json"))
        .expect("the OOFEM version pin must be valid");
    let platform = if cfg!(windows) {
        "win32"
    } else {
        env::consts::OS
    };
    if manifest.commit != pin.commit
        || manifest.version != pin.version
        || manifest.platform != platform
        || manifest.arch != "x64"
        || env::consts::ARCH != "x86_64"
        || manifest.executable != executable_name()
    {
        return Err(repair("versão ou plataforma inesperada"));
    }
    #[cfg(target_os = "linux")]
    let mut engine = archived_engine(dir, &manifest.payload).map_err(|e| repair(&e))?;
    #[cfg(not(target_os = "linux"))]
    let mut engine = absolute_engine(&dir.join(executable_name()), EngineOrigin::Bundled)
        .map_err(|_| repair("executável ausente"))?;
    let mut file = File::open(&engine.path).map_err(|_| repair("executável ilegível"))?;
    if file.metadata().map_or(true, |m| m.len() > MAX_BINARY) {
        return Err(repair("tamanho inesperado do executável"));
    }
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).map_err(|_| repair("falha ao conferir o executável"))?;
    let checksum = format!("{:x}", hash.finalize());
    if checksum != manifest.sha256 {
        return Err(repair("SHA-256 divergente"));
    }
    engine.info.version = Some(manifest.version);
    engine.info.commit = Some(manifest.commit);
    engine.info.sha256 = Some(checksum);
    Ok(engine)
}

#[cfg(target_os = "linux")]
fn archived_engine(dir: &Path, payload: &str) -> Result<Engine, String> {
    use flate2::read::GzDecoder;
    use std::os::unix::fs::PermissionsExt;

    if payload != "oofem.gz" {
        return Err("arquivo de motor inesperado".into());
    }
    let resource = dir.join(payload);
    let extract = || -> io::Result<Engine> {
        let archive = File::open(&resource)?;
        let temporary = tempfile::Builder::new()
            .prefix("kstruct-oofem-")
            .tempdir()?;
        let binary = temporary.path().join(executable_name());
        let mut file = File::create(&binary)?;
        let size = io::copy(&mut GzDecoder::new(archive).take(MAX_BINARY + 1), &mut file)?;
        if size == 0 || size > MAX_BINARY {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "tamanho do motor inválido",
            ));
        }
        file.set_permissions(fs::Permissions::from_mode(0o700))?;
        drop(file);
        let mut engine =
            absolute_engine(&binary, EngineOrigin::Bundled).map_err(io::Error::other)?;
        engine.info.path = resource.display().to_string();
        engine._temporary = Some(temporary);
        Ok(engine)
    };
    extract().map_err(|e| format!("falha ao preparar o motor local: {e}"))
}

pub fn resolve_engine(
    resource_dir: &Path,
    custom: Option<&str>,
    require_bundle: bool,
) -> Result<Engine, String> {
    if let Some(path) = custom.map(str::trim).filter(|path| !path.is_empty()) {
        return absolute_engine(Path::new(path), EngineOrigin::Custom);
    }
    let bundled = resource_dir.join("oofem");
    if require_bundle || fs::symlink_metadata(&bundled).is_ok() {
        return bundled_engine(&bundled);
    }
    if let Some(path) = env::var_os("OOFEM_BIN").filter(|path| !path.is_empty()) {
        return absolute_engine(Path::new(&path), EngineOrigin::Environment);
    }
    if let Some(path) = env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .filter(|dir| dir.is_absolute())
            .map(|dir| dir.join(executable_name()))
            .find(|candidate| candidate.is_file())
    }) {
        return absolute_engine(&path, EngineOrigin::Path);
    }
    Err("OOFEM não encontrado. Instale o pacote KStruct com o motor integrado ou selecione um executável nas configurações.".into())
}
