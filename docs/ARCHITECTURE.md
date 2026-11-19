# Arquitetura

## Fluxo

`Projeto editável → validação → malha de análise → entrada OOFEM → processo nativo → saída normalizada → tabelas e diagramas`

| Camada            | Responsabilidade                                          | Local                   |
| ----------------- | --------------------------------------------------------- | ----------------------- |
| Domínio           | Formato v1, entidades, relações, validação, histórico     | `src/domain`            |
| Adaptador         | Discretização, IDs, unidades e sinais, leitura da saída   | `src/solver/oofem.ts`   |
| Ponte desktop     | Abrir/salvar, configuração do motor e IPC                 | `src/solver/desktop.ts` |
| Processo          | Diretório temporário, execução sem shell, prazo e limpeza | `crates/solver-runner`  |
| Aplicativo nativo | Registro do comando assíncrono e permissões               | `src-tauri`             |
| Interface         | Modelo compartilhado, vistas, propriedades e resultados   | `src/components`        |

React/TypeScript/Vite/Three.js no frontend. Tauri 2/Rust no desktop, seguindo os aplicativos OpenStruct. SVG é usado na elevação para seleção e desenho preciso. A perspectiva usa Three.js, renderizando apenas quando o modelo, câmera ou tamanho mudam.

## Modelo próprio

O projeto contém coordenadas XYZ, materiais, seções, nós, barras, padrões de carga e casos de análise. A primeira versão restringe a análise a Y = 0 e três graus de liberdade ativos por nó (UX, UZ e RY). A expansão dos vínculos espaciais será uma migração explícita do esquema.

IDs do projeto são persistentes. IDs numéricos do OOFEM são reconstruídos a cada exportação. Uma barra é dividida em oito elementos por padrão. Nós intermediários da análise não aparecem como objetos editáveis. A propriedade `segmentsPerMember` aceita de 2 a 32 segmentos. Versões futuras precisam avaliar convergência e melhorar a amostragem dos diagramas.

Padrão de carga armazena ações. Caso de análise contém seus fatores e o procedimento. A primeira interface edita os padrões existentes e escolhe o caso existente. Criação de novos casos, combinações e fontes de massa terá telas e contratos próprios. Combinação de resultados não deve ser confundida com combinação de cargas nem com fonte de massa.

## Unidades e sinais

Persistência e entrada do solver em N, m, kg, s e rad. A interface converte cargas para kN/kN·m, seção para cm, E para GPa, deslocamentos para mm e rotações para mrad nas tabelas.

Z global é vertical positivo para cima. Momentos globais obedecem à regra da mão direita. A barra vai do nó inicial ao final. No plano XZ, a base local tem `u = (c, s)` e `w = (-s, c)`. A transformação de carga uniforme é explícita, `qu = c qX + s qZ`, `qw = -s qX + c qZ`, enviada com `csType 1`.

Os esforços locais de extremidade `[Fu1,Fw1,My1,Fu2,Fw2,My2]` são convertidos em esforços de seção: início `N=-Fu1, V=Fw1, M=My1`, fim `N=Fu2, V=-Fw2, M=-My2`. A interpretação positiva de momento sagente vale para uma viga horizontal orientada em +X. Inverter o sentido da barra exige interpretar sua base local.

As tabelas apresentam estações da malha. Deformadas e diagramas são linhas interpoladas entre estas estações, sem pretensão de avaliar extremos exatos entre elas.

## Consistência

- Um objeto de projeto validado é a única fonte de verdade das vistas e propriedades.
- Edição gera uma nova versão imutável do projeto e invalida resultados.
- A resposta de uma análise em andamento só é aceita se o conteúdo do projeto continuar igual.
- Arquivos não podem configurar executáveis nem introduzir comandos. A seleção do OOFEM fica nas preferências locais.
- O runner usa argumentos separados, sem shell, um diretório temporário por execução, limite de 60 s e limite de 32 MB por saída. Encerra e aguarda o processo em timeout.
- O parser exige término, passo único, deslocamentos e esforços completos, reações dos vínculos e equilíbrio global. Erros não geram resultados parciais.
- Cruzamentos entre interiores de barras não criam ligação automaticamente. Nós no interior de uma barra bloqueiam a análise e pedem subdivisão explícita. O editor deve evoluir para detecção e divisão guiada de interseções.

## Referências técnicas do adaptador

- [OOFEM Beam2d 3.0](https://github.com/oofem/oofem/blob/v3.0/src/sm/Elements/Beams/beam2d.C)
- [Caso oficial beam2d_1](https://github.com/oofem/oofem/blob/v3.0/tests/sm/beam2d_1.in)
- [Comandos Rust no Tauri](https://v2.tauri.app/develop/calling-rust/)

Trabalho bloqueante fica em `spawn_blocking`, preservando a responsividade da janela.
