# HANDOFF — HUB de Inteligência Agroadvance → Intranet

> Guia de migração para o desenvolvedor que vai subir este projeto na **intranet corporativa**
> (portal único de ferramentas). Escrito em 2026-06-17.
> Leia este arquivo **antes** de qualquer coisa. Em caso de dúvida, fale com o Lucas (lucas.moura@agroadvance.com.br).

---

## ⚠️ 0. AVISO DE SEGURANÇA — LEIA PRIMEIRO

Este pacote foi montado a pedido do dono do produto e **contém dados reais e sensíveis**:

| Arquivo | Conteúdo sensível |
|---|---|
| `usuarios.local.json` | **Senhas em texto puro** de todos os usuários do HUB |
| `bases/*.xlsx` | **PII de clientes** (nomes, e-mails, telefones) do RD Station e Pipedrive |
| `hub/dados/performance_*.json` | Dados de negócio em texto puro (faturamento, vendas, leads) |
| `hub/dados/performance_*_enc.js` | Os mesmos dados, cifrados (AES-256-GCM) |

**Obrigatório:**
1. Receba/transfira este .zip **apenas por canal seguro** (não e-mail aberto). Apague a cópia local quando terminar.
2. **Não** suba `usuarios.local.json`, `bases/` nem os `*.json` de texto puro para nenhum repositório git ou ambiente público. Veja o `.gitignore` — eles já são bloqueados no repo original.
3. Após a migração, **rotacione as senhas** dos usuários (as que estão aqui devem ser consideradas comprometidas por terem saído do ambiente controlado).
4. Trate as bases conforme a **LGPD** (há dados pessoais de clientes).

---

## 1. O que é o HUB

Portal estático de dashboards de performance da Agroadvance (educação B2C no agro). Hoje roda em **GitHub Pages**:
<https://lucasrmoura96.github.io/HubInteligencia/hub/>

Três telas (áreas):
- **`index.html`** — home/portal (cartões para as áreas).
- **`performance-mkt.html`** — Painel de Marketing (Topo e Fundo de funil; leads, MQLs, investimento, canais pagos, criativos). JS: `assets/js/painel.js`.
- **`performance-comercial.html`** — Painel Comercial (abas **SDR** e **Closer**; funil MQL→Reunião→Venda, rankings, cursos). JS: `assets/js/comercial.js`.

**Stack atual (100% client-side):** HTML + CSS (`theme.css`) + JavaScript vanilla + Chart.js (vendorizado, offline). **Sem framework, sem build step, sem backend** — é só servir arquivos estáticos por HTTPS.

---

## 2. Conteúdo do pacote

```
PAINEL MKT/
├── HANDOFF.md                      ← este guia
├── README.md                       ← fluxo de atualização original (1 clique)
├── CONTRATO_DADOS_COMERCIAL.md     ← contrato de dados do painel COMERCIAL (chave a chave)
├── Atualizar HUB MKT.bat           ← orquestra refresh+pipeline+cifragem+deploy (Windows/Agroadvance)
│
├── usuarios.local.json             ← 🔴 SEGREDO: usuários, senhas e áreas (entrada da cifragem)
├── usuarios.local.example.json     ← template sem segredo
│
├── bases/                          ← 🔴 PII: 4 bases-fonte + 1 de-para (config)
│   ├── RD Station V2.xlsx                  (leads/MQLs — topo e fundo de funil)
│   ├── Negócios B2C Pipedrive V1.xlsx      (deals: criação, ganho, valor, curso, SDR, closer)
│   ├── Atividades B2C Pipedrive V1.xlsx    (reuniões, propostas, no-show — base do SDR)
│   ├── Investimento Gerenciadores Mkt V1.xlsx (custo de mídia por campanha/curso)
│   └── DE_PARA Global.xlsx                 (mapa: identificador RD → Grupo/Curso/Conteúdo) — config, sem PII
│
├── hub/                            ← o site estático (é isto que vai pro ar)
│   ├── index.html · performance-mkt.html · performance-comercial.html · area-mkt.html
│   ├── assets/
│   │   ├── css/theme.css
│   │   ├── js/  auth.js · painel.js · comercial.js · insight.js
│   │   ├── vendor/  chart.umd.js · xlsx.full.min.js   (libs offline)
│   │   └── img/  (logos/ícones)
│   └── dados/
│       ├── performance_mkt.json / .js        🔴 texto puro (entrada da cifragem)
│       ├── performance_comercial.json        🔴 texto puro
│       ├── performance_mkt_enc.js            ← CIFRADO (é o que o front consome)
│       ├── performance_comercial_enc.js      ← CIFRADO
│       └── ultima_atualizacao.json           (só data, público)
│
├── scripts/                        ← pipeline de dados (Python) + utilidades
│   ├── atualizar_painel.py         ← pipeline MKT (bases → performance_mkt.json)
│   ├── comercial_pipeline.py       ← pipeline COMERCIAL (bases → performance_comercial.json)
│   ├── cifrar_areas.py             ← cifra os JSON por usuário (envelope AES-256-GCM)
│   ├── aplicar_versao.py           ← cache-busting (?v=hash nos HTMLs)
│   ├── comparar_atualizacao.py     ← delta vs último deploy
│   └── atualizar_bases.ps1         ← refresh PowerQuery dos xlsx (interno Agroadvance)
│
└── cloudflare-worker/              ← proxy de IA (OpenAI) para o botão "Insight" (insight.js)
```

> Não inclui: `.git/` (histórico — está no GitHub), caches Python, e scripts temporários de análise.

---

## 3. Subir como está (standalone, em 5 min) — para validar antes de integrar

O HUB é estático. Qualquer servidor HTTPS serve. **Web Crypto exige HTTPS ou `localhost`** (não abra via `file://`).

```bash
# de dentro da pasta do pacote
npx http-server hub -p 8080      # ou: python -m http.server 8080 -d hub
# acesse http://localhost:8080/
```

**Login:** as credenciais estão em `usuarios.local.json` (campo `usuario` / `senha`). Cada usuário só abre as áreas listadas em `areas`. Ex.: o usuário `admin` abre tudo.

Se renderizou os gráficos após o login, está 100%.

---

## 4. Arquitetura atual (fluxo de dados)

```
[4 bases .xlsx]  --(PowerQuery/SharePoint, interno)-->  bases/*.xlsx
       |
       v   scripts/atualizar_painel.py  +  scripts/comercial_pipeline.py  (pandas)
[hub/dados/performance_*.json]   (texto puro, gitignored)
       |
       v   scripts/cifrar_areas.py   (envelope AES-256-GCM por usuário)
[hub/dados/performance_*_enc.js]  (window.PAINEL_ENC_<AREA> = {...})
       |
       v   scripts/aplicar_versao.py  (?v=hash) + git push
[GitHub Pages]  -->  navegador: login (auth.js) -> descriptografa -> Chart.js renderiza
```

O `Atualizar HUB MKT.bat` encadeia tudo isso num clique (Windows, na máquina do Lucas).

### Segurança hoje (client-side)
- Cada **área** tem uma DEK aleatória (AES-256-GCM) que cifra o JSON.
- Para cada **usuário** autorizado, a DEK é "embrulhada" com uma chave derivada da senha (**PBKDF2-SHA256, 310.000 iterações**) → um "envelope".
- Publica-se: dado cifrado + lista de envelopes. **A senha nunca vai pro site**; o usuário é gravado **hasheado (SHA-256)**.
- Cada build gera **DEK nova** → caches/links antigos param de funcionar (revogação efetiva). Por isso, ao recifrar, todos relogam 1x.
- Implementação: cifragem em `scripts/cifrar_areas.py`; abertura no browser em `hub/assets/js/auth.js` (Web Crypto API).

> Esse esquema foi feito porque o GitHub Pages **não tem backend**. **Na intranet, com login real + backend, ele pode (e deve) ser substituído** — ver seção 6.

---

## 5. As bases e o pipeline (para manter os dados atualizados)

As 4 bases vêm do PowerQuery conectado ao SharePoint da Agroadvance (passo `atualizar_bases.ps1`, **interno** — não vai funcionar fora da rede da empresa). Fora daqui, o dev pode rodar o pipeline **direto sobre os `.xlsx` incluídos**:

```bash
pip install pandas openpyxl cryptography
python scripts/atualizar_painel.py        # gera performance_mkt.json
python scripts/comercial_pipeline.py      # gera performance_comercial.json
python scripts/cifrar_areas.py            # cifra (lê usuarios.local.json)
python scripts/aplicar_versao.py          # cache-busting nos HTMLs
```

- **Classificação de curso/área** depende de `bases/DE_PARA Global.xlsx` (aba de identificadores RD → Grupo/Curso/Conteúdo). É config, não PII — mantenha junto.
- Regras de negócio importantes já consolidadas no código (ler comentários):
  - Curso de um negócio vem da cascata **`Negócio - Turma` → `Negócio - Curso` → `Negócio - Nome do produto`** (nunca "Produto de Interesse").
  - **Vendas por SDR** são deal-centric, carimbadas no **mês do ganho** (`comercial_pipeline.py`, seção "(5) VENDAS ATRIBUÍDAS").
  - Vendas com R$ 0 = indicações/cortesias (não contam no win rate).

### Contrato de dados (o formato do JSON que o front consome)
- **Comercial:** documentado chave-a-chave em **`CONTRATO_DADOS_COMERCIAL.md`** (leitura obrigatória se for reimplementar o backend). ⚠️ Esse contrato está quase completo, mas foi adicionado recentemente o campo **`sdr_vendas_mensal[]`** (`{sdr, tipo, ano, mes, vendas, fat}` — vendas atribuídas ao SDR por mês de ganho); considere ao reproduzir o schema.
- **MKT:** o formato está descrito no `README.md` e é autoexplicativo no `performance_mkt.json` (séries diárias/mensais, por curso, por fonte, por canal, rankings de criativos).

---

## 6. 🎯 Plano de migração para a intranet (recomendado)

Premissas confirmadas com o time da intranet (sessão anterior): a intranet é uma **SPA (React) + backend (Fastify) + Postgres + JWT/RBAC**, com **CSP restrito (`connect-src 'self'`)**, HTTPS no edge (Cloudflare) e automações via **n8n**.

A abordagem sugerida é **strangler** (migrar por partes, sem big-bang):

### 6.1 O que REUTILIZAR quase como está
- **Toda a camada visual e de lógica de gráfico:** `theme.css`, `painel.js`, `comercial.js`, e o HTML das telas. É vanilla JS + Chart.js — encapsule cada painel como um componente/rota da SPA (um wrapper React que injeta o container e chama a função de render existente, ou porte incremental).
- **A modelagem de métricas** (definições, fórmulas, regras de agregação) — está em `CONTRATO_DADOS_COMERCIAL.md` e nos pipelines Python. Não reinvente as regras; reaproveite.

### 6.2 O que DESCARTAR (a intranet já resolve)
- **`auth.js` + cifragem de dados (`cifrar_areas.py`, `*_enc.js`)** → substituir pelo **JWT/RBAC** da intranet. Os dados deixam de ser cifrados no cliente: o backend serve só o que o papel do usuário pode ver. Os painéis passam a fazer `fetch('/api/hub/...')` em vez de ler `window.PAINEL_ENC_*`.
- **Cloudflare Worker (`cloudflare-worker/`)** → o botão "Insight" (IA) hoje chama a OpenAI via proxy. Com **CSP `connect-src 'self'`, o browser não pode chamar serviço externo** — então a IA tem que passar pelo backend/**n8n**: o front chama `/api/hub/insight`, o backend repassa ao n8n (que fala com o provedor de IA e guarda a chave). Ver `insight.js` para o payload que ele monta hoje.

### 6.3 Dados: pipeline Python → Postgres
A intranet não roda Python no servidor. Duas opções (a decidir com o time):
- **(A) Python local → Postgres:** o Lucas continua rodando o pipeline na máquina dele (sobre as bases do SharePoint) e o script faz `INSERT/UPSERT` direto nas tabelas do Postgres da intranet (via `psycopg`). Mais simples de começar.
- **(B) Python local → endpoint de ingestão:** o pipeline faz `POST /api/hub/ingest` (autenticado por token de serviço) com o JSON; o backend valida e grava no Postgres. Mais desacoplado e auditável.
> Recomendação: começar com (A) para validar rápido e evoluir para (B). **Essa é a principal decisão de arquitetura ainda em aberto.**

O backend então expõe os mesmos "contratos" de hoje como endpoints REST (um por payload do contrato), e o front consome. Como o **formato do JSON não muda**, os painéis quase não mudam — só a origem dos dados (de `window.PAINEL_ENC_*` para `fetch`).

### 6.4 Ordem sugerida
1. Subir o HUB estático como está, atrás do login da intranet (iframe/subrota) — valor imediato.
2. Trocar a fonte de dados de cada painel (enc.js → API/Postgres), um por vez.
3. Migrar o "Insight" de Cloudflare Worker → n8n.
4. Aposentar `auth.js`/cifragem quando o RBAC cobrir 100%.

---

## 7. Dependências e requisitos

- **Servir o site:** qualquer host estático com **HTTPS** (Web Crypto não roda em `file://`). Em `localhost` funciona sem HTTPS.
- **Rodar o pipeline:** Python 3.10+ com `pandas`, `openpyxl`, `cryptography`. Excel só é necessário para o passo de refresh do SharePoint (interno).
- **Navegadores:** modernos (Web Crypto API, Chart.js). Sem IE.

---

## 8. Checklist de subida

- [ ] Recebi o pacote por canal seguro e li a seção 0 (segurança).
- [ ] Servi `hub/` por HTTPS/localhost e consegui logar (credenciais em `usuarios.local.json`).
- [ ] Confirmei que os 3 painéis renderizam (home, MKT, Comercial abas SDR/Closer).
- [ ] Li `CONTRATO_DADOS_COMERCIAL.md` (formato dos dados).
- [ ] Decidi com o time a estratégia de dados (6.3 A ou B).
- [ ] Planejei a troca de auth (client-side → JWT/RBAC) e da IA (Worker → n8n).
- [ ] **Após migrar: rotacionei as senhas e removi as bases/segredos do ambiente do dev.**

---

🌾 **Agroadvance** — HUB de Inteligência. Dúvidas: lucas.moura@agroadvance.com.br
