# Configuração do OOFEM

Esta etapa executa um OOFEM já instalado. O motor não é baixado automaticamente e não acompanha os instaladores iniciais.

1. Obtenha uma distribuição do [OOFEM](https://github.com/oofem/oofem/releases/tag/v3.0) para sua plataforma, ou compile a tag 3.0.
2. Preserve as bibliotecas distribuídas com o executável. Confirme que `oofem -f analysis.in` funciona no terminal com uma entrada exportada do KStruct.
3. Abra **Configurar OOFEM** e escolha o executável. O caminho fica nas preferências locais, separado do projeto estrutural.

No Linux, algumas distribuições precisam do diretório `lib` no ambiente de carregamento. Exemplo para um pacote instalado em `/opt/oofem`:

```sh
export OOFEM_BIN=/opt/oofem/bin/oofem
export LD_LIBRARY_PATH=/opt/oofem/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
npm run desktop:dev
```

No PowerShell, mantendo as DLLs no local indicado pela distribuição:

```powershell
$env:OOFEM_BIN = 'C:\OOFEM\bin\oofem.exe'
npm run desktop:dev
```

## Compilação de referência

A tag 3.0 corresponde ao commit `214b161ed3acb471f2d0104b004c37fd73bafaa2`. A CI usa esse commit fixo, com o módulo de mecânica estrutural e o executável habilitados.

```sh
cmake -S caminho/oofem -B build-oofem -DCMAKE_BUILD_TYPE=Release -DUSE_SHARED_LIB=OFF -DUSE_FM=OFF -DUSE_TM=OFF -DUSE_MPM=OFF -DUSE_PYBIND_BINDINGS=OFF
cmake --build build-oofem --parallel 4
```

## Limites do adaptador atual

- `StaticStructural`, um passo por execução, domínio `2dBeam`.
- Barras retangulares, elásticas e com ligações rígidas. Sem liberações, offsets, peso próprio automático ou não linearidade.
- `beamShearCoeff = 1e18` para o limite de Euler–Bernoulli. Não representa uma análise de Timoshenko com cisalhamento físico.
- Cargas uniformes e nodais, com unidades e transformação explícitas.
- Um diretório temporário isolado, 60 s de execução e 32 MB por arquivo de saída.
- O solver deve concluir e satisfazer o contrato de saída. Não se aceitam análises incompletas ou valores não finitos.

Um botão de cancelamento e um histórico persistente de execuções fazem parte da etapa de distribuição. Hoje a chamada conclui, falha ou termina no prazo limite.
