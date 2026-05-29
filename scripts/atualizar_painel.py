"""
HUB AGROADVANCE — Pipeline de dados
Lê os 4 Excels da pasta PAINEL MKT e gera o JSON consumido pelo painel.

Bases consumidas:
  - Atividades B2C Pipedrive.xlsx
  - Negócios B2C Pipedrive.xlsx
  - Investimento Gerenciadores Mkt.xlsx
  - RD Station V2.xlsx  (NUNCA usar V1)

Saída:
  - hub/dados/performance_mkt.json
  - hub/dados/ultima_atualizacao.json
"""

import json
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import pandas as pd

warnings.filterwarnings("ignore")

# ----------------------------------------------------------------------------
# Caminhos
# ----------------------------------------------------------------------------
BASE = Path(__file__).resolve().parent.parent
PASTA_BASES = BASE / "bases"          # pasta das 4 planilhas-fonte
PASTA_SAIDA = BASE / "hub" / "dados"  # JSON gerado pelo pipeline
PASTA_SAIDA.mkdir(parents=True, exist_ok=True)

def encontra_xlsx(prefixo: str) -> Path:
    """Encontra o arquivo mais recente que começa com o prefixo (independente de sufixo de versão).

    Procura primeiro em bases/, depois na raiz (compatibilidade com layout antigo).
    """
    # 1) bases/ (layout atual)
    candidatos = sorted(
        PASTA_BASES.glob(f"{prefixo}*.xlsx"),
        key=lambda p: p.stat().st_mtime, reverse=True
    )
    # 2) Fallback: raiz (layout legado pré 2026-05-25)
    if not candidatos:
        candidatos = sorted(
            BASE.glob(f"{prefixo}*.xlsx"),
            key=lambda p: p.stat().st_mtime, reverse=True
        )
    if not candidatos:
        raise FileNotFoundError(
            f"Nenhum arquivo encontrado começando com '{prefixo}'.\n"
            f"  Verifique se o arquivo está em: {PASTA_BASES}"
        )
    return candidatos[0]


ARQ_ATIV = encontra_xlsx("Atividades B2C Pipedrive")
ARQ_NEG = encontra_xlsx("Negócios B2C Pipedrive")
ARQ_INV = encontra_xlsx("Investimento Gerenciadores Mkt")
ARQ_RD = encontra_xlsx("RD Station V2")

# Período padrão do painel
ANO_INI = 2025
ANO_FIM = 2026

# Filtro mínimo do ranking de criativos (definido com cliente em 2026-05-21):
# Topo: somente leads >= 100 (sem requisito de investimento)
# Fundo: leads >= 100 AND custo >= R$ 1
MIN_LEADS_RANKING = 100
MIN_CUSTO_FUNDO_RANKING = 1.00


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def safe_div(a, b):
    return (a / b) if b else 0.0


def to_pct(a, b, casas=1):
    return round(safe_div(a, b) * 100, casas)


def normaliza_fonte_inv_para_rd(fonte_inv: str) -> str:
    """Investimento usa 'Meta', RD V2 usa 'Meta Ads'. Aqui padronizo."""
    if pd.isna(fonte_inv):
        return "Desconhecido"
    f = str(fonte_inv).strip().lower()
    mapa = {
        "meta": "Meta Ads",
        "google": "Google Ads",
        "linkedin": "LinkedIn Ads",
        "microsoft": "Microsoft Ads",
    }
    return mapa.get(f, str(fonte_inv).strip())


def extrai_utm(detalhes: str, chave: str) -> str:
    """Extrai um parâmetro UTM do JSON 'Origem da Conversão - Detalhes'."""
    if pd.isna(detalhes):
        return None
    s = str(detalhes)
    m = re.search(rf"utm_{chave}=([^\\\"&]+)", s)
    if not m:
        return None
    try:
        return unquote(m.group(1)).strip()
    except Exception:
        return m.group(1).strip()


def serie_diaria(df: pd.DataFrame, col_data: str, col_valor: str = None) -> list:
    """Gera lista [{data, valor}] agregada por dia."""
    if df.empty:
        return []
    g = df.copy()
    g[col_data] = pd.to_datetime(g[col_data], errors="coerce")
    g = g.dropna(subset=[col_data])
    if col_valor:
        s = g.groupby(g[col_data].dt.date)[col_valor].sum()
    else:
        s = g.groupby(g[col_data].dt.date).size()
    return [{"data": str(d), "valor": float(v)} for d, v in s.items()]


def top_n(df: pd.DataFrame, col: str, n: int = 15) -> list:
    if df.empty or col not in df.columns:
        return []
    vc = df[col].value_counts().head(n)
    return [{"label": str(k), "valor": int(v)} for k, v in vc.items()]


# ----------------------------------------------------------------------------
# Carregamento das bases
# ----------------------------------------------------------------------------
# Colunas mínimas obrigatórias por base — se faltar, pipeline falha imediatamente
# com mensagem clara em vez de KeyError críptico no meio do processamento.
COLUNAS_OBRIGATORIAS = {
    "Atividades": [
        "Atividade - Atualizado em",
        "Atividade - Data e hora de conclusão",
        "Atividade - Data adicionada",            # data oficial da reunião (gestor 2026-05-25)
        "Atividade - Tipo",
        "Atividade - Concluído",
        "Atividade - ID",
        "Negócio - ID",
        "Negócio - Proprietário SDR",
    ],
    "Negócios": [
        "Negócio - ID",
        "Negócio - Status",
        "Negócio - Negócio criado em",
        "Negócio - Ganho em",
        "Negócio - Data de perda",
        "Negócio - Valor",
        "Negócio - Qualificação/Feedback:",
        "Pessoa - E-mail - Trabalho",
        "Pessoa - E-mail - Outros",
        "Negócio - Proprietário",
        "Negócio - Produto de Interesse",  # usado pra inferir tipo (MBA/Pós/Imersão)
    ],
    "Investimento": [
        "Data",
        "Fonte",
        "Custo",
        "Grupo",
        "Curso",
        "Campanha",
    ],
    "RD Station": [
        "Data da Conversão",
        "E-mail Lead",
        "Class",
        "Grupo",
        "Curso",
        "Fonte",
        "Identificador",
        "Origem da Conversão - Detalhes",
        "Index",
    ],
}


def valida_schema(df: pd.DataFrame, nome_base: str, arquivo: Path) -> None:
    """Valida que todas as colunas obrigatórias existem no DataFrame.

    Se faltar alguma, levanta SystemExit com mensagem clara (em vez de KeyError críptico).
    """
    obrigatorias = COLUNAS_OBRIGATORIAS.get(nome_base, [])
    df_cols = set(str(c).strip() for c in df.columns)
    faltando = [c for c in obrigatorias if c not in df_cols]
    if faltando:
        log("=" * 60)
        log(f"ERRO DE SCHEMA — base '{nome_base}'")
        log(f"  Arquivo: {arquivo.name}")
        log(f"  Colunas faltando ({len(faltando)}):")
        for c in faltando:
            log(f"    - {c}")
        log("")
        log("  AÇÃO: abra o arquivo no Excel e verifique se essas colunas")
        log("        existem com os nomes exatos (case-sensitive).")
        log("        Se foram renomeadas, ajuste no SharePoint ou no Excel.")
        log("=" * 60)
        raise SystemExit(2)


def carrega_bases():
    log("Lendo Atividades B2C...")
    ativ = pd.read_excel(ARQ_ATIV)
    ativ.columns = [str(c).strip() for c in ativ.columns]
    valida_schema(ativ, "Atividades", ARQ_ATIV)
    ativ["Atividade - Atualizado em"] = pd.to_datetime(ativ["Atividade - Atualizado em"], errors="coerce")
    ativ["Atividade - Data e hora de conclusão"] = pd.to_datetime(
        ativ["Atividade - Data e hora de conclusão"], errors="coerce"
    )
    # Data oficial da reunião (definido com gestor 2026-05-25)
    ativ["Atividade - Data adicionada"] = pd.to_datetime(
        ativ["Atividade - Data adicionada"], errors="coerce"
    )

    log("Lendo Negócios B2C...")
    neg = pd.read_excel(ARQ_NEG)
    neg.columns = [str(c).strip() for c in neg.columns]
    valida_schema(neg, "Negócios", ARQ_NEG)
    neg["Negócio - Negócio criado em"] = pd.to_datetime(neg["Negócio - Negócio criado em"], errors="coerce")
    neg["Negócio - Ganho em"] = pd.to_datetime(neg["Negócio - Ganho em"], errors="coerce")
    neg["Negócio - Data de perda"] = pd.to_datetime(neg["Negócio - Data de perda"], errors="coerce")
    # Filtro por DATA DE FECHAMENTO (auditoria 2026-05-21):
    # - Ganho:   data de Ganho em em 2025-2026
    # - Perdido: Data de perda em 2025-2026
    # - Aberto:  Negócio criado em em 2025-2026 (não tem data de fechamento ainda)
    neg = neg[
        ((neg["Negócio - Status"] == "Ganho") & (neg["Negócio - Ganho em"].dt.year.between(ANO_INI, ANO_FIM)))
        | ((neg["Negócio - Status"] == "Perdido") & (neg["Negócio - Data de perda"].dt.year.between(ANO_INI, ANO_FIM)))
        | ((neg["Negócio - Status"] == "Aberto") & (neg["Negócio - Negócio criado em"].dt.year.between(ANO_INI, ANO_FIM)))
    ].copy()

    log("Lendo Investimento...")
    inv = pd.read_excel(ARQ_INV)
    inv.columns = [str(c).strip() for c in inv.columns]
    valida_schema(inv, "Investimento", ARQ_INV)
    inv["Data"] = pd.to_datetime(inv["Data"], errors="coerce")
    inv["Fonte_norm"] = inv["Fonte"].apply(normaliza_fonte_inv_para_rd)

    log("Lendo RD Station V2...")
    rd = pd.read_excel(ARQ_RD)
    rd.columns = [str(c).strip() for c in rd.columns]
    valida_schema(rd, "RD Station", ARQ_RD)
    rd["Data da Conversão"] = pd.to_datetime(rd["Data da Conversão"], errors="coerce")
    # Extrai utm_campaign e utm_content
    rd["utm_campaign"] = rd["Origem da Conversão - Detalhes"].apply(lambda s: extrai_utm(s, "campaign"))
    rd["utm_content"] = rd["Origem da Conversão - Detalhes"].apply(lambda s: extrai_utm(s, "content"))

    log(
        f"Bases carregadas: Ativ={len(ativ):,} | Neg={len(neg):,} | "
        f"Inv={len(inv):,} | RD={len(rd):,}"
    )
    return ativ, neg, inv, rd


# ----------------------------------------------------------------------------
# ATRIBUIÇÃO Multi-touch (Topo assiste, Fundo fecha)
# ----------------------------------------------------------------------------
def calcula_atribuicao(neg: pd.DataFrame, rd: pd.DataFrame) -> dict:
    """Para cada Ganho do Pipedrive, descobre se o Topo participou da jornada.

    Regra (definida com o cliente em 2026-05-21):
    - Match email Pipedrive (Trabalho OU Outros) com E-mail Lead do RD
    - Conta como 'assistência Topo' se houve QUALQUER conversão com Grupo='Topo'
      ANTES (ou igual) à Data de Ganho do Pipedrive
    - Sem limite de tempo (qualquer passagem anterior conta)
    - Sem match de email → 100% Fundo, Topo zero crédito
    - Ganho real (Venda) é SEMPRE 100% Fundo (não há dupla contagem total)

    Retorna:
      {
        'topo': {
          'assistencia_neg_ids': set[int],          # IDs de Ganhos onde Topo assistiu
          'faturamento_influenciado': float,
          'reunioes_assistidas_ids': set[int]        # IDs de Negócios qualificados onde Topo assistiu
        },
        'fundo': {
          'ganhos_neg_ids': set[int],
          'faturamento_total': float
        },
        'cobertura': {
          'ganhos_total': int,
          'ganhos_com_email': int,
          'ganhos_com_match_rd': int,
          'ganhos_sem_match': int,
        }
      }
    """
    # Indexa RD por email (normalizado)
    rd_clean = rd[['E-mail Lead', 'Data da Conversão', 'Grupo']].dropna(subset=['E-mail Lead']).copy()
    rd_clean['email_norm'] = rd_clean['E-mail Lead'].astype(str).str.lower().str.strip()
    rd_clean = rd_clean[rd_clean['email_norm'] != '']

    # Para cada email -> lista de (data, grupo)
    eventos_por_email = {}
    for _, r in rd_clean.iterrows():
        e = r['email_norm']
        eventos_por_email.setdefault(e, []).append((r['Data da Conversão'], r['Grupo']))

    def emails_do_negocio(row):
        out = []
        for col in ['Pessoa - E-mail - Trabalho', 'Pessoa - E-mail - Outros']:
            val = row.get(col)
            if pd.notna(val):
                e = str(val).lower().strip()
                if e and e != 'nan':
                    # Pode ter múltiplos emails separados por vírgula
                    for sub in e.replace(';', ',').split(','):
                        sub = sub.strip()
                        if sub:
                            out.append(sub)
        return out

    ganhos = neg[neg["Negócio - Status"] == "Ganho"]

    topo_assist_ids = set()
    topo_faturamento = 0.0
    ganhos_com_email = 0
    ganhos_com_match = 0

    for _, row in ganhos.iterrows():
        emails = emails_do_negocio(row)
        if emails:
            ganhos_com_email += 1
        # Procura eventos
        eventos = []
        for e in emails:
            if e in eventos_por_email:
                eventos.extend(eventos_por_email[e])
        if not eventos:
            continue
        ganhos_com_match += 1
        data_ganho = row['Negócio - Ganho em']
        if pd.isna(data_ganho):
            continue
        # Eventos com data válida E anteriores ao ganho
        grupos_antes = set()
        for d, g in eventos:
            if pd.notna(d) and pd.notna(g) and d <= data_ganho:
                grupos_antes.add(g)
        if 'Topo' in grupos_antes:
            topo_assist_ids.add(int(row['Negócio - ID']))
            topo_faturamento += float(row['Negócio - Valor']) if pd.notna(row['Negócio - Valor']) else 0.0

    # Reuniões assistidas pelo Topo: negócios qualificados onde Topo assistiu
    # Critério: o negócio é qualificado (OK ou Check Liderança) E há evento Topo anterior
    quali_status = ["Qualificação OK", "Check Liderança"]
    neg_quali = neg[neg["Negócio - Qualificação/Feedback:"].isin(quali_status)]
    reunioes_assist_ids = set()
    for _, row in neg_quali.iterrows():
        emails = emails_do_negocio(row)
        eventos = []
        for e in emails:
            if e in eventos_por_email:
                eventos.extend(eventos_por_email[e])
        if not eventos:
            continue
        # Usa a maior data de referência possível: Ganho em → Data perda → Criado em
        data_ref = row.get('Negócio - Ganho em')
        if pd.isna(data_ref):
            data_ref = row.get('Negócio - Data de perda')
        if pd.isna(data_ref):
            data_ref = row.get('Negócio - Negócio criado em')
        if pd.isna(data_ref):
            continue
        for d, g in eventos:
            if pd.notna(d) and pd.notna(g) and d <= data_ref and g == 'Topo':
                reunioes_assist_ids.add(int(row['Negócio - ID']))
                break

    return {
        'topo': {
            'assistencia_neg_ids': topo_assist_ids,
            'faturamento_influenciado': round(topo_faturamento, 2),
            'reunioes_assistidas_ids': reunioes_assist_ids,
        },
        'fundo': {
            'ganhos_neg_ids': set(int(x) for x in ganhos['Negócio - ID']),
            'faturamento_total': round(float(ganhos['Negócio - Valor'].sum()), 2),
        },
        'cobertura': {
            'ganhos_total': int(len(ganhos)),
            'ganhos_com_email': int(ganhos_com_email),
            'ganhos_com_match_rd': int(ganhos_com_match),
            'ganhos_sem_match': int(len(ganhos) - ganhos_com_match),
        },
    }


# ----------------------------------------------------------------------------
# KPIs por Grupo (Topo/Fundo)
# ----------------------------------------------------------------------------
def kpis_por_grupo(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> dict:
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    leads = len(rd_g)
    mqls = int((rd_g["Class"] == "MQL").sum())
    custo = float(inv_g["Custo"].sum())
    pct_mql = to_pct(mqls, leads)
    cpl = round(safe_div(custo, leads), 2)
    cpmql = round(safe_div(custo, mqls), 2)

    return {
        "leads": leads,
        "mqls": mqls,
        "pct_mql": pct_mql,
        "custo": round(custo, 2),
        "cpl": cpl,
        "cpmql": cpmql,
    }


def kpis_periodo(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str,
                 dt_ini=None, dt_fim=None) -> dict:
    rd_p = rd[rd["Grupo"] == grupo].copy()
    inv_p = inv[inv["Grupo"] == grupo].copy()
    if dt_ini is not None:
        rd_p = rd_p[rd_p["Data da Conversão"] >= dt_ini]
        inv_p = inv_p[inv_p["Data"] >= dt_ini]
    if dt_fim is not None:
        rd_p = rd_p[rd_p["Data da Conversão"] <= dt_fim]
        inv_p = inv_p[inv_p["Data"] <= dt_fim]

    leads = len(rd_p)
    mqls = int((rd_p["Class"] == "MQL").sum())
    custo = float(inv_p["Custo"].sum())
    return {
        "leads": leads,
        "mqls": mqls,
        "pct_mql": to_pct(mqls, leads),
        "custo": round(custo, 2),
        "cpl": round(safe_div(custo, leads), 2),
        "cpmql": round(safe_div(custo, mqls), 2),
    }


def calcula_comparativos(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str,
                         data_ref: datetime) -> dict:
    """MoM (mês atual vs anterior), YoY (mesmo mês ano anterior), YTD (acum YTD vs YTD ano anterior)."""
    ano, mes = data_ref.year, data_ref.month

    # Mês atual: do dia 1 ao dia atual
    mes_atual_ini = datetime(ano, mes, 1)
    mes_atual_fim = data_ref

    # Mês anterior: mesmo período (dia 1 ao mesmo dia)
    if mes == 1:
        mes_ant_ano, mes_ant = ano - 1, 12
    else:
        mes_ant_ano, mes_ant = ano, mes - 1
    mes_ant_ini = datetime(mes_ant_ano, mes_ant, 1)
    try:
        mes_ant_fim = datetime(mes_ant_ano, mes_ant, data_ref.day)
    except ValueError:
        # último dia válido do mês anterior
        mes_ant_fim = datetime(mes_ant_ano, mes_ant, 28)

    # Mesmo mês ano anterior (YoY)
    yoy_ini = datetime(ano - 1, mes, 1)
    try:
        yoy_fim = datetime(ano - 1, mes, data_ref.day)
    except ValueError:
        yoy_fim = datetime(ano - 1, mes, 28)

    # YTD atual vs YTD ano anterior
    ytd_ini = datetime(ano, 1, 1)
    ytd_fim = data_ref
    ytd_ant_ini = datetime(ano - 1, 1, 1)
    try:
        ytd_ant_fim = datetime(ano - 1, mes, data_ref.day)
    except ValueError:
        ytd_ant_fim = datetime(ano - 1, mes, 28)

    return {
        "mes_atual": kpis_periodo(rd, inv, grupo, mes_atual_ini, mes_atual_fim),
        "mes_anterior": kpis_periodo(rd, inv, grupo, mes_ant_ini, mes_ant_fim),
        "mesmo_mes_ano_anterior": kpis_periodo(rd, inv, grupo, yoy_ini, yoy_fim),
        "ytd_atual": kpis_periodo(rd, inv, grupo, ytd_ini, ytd_fim),
        "ytd_ano_anterior": kpis_periodo(rd, inv, grupo, ytd_ant_ini, ytd_ant_fim),
        "ref": {
            "ano": ano, "mes": mes, "dia": data_ref.day,
            "data_referencia": data_ref.strftime("%Y-%m-%d"),
        },
    }


# ----------------------------------------------------------------------------
# Ranking de criativos com drill-down
# ----------------------------------------------------------------------------
def todas_campanhas(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Retorna TODAS as campanhas (não só top/bottom 5) para a tabela e cross-filter.

    Cada campanha tem: leads, mqls, %MQL, custo, ganhos (vazio aqui — vem só para Fundo no global),
    fontes (lista) e criativos por fonte (drill-down).
    """
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    rd_g["campanha_chave"] = rd_g["utm_campaign"].fillna("").str.strip()
    rd_g.loc[rd_g["campanha_chave"] == "", "campanha_chave"] = rd_g["Identificador"].fillna("Não identificado")

    # Custo por campanha (normalizado)
    inv_g["camp_norm"] = inv_g["Campanha"].fillna("").str.strip()
    custo_por_camp = inv_g.groupby("camp_norm")["Custo"].sum().to_dict()

    def busca_custo(camp):
        if not camp:
            return 0.0
        if camp in custo_por_camp:
            return float(custo_por_camp[camp])
        c_norm = re.sub(r"[\s_]+", "", camp.lower())
        for k, v in custo_por_camp.items():
            if re.sub(r"[\s_]+", "", k.lower()) == c_norm:
                return float(v)
        return 0.0

    # Agrega por campanha
    g = rd_g.groupby("campanha_chave").agg(
        leads=("Index", "count"),
        mqls=("Class", lambda x: (x == "MQL").sum()),
    ).reset_index()
    g["custo"] = g["campanha_chave"].apply(busca_custo)
    g["pct_mql"] = (g["mqls"] / g["leads"] * 100).round(1)

    out = []
    for _, row in g.iterrows():
        campanha = row["campanha_chave"]
        sub = rd_g[rd_g["campanha_chave"] == campanha]

        # Cursos relacionados (top 3)
        cursos = sub["Curso"].value_counts().head(3).index.tolist()

        # Fontes + criativos
        fontes = []
        for fonte, sub_f in sub.groupby("Fonte"):
            if pd.isna(fonte):
                continue
            l = len(sub_f); m = int((sub_f["Class"] == "MQL").sum())
            c = float(inv_g[(inv_g["camp_norm"] == campanha) & (inv_g["Fonte_norm"] == fonte)]["Custo"].sum())
            criativos = []
            for crt, sub_c in sub_f.groupby("utm_content"):
                if pd.isna(crt) or not str(crt).strip():
                    continue
                cl = len(sub_c); cm = int((sub_c["Class"] == "MQL").sum())
                criativos.append({
                    "criativo": str(crt), "leads": cl, "mqls": cm,
                    "pct_mql": to_pct(cm, cl), "custo": 0.0,
                })
            criativos.sort(key=lambda x: x["pct_mql"], reverse=True)
            fontes.append({
                "fonte": str(fonte), "leads": l, "mqls": m,
                "pct_mql": to_pct(m, l), "custo": round(c, 2), "criativos": criativos,
            })
        fontes.sort(key=lambda x: x["leads"], reverse=True)

        out.append({
            "campanha": campanha,
            "leads": int(row["leads"]),
            "mqls": int(row["mqls"]),
            "pct_mql": float(row["pct_mql"]),
            "custo": round(float(row["custo"]), 2),
            "cursos": cursos,
            "fontes": fontes,
        })

    # Ordena por leads desc
    out.sort(key=lambda x: x["leads"], reverse=True)
    return out


def constroi_ranking(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> dict:
    """Retorna top5 e bottom5 de campanhas por %MQL, com drill Fonte→Criativo."""
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    # Campanha no RD vem do utm_campaign (limpo) ou Identificador como fallback
    rd_g["campanha_chave"] = rd_g["utm_campaign"].fillna("").str.strip()
    # Fallback: se vazio, usar Identificador
    rd_g.loc[rd_g["campanha_chave"] == "", "campanha_chave"] = rd_g["Identificador"].fillna("Não identificado")

    # Agrega leads/mqls por campanha
    g = rd_g.groupby("campanha_chave").agg(
        leads=("Index", "count"),
        mqls=("Class", lambda x: (x == "MQL").sum()),
    ).reset_index()

    # Custo: tenta casar via Campanha == campanha_chave (normalização leve)
    inv_g["camp_norm"] = inv_g["Campanha"].fillna("").str.strip()
    custo_por_camp = inv_g.groupby("camp_norm")["Custo"].sum().to_dict()

    def busca_custo(camp):
        if not camp:
            return 0.0
        # match direto
        if camp in custo_por_camp:
            return float(custo_por_camp[camp])
        # match normalizado (lowercase, sem espaços/underscores)
        c_norm = re.sub(r"[\s_]+", "", camp.lower())
        for k, v in custo_por_camp.items():
            if re.sub(r"[\s_]+", "", k.lower()) == c_norm:
                return float(v)
        return 0.0

    g["custo"] = g["campanha_chave"].apply(busca_custo)
    g["pct_mql"] = (g["mqls"] / g["leads"] * 100).round(1)

    # Filtro mínimo por grupo (cliente 2026-05-21):
    # Topo: somente leads >= 100
    # Fundo: leads >= 100 AND custo >= R$ 1
    if grupo == "Topo":
        g = g[g["leads"] >= MIN_LEADS_RANKING].copy()
    else:
        g = g[(g["leads"] >= MIN_LEADS_RANKING) & (g["custo"] >= MIN_CUSTO_FUNDO_RANKING)].copy()

    # Ordena
    g_top = g.sort_values(["pct_mql", "leads"], ascending=[False, False]).head(5)
    g_bot = g.sort_values(["pct_mql", "custo"], ascending=[True, False]).head(5)

    def detalha_drilldown(campanha):
        sub = rd_g[rd_g["campanha_chave"] == campanha]
        # Nível 2: por Fonte
        fontes = []
        for fonte, sub_f in sub.groupby("Fonte"):
            if pd.isna(fonte):
                continue
            l = len(sub_f)
            m = int((sub_f["Class"] == "MQL").sum())
            # Custo da fonte na campanha
            c = float(
                inv_g[(inv_g["camp_norm"] == campanha) & (inv_g["Fonte_norm"] == fonte)]["Custo"].sum()
            )
            # Nível 3: criativos (utm_content)
            criativos = []
            for crt, sub_c in sub_f.groupby("utm_content"):
                if pd.isna(crt) or not str(crt).strip():
                    continue
                cl = len(sub_c)
                cm = int((sub_c["Class"] == "MQL").sum())
                criativos.append({
                    "criativo": str(crt),
                    "leads": cl,
                    "mqls": cm,
                    "pct_mql": to_pct(cm, cl),
                    "custo": 0.0,  # custo por criativo não está disponível direto no Investimento
                })
            criativos.sort(key=lambda x: x["pct_mql"], reverse=True)
            fontes.append({
                "fonte": str(fonte),
                "leads": l,
                "mqls": m,
                "pct_mql": to_pct(m, l),
                "custo": round(c, 2),
                "criativos": criativos[:10],
            })
        fontes.sort(key=lambda x: x["pct_mql"], reverse=True)
        return fontes

    def serializa(df_rank, posicao_inicial=1):
        out = []
        for i, (_, row) in enumerate(df_rank.iterrows(), start=posicao_inicial):
            out.append({
                "posicao": i,
                "campanha": row["campanha_chave"],
                "leads": int(row["leads"]),
                "mqls": int(row["mqls"]),
                "pct_mql": float(row["pct_mql"]),
                "custo": round(float(row["custo"]), 2),
                "fontes": detalha_drilldown(row["campanha_chave"]),
            })
        return out

    return {
        "top5": serializa(g_top),
        "bottom5": serializa(g_bot),
        "total_campanhas_avaliadas": int(len(g)),
        "filtro_minimo": {
            "leads": MIN_LEADS_RANKING,
            "custo": MIN_CUSTO_FUNDO_RANKING if grupo == "Fundo" else None,
            "regra": (
                f"Leads >= {MIN_LEADS_RANKING} (sem requisito de custo)" if grupo == "Topo"
                else f"Leads >= {MIN_LEADS_RANKING} E Custo >= R$ {MIN_CUSTO_FUNDO_RANKING:.2f}"
            ),
        },
    }


# ----------------------------------------------------------------------------
# Agregado REAL por Curso (para cross-filter correto — corrige C5 da auditoria)
# ----------------------------------------------------------------------------
def agregado_por_curso(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Agrega leads/MQLs/custo POR Curso real (não via top 3 das campanhas).

    Custo por curso: agrega da base Investimento usando Curso.
    """
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    custo_por_curso = inv_g.groupby("Curso")["Custo"].sum().to_dict()

    g = rd_g.groupby("Curso").agg(
        leads=("Index", "count"),
        mqls=("Class", lambda x: (x == "MQL").sum()),
    ).reset_index()

    out = []
    for _, r in g.iterrows():
        curso = r["Curso"]
        if pd.isna(curso):
            continue
        custo = float(custo_por_curso.get(curso, 0.0))
        out.append({
            "curso": str(curso),
            "leads": int(r["leads"]),
            "mqls": int(r["mqls"]),
            "pct_mql": to_pct(r["mqls"], r["leads"]),
            "custo": round(custo, 2),
            "cpl": round(safe_div(custo, r["leads"]), 2),
            "cpmql": round(safe_div(custo, r["mqls"]), 2),
        })
    out.sort(key=lambda x: x["leads"], reverse=True)
    return out


# ----------------------------------------------------------------------------
# Normalização: descobre o tipo (mba/pos/imersoes/outros) a partir do nome do curso.
# Espelha a função getCursoTipo() do JS para consistência entre back e front.
# ----------------------------------------------------------------------------
def normaliza_tipo_curso(curso) -> str:
    if pd.isna(curso) or not str(curso).strip():
        return "outros"
    import unicodedata
    c = str(curso).strip().lower()
    c = ''.join(ch for ch in unicodedata.normalize('NFD', c) if unicodedata.category(ch) != 'Mn')
    if c.startswith('mba'):
        return 'mba'
    if 'imersao' in c:
        return 'imersoes'
    if c.startswith('pos'):
        return 'pos'
    return 'outros'


# ----------------------------------------------------------------------------
# Atribuição multi-camada do tipo de curso para cada Negócio.
# Maximiza cobertura E precisão usando 4 fontes em ordem de prioridade:
#   A) Negócio - Curso             (89% pra ganhos — source of truth do que foi vendido)
#   B) Negócio - Nome do produto   (88% pra ganhos — backup)
#   C) Negócio - Produto de Interesse (60-91% — bom pra abertos/perdidos)
#   D) RD Station via email do lead (99% — fallback robusto)
#   E) "outros"                    (último recurso)
# ----------------------------------------------------------------------------
def atribui_tipos_negocios(neg: pd.DataFrame, rd: pd.DataFrame):
    """Retorna DataFrame neg com colunas extras: _tipo e _camada (auditoria).

    _tipo: 'mba' | 'pos' | 'imersoes' | 'outros'
    _camada: 'A_curso' | 'B_produto' | 'C_interesse' | 'D_rd_email' | 'E_outros'
    """
    n = neg.copy()

    # Pré-processa RD: para cada email, qual o tipo mais frequente?
    rd_clean = rd[['E-mail Lead', 'Curso']].dropna(subset=['E-mail Lead']).copy()
    rd_clean['email_norm'] = rd_clean['E-mail Lead'].astype(str).str.lower().str.strip()
    rd_clean = rd_clean[rd_clean['email_norm'] != '']
    rd_clean['_tipo'] = rd_clean['Curso'].apply(normaliza_tipo_curso)

    # Para cada email: tipo mais frequente (excluindo 'outros' se houver alternativa)
    email_tipo = {}
    for email, grp in rd_clean.groupby('email_norm'):
        contagem = grp['_tipo'].value_counts()
        # Se há tipos != 'outros', escolhe o mais frequente entre os classificados
        bons = contagem[contagem.index != 'outros']
        if len(bons) > 0:
            email_tipo[email] = bons.idxmax()
        else:
            email_tipo[email] = 'outros'

    # Função que extrai emails de um negócio (Trabalho + Outros)
    def emails_do_negocio(row):
        out = []
        for col in ['Pessoa - E-mail - Trabalho', 'Pessoa - E-mail - Outros']:
            val = row.get(col)
            if pd.notna(val):
                for sub in str(val).replace(';', ',').split(','):
                    sub = sub.strip().lower()
                    if sub:
                        out.append(sub)
        return out

    # Aplica camadas em ordem
    tipos = []
    camadas = []
    for _, row in n.iterrows():
        # Camada A: Negócio - Curso
        t = normaliza_tipo_curso(row.get('Negócio - Curso'))
        if t != 'outros':
            tipos.append(t); camadas.append('A_curso'); continue

        # Camada B: Negócio - Nome do produto
        t = normaliza_tipo_curso(row.get('Negócio - Nome do produto'))
        if t != 'outros':
            tipos.append(t); camadas.append('B_produto'); continue

        # Camada C: Negócio - Produto de Interesse
        t = normaliza_tipo_curso(row.get('Negócio - Produto de Interesse'))
        if t != 'outros':
            tipos.append(t); camadas.append('C_interesse'); continue

        # Camada D: RD Station via email
        emails = emails_do_negocio(row)
        t_rd = 'outros'
        for e in emails:
            if e in email_tipo:
                cand = email_tipo[e]
                if cand != 'outros':
                    t_rd = cand
                    break
        if t_rd != 'outros':
            tipos.append(t_rd); camadas.append('D_rd_email'); continue

        # Camada E: outros (sem fonte boa)
        tipos.append('outros'); camadas.append('E_outros')

    n['_tipo'] = tipos
    n['_camada'] = camadas

    # Log de auditoria: cobertura por status + camada
    log("  Atribuição de tipo — auditoria de cobertura:")
    for status in ['Ganho', 'Perdido', 'Aberto']:
        sub = n[n['Negócio - Status'] == status]
        if len(sub) == 0: continue
        classif = (sub['_tipo'] != 'outros').sum()
        cob = classif / len(sub) * 100
        log(f"    {status:<10} {classif:>6,}/{len(sub):<6} classificados ({cob:.1f}%)")
    log("  Distribuição por camada:")
    for cam, qtd in n['_camada'].value_counts().items():
        log(f"    {cam:<14} {qtd:>6,}")

    return n


# ----------------------------------------------------------------------------
# Agregado por Tipo × Mês — cruza tipo de curso com financeiro (E6-05)
# Permite que o JS preencha Reuniões, Matrículas, ROAS, Faturamento, CPA
# ao filtrar por tipo (MBA/Pós/Imersões) em vez de mostrar "—".
#
# Fonte do tipo:
#   - Negócios: coluna "Negócio - Produto de Interesse" (65% preench, 24 únicos)
#     com fallback para "Negócio - Curso"
#   - Atividades: herdam o tipo via Negócio - ID -> Negócios
# ----------------------------------------------------------------------------
def por_tipo_curso_mensal(rd, neg_classificado, ativ, grupo, atribuicao) -> list:
    """Espera neg_classificado já com colunas _tipo e _camada (de atribui_tipos_negocios)."""
    n = neg_classificado

    if grupo == "Fundo":
        ganhos_ids = atribuicao["fundo"]["ganhos_neg_ids"]
        reu_referencia_ids = set(
            n.loc[n["Negócio - Qualificação/Feedback:"].isin(["Qualificação OK", "Check Liderança"]),
                  "Negócio - ID"].astype(int)
        )
    else:
        ganhos_ids = atribuicao["topo"]["assistencia_neg_ids"]
        reu_referencia_ids = atribuicao["topo"]["reunioes_assistidas_ids"]

    # Ganhos atribuídos a este grupo, com data e tipo
    neg_ganho = n[(n["Negócio - Status"] == "Ganho")
                  & (n["Negócio - ID"].astype(int).isin(ganhos_ids))].copy()
    neg_ganho["AnoMes"] = neg_ganho["Negócio - Ganho em"].dt.to_period("M").astype(str)

    # Atividades-reunião concluídas em negócios qualificados, com tipo herdado
    neg_tipo_map = dict(zip(n["Negócio - ID"].astype(int), n["_tipo"]))
    ativ_reu = ativ[
        ativ["Atividade - Tipo"].str.contains("Reunião", case=False, na=False)
        & (ativ["Atividade - Concluído"] == "Concluído")
    ].copy()
    ativ_reu = ativ_reu[ativ_reu["Negócio - ID"].astype(int).isin(reu_referencia_ids)]
    ativ_reu["_tipo"] = ativ_reu["Negócio - ID"].astype(int).map(neg_tipo_map).fillna("outros")
    # Data oficial da reunião: "Atividade - Data adicionada" (gestor 2026-05-25)
    # Fallback: Data e hora de conclusão; depois Atualizado em
    ativ_reu["data_atv"] = ativ_reu["Atividade - Data adicionada"].fillna(
        ativ_reu["Atividade - Data e hora de conclusão"]
    ).fillna(ativ_reu["Atividade - Atualizado em"])
    ativ_reu["AnoMes"] = ativ_reu["data_atv"].dt.to_period("M").astype(str)

    out = []
    meses_universo = sorted(
        set(neg_ganho["AnoMes"].dropna()) | set(ativ_reu["AnoMes"].dropna())
    )
    for tipo in ["mba", "pos", "imersoes", "outros"]:
        for m in meses_universo:
            try:
                ano, mes = m.split("-")
                ano, mes = int(ano), int(mes)
            except Exception:
                continue
            g_m = neg_ganho[(neg_ganho["AnoMes"] == m) & (neg_ganho["_tipo"] == tipo)]
            r_m = ativ_reu[(ativ_reu["AnoMes"] == m) & (ativ_reu["_tipo"] == tipo)]
            ganhos = len(g_m)
            reunioes = len(r_m)
            faturamento = float(g_m["Negócio - Valor"].sum())
            if ganhos == 0 and reunioes == 0 and faturamento == 0:
                continue  # economiza espaço no JSON
            out.append({
                "ano": ano, "mes": mes, "tipo": tipo,
                "reunioes": reunioes,
                "ganhos": ganhos,
                "faturamento": round(faturamento, 2),
            })
    return out


# ----------------------------------------------------------------------------
# Agregado por Curso × Mês — corrige E6-01 (filtro Tipo + Data ignorava data)
# Permite que o JS combine filtro de tipo de curso COM recorte temporal
# ----------------------------------------------------------------------------
def por_curso_mensal(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Para cada mês × curso: leads, mqls, custo.

    Estrutura: [{ano, mes, curso, leads, mqls, custo}, ...]
    Usado pelo JS para calcular KPIs quando tipo_curso + filtro_data estão
    ambos ativos. Sem isso, o filtro de tipo ignorava o recorte temporal.
    """
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    rd_g["AnoMes"] = rd_g["Data da Conversão"].dt.to_period("M").astype(str)
    inv_g["AnoMes"] = inv_g["Data"].dt.to_period("M").astype(str)

    # Custo por (mês, curso)
    custo_mc = inv_g.groupby(["AnoMes", "Curso"])["Custo"].sum().to_dict()

    # Leads/MQLs por (mês, curso)
    agg = rd_g.groupby(["AnoMes", "Curso"]).agg(
        leads=("Index", "count"),
        mqls=("Class", lambda x: (x == "MQL").sum()),
    ).reset_index()

    out = []
    for _, r in agg.iterrows():
        curso = r["Curso"]
        if pd.isna(curso):
            continue
        m = r["AnoMes"]
        try:
            ano, mes = m.split("-")
            ano, mes = int(ano), int(mes)
        except Exception:
            continue
        custo = float(custo_mc.get((m, curso), 0.0))
        out.append({
            "ano": ano,
            "mes": mes,
            "curso": str(curso),
            "leads": int(r["leads"]),
            "mqls": int(r["mqls"]),
            "custo": round(custo, 2),
        })
    return out


# ----------------------------------------------------------------------------
# Conversões RD com Grupo NULL (corrige C6 da auditoria — antes silencioso)
# ----------------------------------------------------------------------------
def nao_classificados_rd(rd: pd.DataFrame) -> dict:
    rd_null = rd[rd["Grupo"].isna()]
    return {
        "leads": int(len(rd_null)),
        "mqls": int((rd_null["Class"] == "MQL").sum()) if "Class" in rd_null.columns else 0,
        "pct_do_total": round(len(rd_null) / len(rd) * 100, 2),
        "aviso": (
            "Estas conversões NÃO entram em Topo nem Fundo. "
            "Para incluir, classifique-as na base RD Station V2 (campo Grupo)."
        ),
    }


# ----------------------------------------------------------------------------
# Distribuições e séries temporais
# ----------------------------------------------------------------------------
def distribuicoes(rd: pd.DataFrame, grupo: str) -> dict:
    rd_g = rd[rd["Grupo"] == grupo].copy()

    def dist(col, n=10):
        if col not in rd_g.columns:
            return []
        # Distribuição com %MQL por categoria
        g = rd_g.groupby(col).agg(
            leads=("Index", "count"),
            mqls=("Class", lambda x: (x == "MQL").sum()),
        ).reset_index()
        g["pct_mql"] = (g["mqls"] / g["leads"] * 100).round(1)
        g = g.sort_values("leads", ascending=False).head(n)
        return [
            {"label": str(r[col]), "leads": int(r["leads"]),
             "mqls": int(r["mqls"]), "pct_mql": float(r["pct_mql"])}
            for _, r in g.iterrows()
        ]

    return {
        "por_curso": dist("Curso", 15),
        "por_fonte": dist("Fonte", 10),
        "por_plataforma": dist("Plataforma", 10),
        "por_canal": dist("Canal", 10),
        "por_cargo": dist("Cargos", 15),
        "por_mecanismo": dist("Mecanismo", 10),
        "por_lead_score": dist("Lead Score", 10),
        "por_linha": dist("Linha", 10),
    }


def series_temporais(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> dict:
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    # Leads por dia
    leads_d = rd_g.groupby(rd_g["Data da Conversão"].dt.date).size()
    # MQLs por dia
    mqls_d = rd_g[rd_g["Class"] == "MQL"].groupby(
        rd_g[rd_g["Class"] == "MQL"]["Data da Conversão"].dt.date
    ).size()
    # Custo por dia
    custo_d = inv_g.groupby(inv_g["Data"].dt.date)["Custo"].sum()

    # Mensal
    rd_g["AnoMes"] = rd_g["Data da Conversão"].dt.to_period("M").astype(str)
    inv_g["AnoMes"] = inv_g["Data"].dt.to_period("M").astype(str)

    leads_mes = rd_g.groupby("AnoMes").size()
    mqls_mes = rd_g[rd_g["Class"] == "MQL"].groupby("AnoMes").size()
    custo_mes = inv_g.groupby("AnoMes")["Custo"].sum()

    return {
        "diario": {
            "leads": [{"data": str(d), "valor": int(v)} for d, v in leads_d.items()],
            "mqls": [{"data": str(d), "valor": int(v)} for d, v in mqls_d.items()],
            "custo": [{"data": str(d), "valor": round(float(v), 2)} for d, v in custo_d.items()],
        },
        "mensal": {
            "leads": [{"periodo": k, "valor": int(v)} for k, v in leads_mes.items()],
            "mqls": [{"periodo": k, "valor": int(v)} for k, v in mqls_mes.items()],
            "custo": [{"periodo": k, "valor": round(float(v), 2)} for k, v in custo_mes.items()],
        },
    }


# ----------------------------------------------------------------------------
# FUNIL ESPECÍFICO DO TOPO — 6 etapas de assistência sequencial
# Definido pelo gestor da área (2026-05-25). Conta PESSOAS ÚNICAS (email) em
# todas as etapas para taxas de conversão coerentes entre etapas.
#
#   1. Leads de Topo            (emails distintos com conversão Grupo=Topo)
#   2. MQLs de Topo             (subset de 1 cujo Class=MQL no Topo)
#   3. Leads Fundo Assistidos   (emails Fundo com conversão Topo anterior)
#   4. MQLs Fundo Assistidos    (subset de 3 cujo Class=MQL no Fundo)
#   5. Reuniões Assistidas      (já calculado em atribuicao.topo)
#   6. Vendas Assistidas        (já calculado em atribuicao.topo)
# ----------------------------------------------------------------------------
def funil_topo_assistencia(rd: pd.DataFrame, neg: pd.DataFrame,
                            atribuicao: dict) -> dict:
    """Retorna {totais, mensal} para o funil de assistência do Topo."""
    rd_c = rd[["E-mail Lead", "Data da Conversão", "Grupo", "Class"]].dropna(
        subset=["E-mail Lead", "Data da Conversão"]
    ).copy()
    rd_c["email"] = rd_c["E-mail Lead"].astype(str).str.lower().str.strip()
    rd_c = rd_c[rd_c["email"] != ""]
    rd_c["AnoMes"] = rd_c["Data da Conversão"].dt.to_period("M").astype(str)

    # Pré-índice: primeira data de Topo por email (para checar "passou antes")
    topo_rows = rd_c[rd_c["Grupo"] == "Topo"]
    primeira_topo = topo_rows.groupby("email")["Data da Conversão"].min().to_dict()

    # === Etapas 1 e 2: pessoas únicas que tiveram conversão no Topo ===
    # 1. Leads de Topo: emails distintos com Grupo=Topo
    # 2. MQLs de Topo: subset com pelo menos uma conversão Topo marcada como MQL
    topo_mql_emails = set(topo_rows[topo_rows["Class"] == "MQL"]["email"])
    topo_all_emails = set(topo_rows["email"])

    # === Etapa 3 e 4: leads/MQLs Fundo cujo email teve Topo ANTES ===
    fundo_rows = rd_c[rd_c["Grupo"] == "Fundo"].copy()
    # Para cada conversão Fundo, primeira_topo do mesmo email tem que ser < Data
    fundo_rows["topo_data"] = fundo_rows["email"].map(primeira_topo)
    fundo_assist = fundo_rows[
        fundo_rows["topo_data"].notna()
        & (fundo_rows["topo_data"] < fundo_rows["Data da Conversão"])
    ]
    leads_fundo_assist_emails = set(fundo_assist["email"])
    mql_fundo_assist_emails = set(
        fundo_assist[fundo_assist["Class"] == "MQL"]["email"]
    )

    # === Etapa 5 e 6: já calculadas no atribuicao multi-touch ===
    reunioes_assist = len(atribuicao["topo"]["reunioes_assistidas_ids"])
    vendas_assist = len(atribuicao["topo"]["assistencia_neg_ids"])
    faturamento_assist = atribuicao["topo"]["faturamento_influenciado"]

    # === Totais ===
    totais = {
        "leads_topo": len(topo_all_emails),
        "mqls_topo": len(topo_mql_emails),
        "leads_fundo_assist": len(leads_fundo_assist_emails),
        "mqls_fundo_assist": len(mql_fundo_assist_emails),
        "reunioes_assist": reunioes_assist,
        "vendas_assist": vendas_assist,
        "faturamento_assist": round(faturamento_assist, 2),
    }

    # === Granularidade mensal: usa AnoMes da PRIMEIRA conversão Topo do email ===
    # Critério: a "etapa" do funil acontece no mês em que cada pessoa entrou em cada nível
    # Etapas 1-2: mês da primeira conversão Topo do email
    # Etapas 3-4: mês da primeira conversão Fundo (com Topo prévio) do email
    # Etapa 5: mês da reunião (data conclusão)
    # Etapa 6: mês do ganho (Negócio - Ganho em)
    def primeira_data_grupo(rows):
        return rows.groupby("email")["Data da Conversão"].min()

    p_topo = primeira_data_grupo(topo_rows)
    p_topo_mql = primeira_data_grupo(topo_rows[topo_rows["Class"] == "MQL"])
    p_fundo_assist = primeira_data_grupo(fundo_assist)
    p_fundo_mql_assist = primeira_data_grupo(fundo_assist[fundo_assist["Class"] == "MQL"])

    def serie_por_mes(s):
        if s.empty: return {}
        df = s.reset_index()
        df["AnoMes"] = df["Data da Conversão"].dt.to_period("M").astype(str)
        return df.groupby("AnoMes").size().to_dict()

    s_leads_topo = serie_por_mes(p_topo)
    s_mqls_topo = serie_por_mes(p_topo_mql)
    s_leads_fundo = serie_por_mes(p_fundo_assist)
    s_mqls_fundo = serie_por_mes(p_fundo_mql_assist)

    # Reuniões: data da atividade concluída; Vendas: data do ganho
    reu_ids = atribuicao["topo"]["reunioes_assistidas_ids"]
    ganho_ids = atribuicao["topo"]["assistencia_neg_ids"]
    # neg traz Negócio - Ganho em
    neg_assist_ganho = neg[neg["Negócio - ID"].astype(int).isin(ganho_ids)].copy()
    neg_assist_ganho["AnoMes"] = neg_assist_ganho["Negócio - Ganho em"].dt.to_period("M").astype(str)
    s_vendas = neg_assist_ganho.groupby("AnoMes").size().to_dict()
    s_faturamento = neg_assist_ganho.groupby("AnoMes")["Negócio - Valor"].sum().to_dict()
    # Reuniões: já no detalhamento mensal existente (vamos pegar o que tem em mensal[Topo].reunioes_qualificadas posteriormente, ou usar atividades)
    # Para simplicidade aqui retornamos apenas os 5 dados, e a etapa 5 fica como "reunioes_qualificadas" do mensal[Topo] que já existe

    todos_meses = sorted(set(s_leads_topo) | set(s_mqls_topo) | set(s_leads_fundo)
                        | set(s_mqls_fundo) | set(s_vendas))
    mensal = []
    for m in todos_meses:
        try:
            ano, mes = m.split("-"); ano, mes = int(ano), int(mes)
        except Exception:
            continue
        mensal.append({
            "ano": ano, "mes": mes,
            "leads_topo": s_leads_topo.get(m, 0),
            "mqls_topo": s_mqls_topo.get(m, 0),
            "leads_fundo_assist": s_leads_fundo.get(m, 0),
            "mqls_fundo_assist": s_mqls_fundo.get(m, 0),
            "vendas_assist": s_vendas.get(m, 0),
            "faturamento_assist": round(float(s_faturamento.get(m, 0.0)), 2),
        })

    return {"totais": totais, "mensal": mensal}


# ----------------------------------------------------------------------------
# Funil completo (do lead à venda)
# ----------------------------------------------------------------------------
def funil_completo(rd: pd.DataFrame, ativ: pd.DataFrame, neg: pd.DataFrame,
                   grupo: str, atribuicao: dict) -> dict:
    """Funil por Grupo.

    FUNDO: Leads → MQLs → Reuniões Qualificadas (Concluídas) → Ganhos (R$)
      - Ganhos: TODOS os ganhos do dataset (Fundo é o fechador)
      - Faturamento: total dos ganhos
      - RQs: atividades CONCLUÍDAS tipo Reunião em negócios qualificados

    TOPO: Leads → MQLs → Reuniões Assistidas → Participações em Venda (R$ influenciado)
      - Participações em Venda: ganhos onde Topo apareceu na jornada do lead
      - Faturamento influenciado: valor desses ganhos (NÃO é receita exclusiva do Topo)
      - Reuniões Assistidas: RQs em negócios qualificados onde Topo apareceu na jornada
    """
    rd_g = rd[rd["Grupo"] == grupo]
    leads = len(rd_g)
    mqls = int((rd_g["Class"] == "MQL").sum())

    quali_status = ["Qualificação OK", "Check Liderança"]
    neg_quali_ids = set(
        neg.loc[neg["Negócio - Qualificação/Feedback:"].isin(quali_status), "Negócio - ID"].astype(int)
    )

    # Atividades Reunião CONCLUÍDAS em negócios qualificados
    ativ_reu = ativ[
        ativ["Atividade - Tipo"].str.contains("Reunião", case=False, na=False)
        & (ativ["Atividade - Concluído"] == "Concluído")
    ]

    if grupo == "Fundo":
        rqs = int(ativ_reu["Negócio - ID"].astype(int).isin(neg_quali_ids).sum())
        ganhos_ids = atribuicao["fundo"]["ganhos_neg_ids"]
        faturamento = atribuicao["fundo"]["faturamento_total"]
        nome_etapa3 = "Reuniões Qualificadas"
        nome_etapa4 = "Ganhos"
    else:  # Topo
        # RQs assistidas: reuniões concluídas em negócios qualificados onde Topo participou
        reu_assist_ids = atribuicao["topo"]["reunioes_assistidas_ids"]
        rqs = int(ativ_reu["Negócio - ID"].astype(int).isin(reu_assist_ids).sum())
        ganhos_ids = atribuicao["topo"]["assistencia_neg_ids"]
        faturamento = atribuicao["topo"]["faturamento_influenciado"]
        nome_etapa3 = "Reuniões Assistidas"
        nome_etapa4 = "Participações em Venda"

    ganhos = len(ganhos_ids)

    return {
        "etapas": [
            {"etapa": "Leads", "valor": leads},
            {"etapa": "MQLs", "valor": mqls, "conversao": to_pct(mqls, leads)},
            {"etapa": nome_etapa3, "valor": rqs, "conversao": to_pct(rqs, mqls)},
            {"etapa": nome_etapa4, "valor": ganhos,
             "conversao": to_pct(ganhos, rqs) if rqs else 0,
             "faturamento": round(faturamento, 2)},
        ],
        "negocios": {
            "ganhos": ganhos,
            "valor_ganho": round(faturamento, 2),
            "ticket_medio": round(safe_div(faturamento, ganhos), 2),
            "taxa_fechamento": to_pct(ganhos, leads),
        },
    }


# ----------------------------------------------------------------------------
# KPIs financeiros por Grupo (com atribuição multi-touch)
# ----------------------------------------------------------------------------
def kpis_financeiros(inv: pd.DataFrame, atribuicao: dict, grupo: str) -> dict:
    """Calcula ROAS/CAC/Ticket por Grupo usando atribuição.

    FUNDO: receita real (total dos ganhos) ÷ custo Fundo
    TOPO: receita INFLUENCIADA (ganhos assistidos pelo Topo) ÷ custo Topo
    """
    inv_g = inv[inv["Grupo"] == grupo]
    custo = float(inv_g["Custo"].sum())

    if grupo == "Fundo":
        valor = atribuicao["fundo"]["faturamento_total"]
        ganhos = len(atribuicao["fundo"]["ganhos_neg_ids"])
    else:
        valor = atribuicao["topo"]["faturamento_influenciado"]
        ganhos = len(atribuicao["topo"]["assistencia_neg_ids"])

    return {
        "custo": round(custo, 2),
        "valor_atribuido": round(valor, 2),
        "ganhos_atribuidos": ganhos,
        "roas": round(safe_div(valor, custo), 2),
        "cac": round(safe_div(custo, ganhos), 2),
        "ticket_medio": round(safe_div(valor, ganhos), 2),
        "grupo": grupo,
        "modelo_atribuicao": (
            "Fundo: 100% das vendas (fechador). ROAS = Faturamento real / Custo Fundo."
            if grupo == "Fundo" else
            "Topo: assistência (Topo passou na jornada do lead antes da venda). "
            "Faturamento influenciado NÃO é receita exclusiva. ROAS = Faturamento influenciado / Custo Topo."
        ),
    }


# ----------------------------------------------------------------------------
# Filtros disponíveis (para dropdowns do frontend)
# ----------------------------------------------------------------------------
def filtros_disponiveis(rd, inv, neg) -> dict:
    def uniq(serie):
        return sorted([str(x) for x in serie.dropna().unique() if str(x).strip()])

    return {
        "cursos": uniq(rd["Curso"]),
        "fontes": uniq(rd["Fonte"]),
        "plataformas": uniq(rd["Plataforma"]),
        "canais": uniq(rd["Canal"]),
        "linhas": uniq(rd["Linha"]),
        "estados": uniq(neg["Negócio - Estado"]) if "Negócio - Estado" in neg.columns else [],
        "sdrs": uniq(neg["Negócio - Proprietário SDR"]),
    }


# ----------------------------------------------------------------------------
# Detalhamento mensal (para filtros dinâmicos Ano/Mês/Dia)
# ----------------------------------------------------------------------------
def detalhamento_mensal(rd, inv, neg, ativ, grupo, atribuicao) -> list:
    """Para cada mês: leads, mqls, custo, RQs/RAssist, ganhos, faturamento — POR GRUPO.

    FUNDO: ganhos REAIS no mês, faturamento real
    TOPO: ganhos ASSISTIDOS no mês, faturamento influenciado
    """
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    # IDs de ganhos atribuídos a este grupo
    if grupo == "Fundo":
        ganhos_ids = atribuicao["fundo"]["ganhos_neg_ids"]
        rqs_neg_ids_referencia = set(
            neg.loc[neg["Negócio - Qualificação/Feedback:"].isin(["Qualificação OK","Check Liderança"]),
                    "Negócio - ID"].astype(int)
        )
    else:
        ganhos_ids = atribuicao["topo"]["assistencia_neg_ids"]
        rqs_neg_ids_referencia = atribuicao["topo"]["reunioes_assistidas_ids"]

    # Atividades Reunião CONCLUÍDAS — usa Data adicionada (gestor 2026-05-25)
    # Fallback: Data e hora de conclusão; depois Atualizado em
    ativ_reu = ativ[
        ativ["Atividade - Tipo"].str.contains("Reunião", case=False, na=False)
        & (ativ["Atividade - Concluído"] == "Concluído")
    ].copy()
    ativ_reu["data_atv"] = ativ_reu["Atividade - Data adicionada"].fillna(
        ativ_reu["Atividade - Data e hora de conclusão"]
    ).fillna(ativ_reu["Atividade - Atualizado em"])
    ativ_reu = ativ_reu[ativ_reu["Negócio - ID"].astype(int).isin(rqs_neg_ids_referencia)]
    ativ_reu["AnoMes"] = ativ_reu["data_atv"].dt.to_period("M").astype(str)

    # Negócios ganhos com data — só os atribuídos a este grupo
    neg_ganho = neg[neg["Negócio - Status"] == "Ganho"].copy()
    neg_ganho = neg_ganho[neg_ganho["Negócio - ID"].astype(int).isin(ganhos_ids)]
    neg_ganho["AnoMes"] = neg_ganho["Negócio - Ganho em"].dt.to_period("M").astype(str)

    meses = sorted(set(rd_g["Data da Conversão"].dt.to_period("M").astype(str).dropna()))

    out = []
    for m in meses:
        ano, mes = m.split("-")
        ano, mes = int(ano), int(mes)

        rd_m = rd_g[(rd_g["Data da Conversão"].dt.year == ano) & (rd_g["Data da Conversão"].dt.month == mes)]
        inv_m = inv_g[(inv_g["Data"].dt.year == ano) & (inv_g["Data"].dt.month == mes)]
        rqs_m = int((ativ_reu["AnoMes"] == m).sum())
        neg_m = neg_ganho[neg_ganho["AnoMes"] == m]

        leads = len(rd_m)
        mqls = int((rd_m["Class"] == "MQL").sum())
        custo = float(inv_m["Custo"].sum())
        ganhos = len(neg_m)
        faturamento = float(neg_m["Negócio - Valor"].sum())

        out.append({
            "periodo": m,
            "ano": ano,
            "mes": mes,
            "leads": leads,
            "mqls": mqls,
            "pct_mql": to_pct(mqls, leads),
            "custo": round(custo, 2),
            "cpl": round(safe_div(custo, leads), 2),
            "cpmql": round(safe_div(custo, mqls), 2),
            "reunioes_qualificadas": rqs_m,
            "ganhos": ganhos,
            "faturamento": round(faturamento, 2),
            "ticket_medio": round(safe_div(faturamento, ganhos), 2),
        })

    return out


def campanhas_mensal(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Para cada mês, lista campanhas com leads/MQLs/custo.
    Usado pelo JS para recalcular o ranking de criativos respeitando o filtro de data."""
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    rd_g["campanha_chave"] = rd_g["utm_campaign"].fillna("").str.strip()
    rd_g.loc[rd_g["campanha_chave"] == "", "campanha_chave"] = rd_g["Identificador"].fillna("Não identificado")
    rd_g["AnoMes"] = rd_g["Data da Conversão"].dt.to_period("M").astype(str)

    inv_g["camp_norm"] = inv_g["Campanha"].fillna("").str.strip()
    inv_g["AnoMes"] = inv_g["Data"].dt.to_period("M").astype(str)

    meses = sorted(set(rd_g["AnoMes"].dropna()))
    out = []
    for m in meses:
        try:
            ano, mes = m.split("-")
            ano, mes = int(ano), int(mes)
        except Exception:
            continue
        rd_m = rd_g[rd_g["AnoMes"] == m]
        inv_m = inv_g[inv_g["AnoMes"] == m]
        custos_mes = inv_m.groupby("camp_norm")["Custo"].sum().to_dict()

        agg = rd_m.groupby("campanha_chave").agg(
            leads=("Index", "count"),
            mqls=("Class", lambda x: (x == "MQL").sum()),
        ).reset_index()

        campanhas = []
        for _, row in agg.iterrows():
            camp = row["campanha_chave"]
            custo = float(custos_mes.get(camp, 0.0))
            if custo == 0:
                c_norm = re.sub(r"[\s_]+", "", camp.lower())
                for k, v in custos_mes.items():
                    if re.sub(r"[\s_]+", "", k.lower()) == c_norm:
                        custo = float(v); break
            campanhas.append({
                "campanha": camp,
                "leads": int(row["leads"]),
                "mqls": int(row["mqls"]),
                "custo": round(custo, 2),
            })

        out.append({"periodo": m, "ano": ano, "mes": mes, "campanhas": campanhas})
    return out


def campanhas_por_fonte_mensal(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Para cada mês × fonte, lista campanhas com leads/MQLs/custo.
    Usado pelo drawer de canais pra filtrar campanhas dinamicamente."""
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    rd_g["campanha_chave"] = rd_g["utm_campaign"].fillna("").str.strip()
    rd_g.loc[rd_g["campanha_chave"] == "", "campanha_chave"] = rd_g["Identificador"].fillna("Não identificado")
    rd_g["AnoMes"] = rd_g["Data da Conversão"].dt.to_period("M").astype(str)

    inv_g["camp_norm"] = inv_g["Campanha"].fillna("").str.strip()
    inv_g["AnoMes"] = inv_g["Data"].dt.to_period("M").astype(str)

    meses = sorted(set(rd_g["AnoMes"].dropna()))
    out = []
    for m in meses:
        try:
            ano, mes = m.split("-")
            ano, mes = int(ano), int(mes)
        except Exception:
            continue
        rd_m = rd_g[rd_g["AnoMes"] == m]
        inv_m = inv_g[inv_g["AnoMes"] == m]

        agg = rd_m.groupby(["campanha_chave", "Fonte"]).agg(
            leads=("Index", "count"),
            mqls=("Class", lambda x: (x == "MQL").sum()),
        ).reset_index()

        custo_inv = inv_m.groupby(["camp_norm", "Fonte_norm"])["Custo"].sum().to_dict()

        por_fonte = {}
        for _, row in agg.iterrows():
            camp = row["campanha_chave"]
            fonte = row["Fonte"]
            if pd.isna(fonte) or not str(fonte).strip():
                continue
            custo = float(custo_inv.get((camp, fonte), 0.0))
            if custo == 0:
                c_norm = re.sub(r"[\s_]+", "", camp.lower())
                for (k_camp, k_fonte), v in custo_inv.items():
                    if k_fonte == fonte and re.sub(r"[\s_]+", "", k_camp.lower()) == c_norm:
                        custo = float(v); break
            por_fonte.setdefault(str(fonte), []).append({
                "campanha": camp,
                "leads": int(row["leads"]),
                "mqls": int(row["mqls"]),
                "custo": round(custo, 2),
            })

        out.append({"periodo": m, "ano": ano, "mes": mes, "por_fonte": por_fonte})
    return out


def campanhas_arvore_mensal(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Por mês: árvore COMPLETA Campanha → Fonte → Criativo com leads/MQLs/custo.

    Permite ao JS reconstruir a Galeria de Criativos respeitando o filtro de data.
    Antes desta função, fontes/criativos só existiam em `todas_campanhas` (global),
    e a Galeria mostrava o agregado de TODO o histórico independente do filtro.

    Estrutura:
        [
          {ano, mes, periodo: "YYYY-MM", campanhas: [
            {campanha, leads, mqls, pct_mql, custo, cursos, fontes: [
              {fonte, leads, mqls, pct_mql, custo, criativos: [
                {criativo, leads, mqls, pct_mql, custo}
              ]}
            ]}
          ]}
        ]
    """
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    rd_g["campanha_chave"] = rd_g["utm_campaign"].fillna("").str.strip()
    rd_g.loc[rd_g["campanha_chave"] == "", "campanha_chave"] = rd_g["Identificador"].fillna("Não identificado")
    rd_g["AnoMes"] = rd_g["Data da Conversão"].dt.to_period("M").astype(str)

    inv_g["camp_norm"] = inv_g["Campanha"].fillna("").str.strip()
    inv_g["AnoMes"] = inv_g["Data"].dt.to_period("M").astype(str)

    meses = sorted(set(rd_g["AnoMes"].dropna()))
    out = []
    for m in meses:
        try:
            ano, mes = m.split("-")
            ano, mes = int(ano), int(mes)
        except Exception:
            continue
        rd_m = rd_g[rd_g["AnoMes"] == m]
        inv_m = inv_g[inv_g["AnoMes"] == m]

        # Custos do mês (campanha e campanha×fonte) com fallback normalizado
        custo_camp = inv_m.groupby("camp_norm")["Custo"].sum().to_dict()
        custo_camp_fonte = inv_m.groupby(["camp_norm", "Fonte_norm"])["Custo"].sum().to_dict()

        def busca_custo_camp(c):
            if not c:
                return 0.0
            if c in custo_camp:
                return float(custo_camp[c])
            c_norm = re.sub(r"[\s_]+", "", c.lower())
            for k, v in custo_camp.items():
                if re.sub(r"[\s_]+", "", k.lower()) == c_norm:
                    return float(v)
            return 0.0

        def busca_custo_camp_fonte(c, f):
            if (c, f) in custo_camp_fonte:
                return float(custo_camp_fonte[(c, f)])
            c_norm = re.sub(r"[\s_]+", "", c.lower())
            for (k_c, k_f), v in custo_camp_fonte.items():
                if k_f == f and re.sub(r"[\s_]+", "", k_c.lower()) == c_norm:
                    return float(v)
            return 0.0

        # Agrega campanhas do mês
        agg_camp = rd_m.groupby("campanha_chave").agg(
            leads=("Index", "count"),
            mqls=("Class", lambda x: (x == "MQL").sum()),
        ).reset_index()

        campanhas = []
        for _, r in agg_camp.iterrows():
            campanha = r["campanha_chave"]
            sub = rd_m[rd_m["campanha_chave"] == campanha]
            leads_c = int(r["leads"])
            mqls_c = int(r["mqls"])
            custo_c = busca_custo_camp(campanha)

            # Top 3 cursos relacionados (do mês)
            cursos = [
                str(c) for c in sub["Curso"].value_counts().head(3).index.tolist()
                if not pd.isna(c)
            ]

            # Fontes do mês
            fontes = []
            for fonte, sub_f in sub.groupby("Fonte"):
                if pd.isna(fonte):
                    continue
                l = len(sub_f)
                mq = int((sub_f["Class"] == "MQL").sum())
                cf = busca_custo_camp_fonte(campanha, str(fonte))

                # Criativos do mês (utm_content)
                criativos = []
                for crt, sub_c in sub_f.groupby("utm_content"):
                    if pd.isna(crt) or not str(crt).strip():
                        continue
                    cl = len(sub_c)
                    cm = int((sub_c["Class"] == "MQL").sum())
                    criativos.append({
                        "criativo": str(crt),
                        "leads": cl,
                        "mqls": cm,
                        "pct_mql": to_pct(cm, cl),
                        "custo": 0.0,
                    })
                criativos.sort(key=lambda x: x["pct_mql"], reverse=True)
                fontes.append({
                    "fonte": str(fonte),
                    "leads": l,
                    "mqls": mq,
                    "pct_mql": to_pct(mq, l),
                    "custo": round(cf, 2),
                    "criativos": criativos,
                })
            fontes.sort(key=lambda x: x["leads"], reverse=True)

            campanhas.append({
                "campanha": campanha,
                "leads": leads_c,
                "mqls": mqls_c,
                "pct_mql": to_pct(mqls_c, leads_c),
                "custo": round(custo_c, 2),
                "cursos": cursos,
                "fontes": fontes,
            })

        campanhas.sort(key=lambda x: x["leads"], reverse=True)
        out.append({"periodo": m, "ano": ano, "mes": mes, "campanhas": campanhas})
    return out


def por_fonte_mensal(rd: pd.DataFrame, inv: pd.DataFrame, grupo: str) -> list:
    """Para cada mês, lista as fontes com leads/MQLs/custo (permite filtro temporal do JS)."""
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    rd_g["AnoMes"] = rd_g["Data da Conversão"].dt.to_period("M").astype(str)
    inv_g["AnoMes"] = inv_g["Data"].dt.to_period("M").astype(str)

    meses = sorted(set(rd_g["AnoMes"].dropna()))
    out = []
    for m in meses:
        try:
            ano, mes = m.split("-")
            ano, mes = int(ano), int(mes)
        except Exception:
            continue
        rd_m = rd_g[rd_g["AnoMes"] == m]
        inv_m = inv_g[inv_g["AnoMes"] == m]
        custos = inv_m.groupby("Fonte_norm")["Custo"].sum().to_dict()

        fontes = []
        agg = rd_m.groupby("Fonte").agg(
            leads=("Index", "count"),
            mqls=("Class", lambda x: (x == "MQL").sum()),
        ).reset_index()
        for _, row in agg.iterrows():
            f = row["Fonte"]
            if pd.isna(f):
                continue
            fontes.append({
                "fonte": str(f),
                "leads": int(row["leads"]),
                "mqls": int(row["mqls"]),
                "custo": round(float(custos.get(f, 0.0)), 2),
            })
        out.append({"periodo": m, "ano": ano, "mes": mes, "fontes": fontes})
    return out


def detalhamento_diario(rd, inv, neg, grupo, atribuicao) -> list:
    """Granularidade diária — leads/MQLs/custo + ganhos/faturamento atribuídos ao grupo."""
    rd_g = rd[rd["Grupo"] == grupo].copy()
    inv_g = inv[inv["Grupo"] == grupo].copy()

    if grupo == "Fundo":
        ganhos_ids = atribuicao["fundo"]["ganhos_neg_ids"]
    else:
        ganhos_ids = atribuicao["topo"]["assistencia_neg_ids"]

    rd_g["d"] = rd_g["Data da Conversão"].dt.date
    inv_g["d"] = inv_g["Data"].dt.date
    neg_g = neg[(neg["Negócio - Status"] == "Ganho") &
                (neg["Negócio - ID"].astype(int).isin(ganhos_ids))].copy()
    neg_g["d"] = neg_g["Negócio - Ganho em"].dt.date

    leads_d = rd_g.groupby("d").size()
    mqls_d = rd_g[rd_g["Class"] == "MQL"].groupby("d").size()
    custo_d = inv_g.groupby("d")["Custo"].sum()
    ganhos_d = neg_g.groupby("d").size()
    fat_d = neg_g.groupby("d")["Negócio - Valor"].sum()

    todas_datas = sorted(set(leads_d.index) | set(custo_d.index) | set(ganhos_d.index))
    out = []
    for d in todas_datas:
        if d is None or pd.isna(d):
            continue
        out.append({
            "data": str(d),
            "leads": int(leads_d.get(d, 0)),
            "mqls": int(mqls_d.get(d, 0)),
            "custo": round(float(custo_d.get(d, 0.0)), 2),
            "ganhos": int(ganhos_d.get(d, 0)),
            "faturamento": round(float(fat_d.get(d, 0.0)), 2),
        })
    return out


# ----------------------------------------------------------------------------
# Motivos de perda
# ----------------------------------------------------------------------------
def motivos_perda(neg) -> dict:
    """Retorna motivos de perda detalhados.

    Usa a nova coluna 'Motivo da perda' (mais granular). Mantém também
    a quebra por Qualificação/Feedback como visão complementar.
    """
    perdidos = neg[neg["Negócio - Status"] == "Perdido"]

    motivos_detalhados = []
    if "Negócio - Motivo da perda" in perdidos.columns:
        vc = perdidos["Negócio - Motivo da perda"].value_counts()
        motivos_detalhados = [{"motivo": str(k), "quantidade": int(v)} for k, v in vc.items()]

    qualif = perdidos["Negócio - Qualificação/Feedback:"].value_counts()
    motivos_qualif = [{"motivo": str(k), "quantidade": int(v)} for k, v in qualif.items()]

    return {
        "detalhados": motivos_detalhados,
        "por_qualificacao": motivos_qualif,
        "total_perdidos": int(len(perdidos)),
    }


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    log("=" * 60)
    log("INICIANDO PIPELINE HUB AGROADVANCE")
    log("=" * 60)

    ativ, neg, inv, rd = carrega_bases()

    # Data de referência: última data presente no RD
    data_ref = rd["Data da Conversão"].max()
    if pd.isna(data_ref):
        data_ref = datetime.now()
    log(f"Data de referência: {data_ref}")

    log("Calculando atribuição multi-touch (email Pipedrive ↔ RD)...")
    atribuicao = calcula_atribuicao(neg, rd)
    log(
        f"  Ganhos: {atribuicao['cobertura']['ganhos_total']:,} | "
        f"com email: {atribuicao['cobertura']['ganhos_com_email']:,} | "
        f"match RD: {atribuicao['cobertura']['ganhos_com_match_rd']:,} | "
        f"sem match: {atribuicao['cobertura']['ganhos_sem_match']:,}"
    )
    log(
        f"  Topo assistiu: {len(atribuicao['topo']['assistencia_neg_ids']):,} ganhos "
        f"(R$ {atribuicao['topo']['faturamento_influenciado']:,.2f} influenciado)"
    )

    log("Calculando KPIs Topo/Fundo...")
    topo_kpis = kpis_por_grupo(rd, inv, "Topo")
    fundo_kpis = kpis_por_grupo(rd, inv, "Fundo")

    log("Calculando comparativos temporais...")
    topo_comp = calcula_comparativos(rd, inv, "Topo", data_ref)
    fundo_comp = calcula_comparativos(rd, inv, "Fundo", data_ref)

    log("Calculando distribuições...")
    topo_dist = distribuicoes(rd, "Topo")
    fundo_dist = distribuicoes(rd, "Fundo")

    log("Calculando séries temporais...")
    topo_serie = series_temporais(rd, inv, "Topo")
    fundo_serie = series_temporais(rd, inv, "Fundo")

    log("Construindo rankings de criativos...")
    topo_rank = constroi_ranking(rd, inv, "Topo")
    fundo_rank = constroi_ranking(rd, inv, "Fundo")

    log("Listando TODAS as campanhas (para tabela + cross-filter)...")
    topo_todas = todas_campanhas(rd, inv, "Topo")
    fundo_todas = todas_campanhas(rd, inv, "Fundo")

    log("Agregado real por Curso (corrige cross-filter)...")
    topo_por_curso_real = agregado_por_curso(rd, inv, "Topo")
    fundo_por_curso_real = agregado_por_curso(rd, inv, "Fundo")

    log("Curso × Mês (corrige filtro Tipo + Data)...")
    topo_por_curso_mensal = por_curso_mensal(rd, inv, "Topo")
    fundo_por_curso_mensal = por_curso_mensal(rd, inv, "Fundo")

    log("Atribuindo tipo (MBA/Pós/Imersões) aos negócios — multi-camada...")
    neg_classificado = atribui_tipos_negocios(neg, rd)

    log("Tipo × Mês (Reuniões/Matrículas/Faturamento por tipo de curso)...")
    topo_por_tipo_mensal = por_tipo_curso_mensal(rd, neg_classificado, ativ, "Topo", atribuicao)
    fundo_por_tipo_mensal = por_tipo_curso_mensal(rd, neg_classificado, ativ, "Fundo", atribuicao)

    log("Calculando funis (Topo e Fundo)...")
    topo_funil = funil_completo(rd, ativ, neg, "Topo", atribuicao)
    fundo_funil = funil_completo(rd, ativ, neg, "Fundo", atribuicao)

    log("Funil de TOPO — assistência (6 etapas por pessoa única)...")
    topo_funil_assist = funil_topo_assistencia(rd, neg, atribuicao)
    log(f"  Leads Topo: {topo_funil_assist['totais']['leads_topo']:,} · "
        f"MQLs Topo: {topo_funil_assist['totais']['mqls_topo']:,} · "
        f"Leads Fundo Assist: {topo_funil_assist['totais']['leads_fundo_assist']:,} · "
        f"MQLs Fundo Assist: {topo_funil_assist['totais']['mqls_fundo_assist']:,} · "
        f"Reuniões Assist: {topo_funil_assist['totais']['reunioes_assist']:,} · "
        f"Vendas Assist: {topo_funil_assist['totais']['vendas_assist']:,}")

    log("Calculando financeiro por grupo (com atribuição)...")
    topo_fin = kpis_financeiros(inv, atribuicao, "Topo")
    fundo_fin = kpis_financeiros(inv, atribuicao, "Fundo")

    log("Detalhamento mensal (Topo e Fundo)...")
    topo_mes = detalhamento_mensal(rd, inv, neg, ativ, "Topo", atribuicao)
    fundo_mes = detalhamento_mensal(rd, inv, neg, ativ, "Fundo", atribuicao)

    log("Detalhamento diário (Topo e Fundo)...")
    topo_dia = detalhamento_diario(rd, inv, neg, "Topo", atribuicao)
    fundo_dia = detalhamento_diario(rd, inv, neg, "Fundo", atribuicao)

    log("Por Fonte Mensal (Topo e Fundo)...")
    topo_pfm = por_fonte_mensal(rd, inv, "Topo")
    fundo_pfm = por_fonte_mensal(rd, inv, "Fundo")

    log("Campanhas Mensal (para ranking dinâmico)...")
    topo_cm = campanhas_mensal(rd, inv, "Topo")
    fundo_cm = campanhas_mensal(rd, inv, "Fundo")

    log("Campanhas por Fonte × Mês (para drawer de canais)...")
    topo_cfm = campanhas_por_fonte_mensal(rd, inv, "Topo")
    fundo_cfm = campanhas_por_fonte_mensal(rd, inv, "Fundo")

    log("Árvore mensal Campanha→Fonte→Criativo (Galeria filtrável)...")
    topo_arvore = campanhas_arvore_mensal(rd, inv, "Topo")
    fundo_arvore = campanhas_arvore_mensal(rd, inv, "Fundo")

    log("Coletando filtros disponíveis...")
    filtros = filtros_disponiveis(rd, inv, neg)

    log("Motivos de perda...")
    perdas = motivos_perda(neg)

    log("Conversões RD não classificadas (Grupo NULL)...")
    nao_class = nao_classificados_rd(rd)

    payload = {
        "meta": {
            "atualizado_em": datetime.now().isoformat(timespec="seconds"),
            "data_referencia": data_ref.strftime("%Y-%m-%d") if not pd.isna(data_ref) else None,
            "periodo": {"ano_inicio": ANO_INI, "ano_fim": ANO_FIM},
            "volumes_brutos": {
                "atividades": len(ativ),
                "negocios": len(neg),
                "investimento_linhas": len(inv),
                "rd_conversoes": len(rd),
            },
        },
        "topo": {
            "kpis": topo_kpis,
            "comparativos": topo_comp,
            "distribuicoes": topo_dist,
            "series": topo_serie,
            "ranking_criativos": topo_rank,
            "todas_campanhas": topo_todas,
            "por_curso_real": topo_por_curso_real,
            "por_curso_mensal": topo_por_curso_mensal,
            "por_tipo_mensal": topo_por_tipo_mensal,
            "funil": topo_funil,
            "funil_assistencia": topo_funil_assist,  # novo funil de 6 etapas
            "financeiro": topo_fin,
            "mensal": topo_mes,
            "diario": topo_dia,
            "por_fonte_mensal": topo_pfm,
            "campanhas_mensal": topo_cm,
            "campanhas_por_fonte_mensal": topo_cfm,
            "campanhas_arvore_mensal": topo_arvore,
        },
        "fundo": {
            "kpis": fundo_kpis,
            "comparativos": fundo_comp,
            "distribuicoes": fundo_dist,
            "series": fundo_serie,
            "ranking_criativos": fundo_rank,
            "todas_campanhas": fundo_todas,
            "por_curso_real": fundo_por_curso_real,
            "por_curso_mensal": fundo_por_curso_mensal,
            "por_tipo_mensal": fundo_por_tipo_mensal,
            "funil": fundo_funil,
            "financeiro": fundo_fin,
            "mensal": fundo_mes,
            "diario": fundo_dia,
            "por_fonte_mensal": fundo_pfm,
            "campanhas_mensal": fundo_cm,
            "campanhas_por_fonte_mensal": fundo_cfm,
            "campanhas_arvore_mensal": fundo_arvore,
        },
        "atribuicao": {
            "modelo": "Crédito de assistência (Topo ajuda, Fundo fecha) — sem limite de tempo",
            "cobertura": atribuicao["cobertura"],
            "topo_assistencia": {
                "ganhos": len(atribuicao["topo"]["assistencia_neg_ids"]),
                "faturamento_influenciado": atribuicao["topo"]["faturamento_influenciado"],
                "reunioes_assistidas": len(atribuicao["topo"]["reunioes_assistidas_ids"]),
            },
        },
        "nao_classificados": nao_class,
        "motivos_perda": perdas,
        "filtros_disponiveis": filtros,
    }

    # Sets não serializam para JSON — converte para listas
    def _to_serializable(obj):
        if isinstance(obj, set):
            return list(obj)
        if isinstance(obj, dict):
            return {k: _to_serializable(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_to_serializable(v) for v in obj]
        return obj
    payload = _to_serializable(payload)

    arq_saida = PASTA_SAIDA / "performance_mkt.json"
    arq_js = PASTA_SAIDA / "performance_mkt.js"
    arq_meta = PASTA_SAIDA / "ultima_atualizacao.json"

    log(f"Salvando {arq_saida.name}...")
    json_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with open(arq_saida, "w", encoding="utf-8") as f:
        f.write(json_str)

    # Também gera versão .js para funcionar offline (sem servidor HTTP)
    log(f"Salvando {arq_js.name} (versão offline)...")
    with open(arq_js, "w", encoding="utf-8") as f:
        f.write("/* Gerado automaticamente pelo pipeline. Não editar manualmente. */\n")
        f.write(f"window.PAINEL_DATA = {json_str};\n")

    with open(arq_meta, "w", encoding="utf-8") as f:
        json.dump({"atualizado_em": payload["meta"]["atualizado_em"],
                   "data_referencia": payload["meta"]["data_referencia"]},
                  f, ensure_ascii=False, indent=2)

    tam_kb = arq_saida.stat().st_size / 1024
    log(f"OK! {arq_saida.name} ({tam_kb:.1f} KB) + {arq_js.name} gerados")
    log("=" * 60)
    log("PIPELINE CONCLUÍDO COM SUCESSO")
    log("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERRO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
