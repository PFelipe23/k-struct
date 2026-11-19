# Referência de saída

`beam.in` foi gerado por `exportOofem(beamExample(), 'EL')`. `beam-oofem.txt` é a saída real correspondente, executada no Linux com OOFEM `v3.0-437-gd77741577` em 19/11/2026.

Espaços ao final de linhas foram normalizados. O arquivo fixa o contrato do parser e permite testar apresentação e invalidação de resultados na interface, substituindo somente a comunicação IPC do Tauri. Esses testes não substituem os benchmarks que executam o solver, nem a verificação do runner Rust.
