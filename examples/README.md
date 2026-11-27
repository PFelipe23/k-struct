# Pórtico em L com envelope de esforços

O [projeto de exemplo](portico-em-l-envelopes.kstruct.json) reproduz o [benchmark de envelopes](../docs/VALIDATION.md#envelopes-de-esforços). É um modelo espacial com um pilar de 3 m engastado na base e uma viga V1 de 4 m. As duas barras têm seção de 15 × 20 cm. Os padrões `G` e `P` aplicam forças e momentos na extremidade livre da viga.

Use o KStruct desktop da branch `master` a partir do commit [`49ee0e3`](https://github.com/ricardocorsini/k-struct/commit/49ee0e3532217ea0729301859fdd95e5cb02546b), que aceita o esquema v4 e inclui envelopes. Para configurar o motor em uma instalação de desenvolvimento, consulte o [guia do OOFEM 3.0](../docs/OOFEM.md).

1. Baixe `portico-em-l-envelopes.kstruct.json`. No desktop, clique em **Abrir projeto** e selecione o arquivo.
2. Em **Caso, combinação ou envelope**, selecione **EL · Estática linear** e clique em **Analisar**. Quando terminar, selecione **CP · Compressão** e clique em **Analisar** novamente.
3. No mesmo seletor, escolha **Envelope**. Em **Resultados do envelope**, selecione **V1** em **Barra** e **0,5** em **Estação x/L**. Essa estação fica a 2 m do início da viga.
4. No seletor acima do diagrama, escolha **Momento fletor My** e leia a linha **Máximo**. Depois escolha **Normal N** e leia a linha **Mínimo**. Em cada linha, veja o nome na coluna **Combinação governante** e os esforços simultâneos nas colunas dessa mesma linha.

| Extremo em V1 (x/L = 0,5) | Combinação governante | N (kN) | My (kN·m) |
| ------------------------- | --------------------- | -----: | --------: |
| Maior My                  | CF · Flexão           |   −4,8 |     11,99 |
| Menor N (compressão)      | CC · Compressão       |  −15,1 |     −4,98 |

Se salvar uma cópia do projeto, os casos, as combinações e o envelope ficam no arquivo. Ao reabrir a cópia, analise EL e CP novamente para consultar os resultados.

## Duas lajes sobre uma viga comum

Abra o modelo no KStruct com **Abrir projeto** e clique em **Analisar**. A carga de −5 kN/m² atua exclusivamente em L1. A viga B1 ocupa a borda comum. O arquivo traz a ligação semirrígida com 1.000 kN·m/(rad·m). Na malha 16 × 16, a viga recebe −10,614 kN e o momento integrado na face de L1 vale +1,105 kN·m. Para comparar, altere apenas o vínculo para articulado ou contínuo e repita a análise. [Projeto](duas-lajes-viga-comum.kstruct.json) · [Benchmark e tolerâncias](../docs/VALIDATION.md#ks-43--vínculo-entre-duas-lajes-e-viga-comum)

## Cobertura com rigidez direcional

Abra a cobertura no KStruct desktop e clique em **Analisar**. O fator de flexão M11 vale 4. Em **Cobertura · Casca → Orientação e rigidez**, altere o ângulo de 0° para 90° e analise novamente. A direção de maior rigidez passa do vão de 6 m para o de 3 m. A flecha central passa de −0,2037 mm para −0,0599 mm. Selecione **Referencial do painel → Eixos geométricos** para comparar momentos na mesma direção antes e depois do giro. [Projeto](cobertura-direcional.kstruct.json) · [Comparação com Ritz](../docs/VALIDATION.md#ks-45--rigidez-direcional-dos-painéis)

## Parede com pressão hidrostática

Abra o modelo e clique em **Analisar**. Em **Resultados dos painéis espaciais**, confira a força aplicada em X de −235,44 kN e o momento aplicado em Y de −313,92 kN·m. Para baixar o nível da água para 2,30 m, abra **Parede do reservatório · Casca → Carga superficial**, informe 2,30 m na cota superior e 22,563 kN/m² na pressão inferior. Mantenha zero na pressão superior e analise novamente. [Projeto](parede-pressao-hidrostatica.kstruct.json) · [Referência analítica](../docs/VALIDATION.md#ks-46--pressão-hidrostática-e-carga-superficial-variável)
