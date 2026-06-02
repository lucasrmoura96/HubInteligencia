# -*- coding: utf-8 -*-
"""
Pipeline do PAINEL COMERCIAL (Agroadvance).
Lê Negócios + Atividades (Pipedrive) e gera hub/dados/performance_comercial.json.

Modelagem v1 (liderança comercial):
- Eixo de período = SAFRA por DATA DE CRIAÇÃO do negócio (cohort).
  Como o ciclo de venda é ~1 dia, cohort ≈ fluxo do mês.
- Funil cohort: Criados → Qualificados (OK) → Com Reunião → Com Proposta → Ganhos.
- Rankings de Closer e SDR com séries mensais (JS filtra por período).
- Inclui motivos de perda (mensal) e filtros disponíveis.
"""
from pathlib import Path
from datetime import datetime
import json
import re
import pandas as pd
import numpy as np

RAIZ = Path(__file__).parent.parent
BASES = RAIZ / "bases"
SAIDA = RAIZ / "hub" / "dados" / "performance_comercial.json"

NEG_FILE = next(BASES.glob("Negócios B2C Pipedrive*.xlsx"))
ATIV_FILE = next(BASES.glob("Atividades B2C Pipedrive*.xlsx"))
RD_FILE = next(BASES.glob("RD Station V2*.xlsx"))

ANO_INI = 2025

def log(m): print(f"[comercial] {m}")

def to_pct(n, d): return round(100.0 * n / d, 1) if d else 0.0
def safe_div(n, d): return (n / d) if d else 0.0


def main():
    log(f"Lendo {NEG_FILE.name}")
    neg = pd.read_excel(NEG_FILE, sheet_name=0)
    log(f"Lendo {ATIV_FILE.name}")
    ativ = pd.read_excel(ATIV_FILE, sheet_name=0)
    log(f"Lendo {RD_FILE.name}")
    rd = pd.read_excel(RD_FILE, sheet_name=0)

    # ---------- MQLs do RD (Fundo) por mês — topo do funil comercial ----------
    rd["_dt"] = pd.to_datetime(rd["Data da Conversão"], errors="coerce")
    rd_f = rd[(rd["Class"] == "MQL") & (rd["Grupo"] == "Fundo") & (rd["_dt"].dt.year >= ANO_INI)].copy()
    rd_f["AnoMes"] = rd_f["_dt"].dt.to_period("M").astype(str)
    mqls_mes = rd_f["AnoMes"].value_counts().to_dict()
    mqls_total = int(len(rd_f))
    log(f"MQLs Fundo (RD): {mqls_total:,}")

    # ---------- Datas ----------
    neg["_criado"] = pd.to_datetime(neg["Negócio - Negócio criado em"], errors="coerce")
    neg["_ganho"] = pd.to_datetime(neg["Negócio - Ganho em"], errors="coerce")
    neg = neg[neg["_criado"].dt.year >= ANO_INI].copy()
    neg["AnoMes"] = neg["_criado"].dt.to_period("M").astype(str)
    neg["ano"] = neg["_criado"].dt.year
    neg["mes"] = neg["_criado"].dt.month

    # ---------- Flags de atividade por Negócio - ID ----------
    ativ["_tipo"] = ativ["Atividade - Tipo"].astype(str)
    ativ["_concl"] = ativ["Atividade - Concluído"].astype(str)
    reuniao_ok = ativ[ativ["_tipo"].str.contains("Reuni", case=False, na=False) & (ativ["_concl"] == "Concluído")]
    proposta = ativ[ativ["_tipo"].str.contains("Proposta", case=False, na=False)]
    noshow = ativ[ativ["_tipo"].str.contains("No Show", case=False, na=False)]

    ids_reuniao = set(reuniao_ok["Negócio - ID"].dropna().astype(int))
    ids_proposta = set(proposta["Negócio - ID"].dropna().astype(int))
    ids_noshow = set(noshow["Negócio - ID"].dropna().astype(int))

    neg["_id"] = neg["Negócio - ID"].astype("Int64")
    neg["tem_reuniao"] = neg["_id"].apply(lambda x: int(x) in ids_reuniao if pd.notna(x) else False)
    neg["tem_proposta"] = neg["_id"].apply(lambda x: int(x) in ids_proposta if pd.notna(x) else False)
    neg["tem_noshow"] = neg["_id"].apply(lambda x: int(x) in ids_noshow if pd.notna(x) else False)

    neg["is_ganho"] = neg["Negócio - Status"] == "Ganho"
    neg["is_perdido"] = neg["Negócio - Status"] == "Perdido"
    neg["is_aberto"] = neg["Negócio - Status"] == "Aberto"
    neg["is_quali_ok"] = neg["Negócio - Qualificação/Feedback:"] == "Qualificação OK"
    neg["valor"] = pd.to_numeric(neg["Negócio - Valor"], errors="coerce").fillna(0.0)
    neg["_ciclo"] = (neg["_ganho"] - neg["_criado"]).dt.days
    # Reunião Qualificada = negócio qualificado (OK) que teve reunião concluída
    neg["is_rq"] = neg["is_quali_ok"] & neg["tem_reuniao"]

    # ---------- KPIs globais (2025-2026) ----------
    def kpis_de(df, mqls=0):
        criados = len(df)
        ganhos = int(df["is_ganho"].sum())
        perdidos = int(df["is_perdido"].sum())
        abertos = int(df["is_aberto"].sum())
        fat = float(df.loc[df["is_ganho"], "valor"].sum())
        quali = int(df["is_quali_ok"].sum())
        reun = int(df["tem_reuniao"].sum())
        rq = int(df["is_rq"].sum())
        prop = int(df["tem_proposta"].sum())
        nsh = int(df["tem_noshow"].sum())
        ciclo = df.loc[df["is_ganho"], "_ciclo"]
        ciclo = ciclo[(ciclo >= 0) & (ciclo <= 365)]
        return {
            "mqls": int(mqls),
            "criados": criados,
            "ganhos": ganhos,
            "perdidos": perdidos,
            "abertos": abertos,
            "faturamento": round(fat, 2),
            "ticket_medio": round(safe_div(fat, ganhos), 2),
            "win_rate": to_pct(ganhos, ganhos + perdidos),
            "pct_ganho_criados": to_pct(ganhos, criados),
            "qualificados": quali,
            "taxa_qualificacao": to_pct(quali, criados),
            "com_reuniao": reun,
            "reunioes_qualificadas": rq,
            "com_proposta": prop,
            "no_show": nsh,
            "no_show_rate": to_pct(nsh, reun + nsh),
            # Conversões do funil comercial (MQL -> RQ -> Venda)
            "conv_mql_rq": to_pct(rq, mqls),
            "conv_rq_venda": to_pct(ganhos, rq),
            "ciclo_medio_dias": round(float(ciclo.mean()), 1) if len(ciclo) else None,
            "ciclo_mediana_dias": float(ciclo.median()) if len(ciclo) else None,
        }

    kpis = kpis_de(neg, mqls_total)
    log(f"KPIs: criados={kpis['criados']} ganhos={kpis['ganhos']} win={kpis['win_rate']}% fat=R${kpis['faturamento']:,.0f}")

    # ---------- Série mensal (cohort por criação) ----------
    # União dos meses de negócios + meses de MQLs (RD) p/ não perder nenhum
    meses_univ = sorted(set(neg["AnoMes"].dropna()) | set(mqls_mes.keys()))
    grp = {m: sub for m, sub in neg.groupby("AnoMes")}
    mensal = []
    for m in meses_univ:
        a, me = m.split("-")
        sub = grp.get(m)
        if sub is None:
            sub = neg.iloc[0:0]  # vazio
        k = kpis_de(sub, mqls_mes.get(m, 0))
        k.update({"periodo": m, "ano": int(a), "mes": int(me)})
        mensal.append(k)
    mensal.sort(key=lambda x: x["periodo"])

    # ---------- Funil comercial (global): MQL -> RQ -> Venda + Faturamento ----------
    def funil_de(df, mqls):
        rq = int(df["is_rq"].sum())
        ganhos = int(df["is_ganho"].sum())
        fat = float(df.loc[df["is_ganho"], "valor"].sum())
        etapas = [
            {"etapa": "MQLs", "valor": int(mqls)},
            {"etapa": "Reuniões Qualificadas", "valor": rq},
            {"etapa": "Vendas", "valor": ganhos},
            {"etapa": "Faturamento", "valor": round(fat, 2), "is_moeda": True},
        ]
        etapas[0]["conversao"] = 100.0
        etapas[1]["conversao"] = to_pct(rq, mqls)
        etapas[2]["conversao"] = to_pct(ganhos, rq)
        etapas[3]["conversao"] = None  # faturamento é valor, não taxa
        return etapas
    funil = funil_de(neg, mqls_total)

    # ---------- Ranking de CLOSERS (mensal) ----------
    def ranking_mensal(df, col_pessoa):
        out = {}
        for (pessoa, m), sub in df.groupby([col_pessoa, "AnoMes"]):
            if pd.isna(pessoa):
                pessoa = "(sem dono)"
            a, me = m.split("-")
            d = out.setdefault(str(pessoa), {})
            d[m] = {
                "ano": int(a), "mes": int(me),
                "criados": len(sub),
                "ganhos": int(sub["is_ganho"].sum()),
                "perdidos": int(sub["is_perdido"].sum()),
                "faturamento": round(float(sub.loc[sub["is_ganho"], "valor"].sum()), 2),
                "qualificados": int(sub["is_quali_ok"].sum()),
                "com_reuniao": int(sub["tem_reuniao"].sum()),
                "rq": int(sub["is_rq"].sum()),
                "no_show": int(sub["tem_noshow"].sum()),
            }
        return out

    closers_raw = ranking_mensal(neg, "Negócio - Proprietário")
    sdrs_raw = ranking_mensal(neg, "Negócio - Proprietário SDR")

    def empacota(raw, marca_bot=False):
        lst = []
        for nome, meses in raw.items():
            serie = [dict(periodo=p, **v) for p, v in sorted(meses.items())]
            item = {"nome": nome, "mensal": serie}
            if marca_bot:
                item["is_bot"] = ("bot" in nome.lower())
                item["sem_sdr"] = nome in ("(sem dono)", "Sem SDR")
            lst.append(item)
        return lst

    closers = empacota(closers_raw)
    sdrs = empacota(sdrs_raw, marca_bot=True)

    # ---------- Motivos de perda (mensal) ----------
    perd = neg[neg["is_perdido"]].copy()
    perd["motivo"] = perd["Negócio - Motivo da perda"].fillna("(sem motivo)").astype(str)
    motivos_mensal = []
    for (mot, m), sub in perd.groupby(["motivo", "AnoMes"]):
        a, me = m.split("-")
        motivos_mensal.append({"motivo": mot, "ano": int(a), "mes": int(me), "qtd": len(sub)})

    # ---------- DIÁRIO: Reuniões por SDR (data real da atividade) ----------
    # qtd = todas reuniões concluídas; qtd_ok = reuniões com Qualificação OK
    reu = reuniao_ok.copy()
    reu["_dt"] = pd.to_datetime(reu["Atividade - Data adicionada"], errors="coerce")
    reu = reu[reu["_dt"].dt.year >= ANO_INI]
    reu["data"] = reu["_dt"].dt.strftime("%Y-%m-%d")
    reu["sdr"] = reu["Negócio - Proprietário SDR"].fillna("(sem SDR)").astype(str)
    reu["_ok"] = reu["Negócio - Qualificação/Feedback:"] == "Qualificação OK"
    sdr_reunioes_diario = []
    for (s, d), sub in reu.groupby(["sdr", "data"]):
        sdr_reunioes_diario.append({
            "sdr": s, "data": d,
            "qtd": int(len(sub)),
            "qtd_ok": int(sub["_ok"].sum()),
        })

    # ---------- DIÁRIO: Vendas por Closer (data do Ganho) ----------
    gan = neg[neg["is_ganho"]].copy()
    gan = gan[gan["_ganho"].dt.year >= ANO_INI]
    gan["data"] = gan["_ganho"].dt.strftime("%Y-%m-%d")
    gan["closer"] = gan["Negócio - Proprietário"].fillna("(sem dono)").astype(str)
    closer_vendas_diario = []
    for (c, d), sub in gan.groupby(["closer", "data"]):
        closer_vendas_diario.append({
            "closer": c, "data": d,
            "qtd": len(sub),
            "faturamento": round(float(sub["valor"].sum()), 2),
        })

    # ---------- Closer × Curso (mensal): reuniões e vendas por produto ----------
    neg["_curso"] = neg["Negócio - Produto de Interesse"].fillna("(sem produto)").astype(str)
    neg["_closer"] = neg["Negócio - Proprietário"].fillna("(sem dono)").astype(str)
    closer_curso_mensal = []
    for (c, cu, a, me), sub in neg.groupby(["_closer", "_curso", "ano", "mes"]):
        closer_curso_mensal.append({
            "closer": c, "curso": cu, "ano": int(a), "mes": int(me),
            "reunioes": int(sub["tem_reuniao"].sum()),
            "vendas": int(sub["is_ganho"].sum()),
            "faturamento": round(float(sub.loc[sub["is_ganho"], "valor"].sum()), 2),
        })

    # ---------- Performance por Curso (mensal) ----------
    curso_mensal = []
    for (cu, a, me), sub in neg.groupby(["_curso", "ano", "mes"]):
        ganhos = int(sub["is_ganho"].sum())
        perdidos = int(sub["is_perdido"].sum())
        fat = float(sub.loc[sub["is_ganho"], "valor"].sum())
        curso_mensal.append({
            "curso": cu, "ano": int(a), "mes": int(me),
            "criados": len(sub),
            "ganhos": ganhos,
            "perdidos": perdidos,
            "faturamento": round(fat, 2),
            "qualificados": int(sub["is_quali_ok"].sum()),
            "com_reuniao": int(sub["tem_reuniao"].sum()),
            "rq": int(sub["is_rq"].sum()),
        })

    # ---------- Filtros disponíveis ----------
    def uniq(serie):
        return sorted([str(x) for x in serie.dropna().unique() if str(x).strip()])
    filtros = {
        "anos": sorted(neg["ano"].dropna().unique().tolist()),
        "closers": uniq(neg["Negócio - Proprietário"]),
        "sdrs": uniq(neg["Negócio - Proprietário SDR"]),
        "canais": uniq(neg["Negócio - Canal de origem"]),
        "produtos": uniq(neg["Negócio - Produto de Interesse"]),
    }

    data_ref = neg["_criado"].max()
    payload = {
        "meta": {
            "atualizado_em": datetime.now().isoformat(timespec="seconds"),
            "data_referencia": data_ref.strftime("%Y-%m-%d") if pd.notna(data_ref) else None,
            "periodo": {"ano_inicio": ANO_INI},
            "modelagem": "Safra por data de criação do negócio (cohort). Ciclo ~1 dia ⇒ ≈ fluxo do mês.",
            "volumes": {"negocios": len(neg), "atividades": len(ativ)},
        },
        "kpis": kpis,
        "mensal": mensal,
        "funil": funil,
        "closers": closers,
        "sdrs": sdrs,
        "sdr_reunioes_diario": sdr_reunioes_diario,
        "closer_vendas_diario": closer_vendas_diario,
        "closer_curso_mensal": closer_curso_mensal,
        "curso_mensal": curso_mensal,
        "motivos_perda_mensal": motivos_mensal,
        "filtros_disponiveis": filtros,
    }

    SAIDA.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    kb = SAIDA.stat().st_size / 1024
    log(f"OK -> {SAIDA.name} ({kb:.0f} KB)")
    log(f"Closers: {len(closers)} | SDRs: {len(sdrs)} | meses: {len(mensal)}")
    log(f"diario: sdr_reun={len(sdr_reunioes_diario)} closer_vendas={len(closer_vendas_diario)} closer_curso={len(closer_curso_mensal)}")


if __name__ == "__main__":
    main()
