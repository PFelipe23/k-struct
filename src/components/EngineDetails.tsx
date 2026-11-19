import { engineOriginLabel, type EngineInfo } from "../solver/desktop";

export default function EngineDetails({ engine }: { engine: EngineInfo }) {
  return (
    <dl className="engine-details">
      <dt>Origem</dt>
      <dd>{engineOriginLabel[engine.origin]}</dd>
      {engine.version && (
        <>
          <dt>Versão</dt>
          <dd>OOFEM {engine.version}</dd>
        </>
      )}
      <dt>Executável</dt>
      <dd>
        <code>{engine.path}</code>
      </dd>
      {engine.commit && (
        <>
          <dt>Commit</dt>
          <dd>
            <code>{engine.commit}</code>
          </dd>
        </>
      )}
      {engine.sha256 && (
        <>
          <dt>SHA-256</dt>
          <dd>
            <code>{engine.sha256}</code>
          </dd>
        </>
      )}
    </dl>
  );
}
