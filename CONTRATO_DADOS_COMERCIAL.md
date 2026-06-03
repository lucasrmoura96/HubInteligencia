# Contrato de Dados — Painel Comercial Agroadvance

> **Para quem vai construir a interface (Claude Design).**
> Este documento descreve **tudo** que os dados oferecem. Você pode desenhar a interface do zero a partir daqui, sem precisar ler o JS atual. Os números já estão prontos e validados — seu trabalho é a camada visual.

---

## 1. O que é este painel

Painel de **performance do time comercial** da Agroadvance (educação B2C no agro — MBAs, pós e imersões), feito para a **liderança comercial**.

São **2 abas independentes**, alternadas por um seletor no topo:

| Aba | Foco | Pessoa medida por |
|-----|------|-------------------|
| **SDR** | Pré-vendas: qualificação e agendamento | **Atividades** (propostas, reuniões, no-show) |
| **Closer** | Fechamento: vendas e faturamento | **Negócios** (ganhos, valor, win rate) |

O **filtro de período é compartilhado** entre as duas abas (fica no topo, acima das abas ou ao lado — escolha de design).

---

## 2. Como os dados chegam na página

Os dados são **cifrados** (AES-256-GCM) e entregues por uma única chamada assíncrona após o login:

```js
const data = await HubAuth.unlock({
  key: 'comercial',
  varName: 'PAINEL_ENC_COMERCIAL',
  nome: 'Comercial'
});
// `data` é o objeto JSON descrito na seção 4.
```

- `HubAuth` vem de `assets/js/auth.js` (já existe; mostra a tela de login e devolve o objeto decifrado).
- O bloco cifrado vem de `dados/performance_comercial_enc.js` (carregado no `<head>`).
- **Você não precisa mexer em criptografia.** Só consumir o objeto `data`.

---

## 3. Glossário de métricas (definições do negócio)

Definições oficiais dadas pela liderança — respeite a nomenclatura na tela:

| Termo | Definição | Onde mostrar como |
|-------|-----------|-------------------|
| **MQL** | Lead qualificado de marketing (vem do RD Station, grupo "Fundo"). Métrica de **topo** do funil. | "MQLs" |
| **Reunião qualificada** | Lead qualificado **e** reunião agendada. Conta como qualificada quando `Qualificação/Feedback` ∈ {"Qualificação OK", "Check Liderança"}. | "Reuniões Qualif." |
| **No-show** | Cliente **não compareceu** à reunião agendada. Só se aplica a reunião. | "No-show" |
| **Proposta wpp** | Cliente não atende, mas conseguimos contato **e proposta via WhatsApp**. | **"Proposta wpp"** (escrever exatamente assim) |
| **Venda / Ganho** | Negócio fechado (matrícula). Valor = faturamento. | "Vendas" / "Faturamento" |
| **Win rate** | Ganhos ÷ (Ganhos + Perdidos). | "Win rate" |
| **Ticket médio** | Faturamento ÷ Vendas. | "Ticket" |
| **Ciclo** | Dias entre criação do negócio e o ganho (ciclo ~1 dia → fluxo ≈ mês). | "Ciclo (dias)" |

> ⚠️ **A liderança NÃO quer telas de "análise de perdas"** (Pareto de motivos de perda etc.). O dado `motivos_perda_mensal` existe no JSON mas **não deve virar seção** sem pedido explícito.

> **Reuniões NÃO usam o campo "Concluído"** (é operacionalmente não-confiável — esquecido ou marcado dias depois). Uma reunião é contada por **tipo de atividade = "Reunião"**, na **data adicionada**, independente do status. "Qualif. OK" = dessas, as com feedback qualificado.

> **Automação ("Bot Pedro"):** alguns registros de SDR são de automação, não de pessoas. Vêm com `is_bot: true` e devem ficar **fora dos pódios/rankings de pessoas** (pode mostrar numa linha à parte, com aparência atenuada).

---

## 4. ⭐ A REGRA DE OURO da agregação

**As taxas (%) NÃO são pré-gravadas por mês.** O JSON guarda **contagens cruas** (numeradores e denominadores). Para um período filtrado (ex.: "Mar+Abr 2026"), você deve:

1. **Somar as contagens cruas** dos meses que batem com o filtro.
2. **Só então dividir** para obter a taxa.

> Nunca faça média de percentuais entre meses — dá errado. Some `ganhos` e `perdidos` de todos os meses, depois calcule `win_rate = ganhos / (ganhos+perdidos)`.

As fórmulas derivadas estão na **seção 7**.

---

## 5. Modelo de filtro de período

O filtro define quais meses/dias entram na soma. Estados possíveis (desenhe os controles como quiser):

- **Ano**: `'all'` ou um ano (`2025`, `2026`).
- **Mês**: `'all'` ou lista de meses (1–12). Multi-seleção.
- **Dia**: `'all'` ou lista de dias (1–31). Multi-seleção. (Só afeta séries diárias.)
- **Range personalizado**: `{ de: '2026-03-01', ate: '2026-04-30' }`.
- **Presets** sugeridos: Tudo · YTD · Mês atual · Hoje · Personalizado.
- **Padrão ao abrir:** mês atual (mês de `meta.data_referencia`).

**Séries mensais** (`mensal`, `closers[].mensal`, etc.) filtram por `(ano, mes)`.
**Séries diárias** (`*_diario`) filtram pela string `data` (`'YYYY-MM-DD'`).

**Cross-filters por entidade** (além do período):
- Clicar num closer no ranking → filtra todas as seções da aba Closer por aquele closer.
- Selects "por SDR", "por Closer", "por Curso" nas seções de detalhe.

---

## 6. Contrato completo (chave a chave)

Objeto raiz tem 13 chaves. Valores de exemplo são **reais** (base de 2026-06-02).

### 6.1 `meta`
```json
{
  "atualizado_em": "2026-06-02T17:23:19",
  "data_referencia": "2026-06-02",          // dia mais recente com dado; use p/ "mês atual"
  "periodo": { "ano_inicio": 2025 },
  "modelagem": "Safra por data de criação do negócio (cohort). Ciclo ~1 dia ⇒ ≈ fluxo do mês.",
  "volumes": { "negocios": 10372, "atividades": 18224 }
}
```

### 6.2 `kpis` — totais do período inteiro (2025–2026), 20 campos
Estes são os números **globais**. Para um recorte filtrado, recalcule a partir de `mensal` (seção 4).
```json
{
  "mqls": 36870,              // topo do funil (RD)
  "criados": 10372,           // negócios criados
  "ganhos": 1795,             // vendas
  "perdidos": 7967,
  "abertos": 610,
  "faturamento": 20819461.25, // R$
  "ticket_medio": 11598.59,   // R$
  "win_rate": 18.4,           // %
  "pct_ganho_criados": 17.3,  // %
  "qualificados": 7141,       // negócios com Qualificação OK
  "taxa_qualificacao": 68.8,  // %
  "com_reuniao": 4694,        // negócios com reunião
  "reunioes_qualificadas": 4276,
  "com_proposta": 2329,
  "no_show": 1898,
  "no_show_rate": 28.8,       // %
  "conv_mql_rq": 11.6,        // % MQL → Reunião Qualificada
  "conv_rq_venda": 42.0,      // % RQ → Venda
  "ciclo_medio_dias": 5.9,
  "ciclo_mediana_dias": 1.0
}
```

### 6.3 `mensal` — série mensal (18 meses), base da aba CLOSER e do contexto global
Cada item = um mês, com os **mesmos campos de `kpis`** + identificação do período. **É a fonte para somar e derivar** no recorte filtrado.
```json
{
  "periodo": "2026-06", "ano": 2026, "mes": 6,
  "mqls": 151, "criados": 41, "ganhos": 4, "perdidos": 8, "abertos": 29,
  "faturamento": 36110.01, "ticket_medio": 9027.5, "win_rate": 33.3,
  "qualificados": 14, "com_reuniao": 13, "reunioes_qualificadas": 8,
  "com_proposta": 4, "no_show": 5, "no_show_rate": 27.8,
  "conv_mql_rq": 5.3, "conv_rq_venda": 50.0,
  "ciclo_medio_dias": 0.0, "ciclo_mediana_dias": 0.0
}
```

### 6.4 `funil` — etapas do funil global (4 etapas)
```json
[
  { "etapa": "MQLs", "valor": 36870, "conversao": 100.0 },
  { "etapa": "Reuniões Qualificadas", "valor": 4276, "conversao": 11.6 },   // % do anterior
  { "etapa": "Vendas", "valor": 1795, "conversao": 42.0 },                  // % do anterior
  { "etapa": "Faturamento", "valor": 20819461.25, "is_moeda": true, "conversao": null }
]
```
`conversao` = % em relação à etapa anterior. `is_moeda: true` → formatar como R$. **Recalcule do recorte filtrado** (some `mqls`, `reunioes_qualificadas`, `ganhos`, `faturamento` de `mensal`).

### 6.5 `closers[]` — ranking de closers (28 closers) — **ABA CLOSER**
> Exemplo abaixo é o 1º registro real (`closers[0]`). Top closer da base = **Jéssica Gachet** (referência).
```json
{
  "nome": "Administrador",
  "mensal": [
    { "periodo": "2025-01", "ano": 2025, "mes": 1,
      "criados": 11, "ganhos": 0, "perdidos": 11, "faturamento": 0.0,
      "qualificados": 0, "com_reuniao": 1, "rq": 0, "no_show": 10 }
    // ... um por mês
  ]
}
```
Para o ranking no período filtrado: some os meses que batem e ordene por `ganhos` (ou faturamento).

### 6.6 `sdrs[]` — ranking de SDRs (19 entradas) — **ABA SDR**
SDR é medido por **atividade**, não por negócio. Campos diferentes dos closers. (Nome abaixo é ilustrativo; SDRs reais com alto volume incluem Sabrina Carvalho.)
```json
{
  "nome": "Sabrina Carvalho",
  "is_bot": false,        // true = automação (fora do pódio de pessoas)
  "sem_sdr": false,       // true = registros sem SDR atribuído
  "mensal": [
    { "periodo": "2025-01", "ano": 2025, "mes": 1,
      "propostas": 32,         // Proposta wpp
      "reunioes_total": 69,    // reuniões realizadas
      "reunioes_ok": 56,       // reuniões qualificadas (OK)
      "no_show": 14 }
    // ... um por mês
  ]
}
```
> **MQLs não são atribuídos por SDR** (o RD não liga MQL a SDR). Logo, a conversão "MQL→RQ" no nível do SDR usa os **MQLs do time** (de `mensal[].mqls`). No nível individual, prefira mostrar volume + aproveitamento.

### 6.7 `sdr_reunioes_diario[]` — heatmap SDR × Dia (1687 linhas) — ABA SDR
```json
{ "sdr": "(sem SDR)", "data": "2025-01-06", "qtd": 6, "qtd_ok": 5 }
```
`qtd` = reuniões realizadas no dia; `qtd_ok` = quantas eram qualificadas (OK).

### 6.8 `closer_vendas_diario[]` — vendas por closer por dia (1032 linhas) — ABA CLOSER
```json
{ "closer": "Administrador", "data": "2026-05-04", "qtd": 1, "faturamento": 10000.0 }
```

### 6.9 `venda_closer_curso_diario[]` — vendas closer × curso × dia (1592 linhas) — ABA CLOSER
Para o heatmap "Closer × Dia" filtrável por curso (hover = faturamento).
```json
{ "closer": "Administrador", "curso": "(sem produto)", "data": "2026-05-12", "qtd": 1, "faturamento": 2997.0 }
```

### 6.10 `closer_curso_mensal[]` — reuniões/vendas por closer × curso × mês (1474 linhas) — ABA CLOSER
```json
{ "closer": "Administrador", "curso": "(sem produto)", "ano": 2025, "mes": 7,
  "reunioes": 0, "vendas": 0, "faturamento": 0.0 }
```

### 6.11 `curso_mensal[]` — performance por curso por mês (288 linhas) — ABA CLOSER
```json
{ "curso": "Bioinsumos", "ano": 2025, "mes": 1,
  "criados": 16, "ganhos": 10, "perdidos": 6, "faturamento": 107076.04,
  "qualificados": 13, "com_reuniao": 0, "rq": 0 }
```

### 6.12 `motivos_perda_mensal[]` — (310 linhas) — **NÃO USAR sem pedido** (ver seção 3)
```json
{ "motivo": "SEM RETORNO", "ano": 2026, "mes": 4, "qtd": 1 }
```

### 6.13 `filtros_disponiveis` — listas para popular selects/filtros
```json
{
  "anos": [2025, 2026],
  "closers": [ "...", 28 nomes ],
  "sdrs":    [ "...", 18 nomes ],
  "canais":  [ "...", canais de origem ],
  "produtos":[ "Bioinsumos", "MBA em Agronegócios", "Pós Graduação em Soja e Milho", ... 23 cursos ]
}
```

---

## 7. Fórmulas derivadas (depois de somar as contagens do período)

**ABA CLOSER** (sobre a soma de `mensal` / `closers[].mensal` filtrados):
| Métrica | Fórmula |
|---------|---------|
| Win rate | `ganhos / (ganhos + perdidos) * 100` |
| Ticket médio | `faturamento / ganhos` |
| Taxa de qualificação | `qualificados / criados * 100` |
| No-show rate | `no_show / (com_reuniao + no_show) * 100` |
| Conv. MQL→RQ | `reunioes_qualificadas / mqls * 100` |
| Conv. RQ→Venda | `ganhos / reunioes_qualificadas * 100` |

**ABA SDR** (sobre a soma de `sdrs[].mensal` filtrados; `mqls` vem de `mensal`):
| Métrica | Fórmula |
|---------|---------|
| Aproveitamento | `reunioes_ok / reunioes_total * 100` |
| No-show rate | `no_show / (reunioes_total + no_show) * 100` |
| Conv. MQL→RQ | `reunioes_ok / mqls * 100` (MQLs do time) |

**Comparativo MoM** (mês vs. mês anterior): só quando o filtro é exatamente 1 ano + 1 mês (sem dia/range). Some o mês anterior e compare campo a campo (`(atual-ant)/ant*100`). Em métricas "ruins quando sobem" (no-show), inverta a cor.

---

## 8. Seções sugeridas por aba (mapeamento dado → tela)

> O layout atual segue o tema do painel de Marketing (sidebar fixa, header com breadcrumb, grid de cards). Fique livre para redesenhar — abaixo é o **conteúdo** que precisa existir.

### Aba SDR
1. **KPIs**: MQLs · Reuniões realizadas (+aproveitamento) · Reuniões Qualif. OK · No-show. Secundários: Proposta wpp · Conv. MQL→RQ · Aproveitamento · No-show %. → `getSdrMensal` somado.
2. **Funil de qualificação**: MQLs → Reuniões Qualif. → No-show (% do anterior). → `funil` recalculado p/ SDR.
3. **Evolução mensal**: barras de Reuniões total + Reuniões Qualif. OK (e MQLs). → `sdrs[].mensal`.
4. **Ranking de SDRs**: pódio (top 3 pessoas) + tabela: Proposta wpp · Reuniões · Reuniões Quali OK · No-show · No-show %. Bot/sem-SDR fora do pódio.
5. **Heatmap Reuniões Qualificadas · SDR × Dia** (select por SDR). → `sdr_reunioes_diario`.
6. **Eficiência · SDRs**: tabela de conversão (Reuniões · Quali OK · Aproveitamento · No-show %), com volume mínimo p/ a taxa fazer sentido.

### Aba Closer
1. **KPIs**: Vendas · Faturamento · Reuniões Qualif. · Ticket · Negócios criados · Ciclo. Secundários: Win rate · Conv. RQ→Venda.
2. **Funil de fechamento**: Reuniões Qualif. → Vendas → Faturamento.
3. **Evolução mensal**: barras de Vendas + linha de Faturamento. → `mensal` (ou `closers[].mensal` no cross-filter).
4. **Ranking de Closers**: pódio + tabela, clique faz cross-filter. → `closers[]`.
5. **Heatmap Vendas · Closer × Dia** (selects: curso + closer; hover = faturamento). → `venda_closer_curso_diario`.
6. **Reuniões e Vendas por Curso** (select por curso). → `closer_curso_mensal`.
7. **Performance por Curso**: Vendas · Ticket · Win rate · Conversão. → `curso_mensal`.
8. **Eficiência · Closers**: Conv. RQ→Venda · Win rate · Ticket.

---

## 9. Convenções e valores especiais

- Placeholders: `"(sem SDR)"`, `"(sem dono)"`, `"(sem produto)"`, `"(sem motivo)"` — tratar como rótulos válidos.
- Moeda em **R$** (pt-BR, sem casas decimais na exibição: `R$ 20.819.461`).
- Percentuais com 1 casa: `28,8%`.
- Números grandes com separador de milhar pt-BR: `36.870`.
- `data` sempre `'YYYY-MM-DD'`; `periodo` sempre `'YYYY-MM'`.
- Tema claro/escuro via `document.documentElement.dataset.theme` (`'light'`/`'dark'`), salvo em `localStorage['hub-theme']`.

---

## 10. Pipeline (de onde vêm os dados — só p/ contexto)

Gerado por `scripts/comercial_pipeline.py` a partir de 3 bases Excel (Negócios + Atividades do Pipedrive + RD Station). Publicação: rodar **`Atualizar HUB MKT.bat`** (refresh → pipeline → cifra → git push). **A interface não precisa rodar nada disso** — só consome o `data` da seção 2.
