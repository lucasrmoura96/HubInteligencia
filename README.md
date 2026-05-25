# HUB de Inteligência — Agroadvance

Painel de Performance & Marketing consumindo 4 bases corporativas
(Pipedrive Atividades & Negócios, Investimento Gerenciadores Mkt, RD Station V2).

## 🚀 Fluxo de atualização (1 clique)

Toda atualização do painel é feita por **um único arquivo**:

```
Atualizar HUB MKT.bat
```

Ao executar, ele faz **4 passos automáticos**:

1. **[Refresh]** Abre cada `.xlsx` em `bases/` em background (Excel invisível),
   roda **Atualizar Tudo** (PowerQuery → SharePoint), salva e fecha.
2. **[Pipeline]** Roda `scripts/atualizar_painel.py` que valida schema das
   colunas e regenera o JSON consumido pelo front.
3. **[Delta]** Compara o JSON novo com a versão do último commit e mostra
   quantos leads, MQLs, vendas e custo cresceram desde o último deploy.
4. **[Deploy]** Git add / commit / push para `main` → GitHub Pages publica em
   ~30-60s.

🌐 **URL pública**: <https://lucasrmoura96.github.io/HubInteligencia/hub/>

## 📁 Estrutura

```
PAINEL MKT/
│
├── 🎯 Atualizar HUB MKT.bat        ← clica aqui pra atualizar tudo
├── 📘 README.md
│
├── 📂 bases/                       ← 4 planilhas-fonte (NÃO commitadas)
│   ├── Atividades B2C Pipedrive.xlsx
│   ├── Negócios B2C Pipedrive.xlsx
│   ├── Investimento Gerenciadores Mkt.xlsx
│   └── RD Station V2.xlsx
│
├── 🌐 hub/                         ← painel estático (commitado, vai pro GitHub Pages)
│   ├── index.html
│   ├── area-mkt.html
│   ├── performance-mkt.html
│   ├── assets/
│   │   ├── css/theme.css
│   │   ├── js/painel.js
│   │   ├── vendor/                 ← Chart.js + xlsx (offline)
│   │   └── img/
│   └── dados/                      ← JSON gerado pelo pipeline
│       ├── performance_mkt.json
│       ├── performance_mkt.js
│       └── ultima_atualizacao.json
│
├── ⚙️ scripts/
│   ├── atualizar_bases.ps1         ← refresh PowerQuery dos 4 xlsx
│   ├── atualizar_painel.py         ← pipeline pandas
│   └── comparar_atualizacao.py     ← delta vs último commit
│
└── 📦 _arquivado/                  ← legado (App Juntar RD, ignorado pelo git)
```

### Como atualizar as bases

**Não precisa abrir nada manualmente** — só clique em `Atualizar HUB MKT.bat`.

O `.bat` cuida sozinho de:
- Abrir os 4 xlsx em background (Excel invisível)
- Disparar "Atualizar Tudo" (PowerQuery)
- Salvar e fechar
- Rodar o pipeline e fazer deploy

**Pré-requisitos**:
- Microsoft Excel instalado (qualquer versão 2016+)
- Nenhum dos xlsx pode estar aberto manualmente quando o bat rodar

## 🔧 Dependências locais

- **Python 3.10+** (pandas, openpyxl)
- **git** configurado com autenticação (PAT ou SSH)

Instalação one-shot das libs Python:
```bash
pip install pandas openpyxl
```

## 🔄 Como funciona o pipeline

1. Lê os 4 xlsx da raiz da pasta (procura por prefixo, ignora sufixo de versão).
2. Valida que cada base tem as colunas obrigatórias (lista em `COLUNAS_OBRIGATORIAS`).
3. Calcula atribuição multi-touch (Topo assiste, Fundo fecha).
4. Agrega séries diárias, mensais, por curso, por fonte, por canal.
5. Constrói rankings de criativos (Top 5 / Bottom 5 com `leads >= 100`).
6. Gera `hub/dados/performance_mkt.json` (~1 MB) + versão `.js` (fallback offline).

## ⚠️ Em caso de erro

| Erro | Causa provável | Solução |
|---|---|---|
| `ERRO DE SCHEMA — coluna X faltando` | Pipedrive ou RD renomeou um campo | Renomear de volta no SharePoint ou ajustar `COLUNAS_OBRIGATORIAS` |
| `Algum xlsx ainda aberto` | Excel travado | Fechar o arquivo e rodar de novo |
| `ERRO no push` | Sem autenticação git | Configurar PAT ou SSH (`git config --global ...`) |

---

🌾 **Agroadvance** — desenvolvido com auxílio de Claude Code.
