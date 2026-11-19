# Sequência de desenvolvimento

O destino é uma ferramenta abrangente de análise estrutural. O ponto de partida é um caminho curto e verificável entre lançamento e resultados. A interface evolui junto do núcleo.

| Etapa                                 | Entrega                                                                                                                    | Critério de conclusão                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 01 — Fundação e análise plana         | Modelo versionado, editor XZ + vista 3D, salvar/abrir, adaptador Beam2d, execução nativa, reações e diagramas              | Viga criada do zero, apoios/cargas definidos, análise real, resultados conferidos e reabertura sem perdas       |
| 02 — Desktop reproduzível             | Distribuição OOFEM versionada, instaladores Windows/Linux, diagnóstico de instalação, cancelamento e logs por execução     | Instalação em máquinas limpas, análise offline, binários e licenças rastreáveis                                 |
| 03 — Lançamento de pórticos espaciais | Eixos, pavimentos, planos de trabalho, ortogonalidade, seleção múltipla, copiar/replicar, interseções e Beam3d com seis GL | Pórtico assimétrico de dois pavimentos lançado a partir do vazio e comparado com referências independentes      |
| 04 — Casos e resultados de projeto    | Gerenciamento de padrões/casos, combinações, envelopes, forças simultâneas, filtros e tabelas editáveis                    | Rastrear a origem de cada resultado e identificar caso/composição governante sem combinar máximos incompatíveis |
| 05 — Recursos estruturais             | Liberações, offsets, diafragmas, molas, P–Δ, placas/cascas e refinamento de malha                                          | Benchmark independente por elemento/recurso, teste de convergência e verificação de equilíbrio                  |
| 06 — Dinâmica                         | Fontes de massa, modos, participação modal, amortecimento, espectro e histórico no tempo                                   | Frequências e modos de modelos de referência, massa participante e respostas dinâmicas verificadas              |
| 07 — Ecossistema e produtividade      | IFC/DXF conforme escopo, relatórios, integração MolaStruct/ArmaduraStruct/Launcher e extensibilidade                       | Intercâmbio versionado, unidades consistentes, rastreabilidade e documentação de uso                            |

## Escopo já implementado na etapa 01

Modelo próprio, histórico, persistência, editor por clique no XZ, seleção compartilhada, seções retangulares, vínculos e cargas, entrada OOFEM, parser, ponte Tauri, tabelas, CSV, deformada e diagramas amostrados. Casos analíticos automatizados incluem barras horizontais, verticais e inclinadas.

## Próximo incremento

Fechar o ciclo desktop em Windows e Linux com a distribuição exata do OOFEM 3.0. Acrescentar ao conjunto de regressão um pórtico plano de dois pavimentos com referências independentes antes da migração a Beam3d. Documentar quais bibliotecas do solver acompanham cada instalação. Em seguida, avançar para eixos/pavimentos e lançamento espacial.

## Decisões que devem continuar explícitas

- A inspiração no SAP2000 é a fluidez do lançamento, vistas sincronizadas, propriedades acessíveis e leitura integrada de resultados.
- OOFEM é adaptado por um contrato próprio. Objetos do projeto não dependem de nomes ou índices específicos do solver.
- Análise dinâmica tem fonte de massa própria. Os casos estáticos não definem massa implicitamente.
- Molas acopladas 6 × 6 do MolaStruct exigem verificação de orientação, unidades e convenções de acoplamento.
- Dimensionamento e detalhamento normativo exigirão etapas específicas, posteriores à validação da análise.
