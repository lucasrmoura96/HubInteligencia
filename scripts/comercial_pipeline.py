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
import unicodedata
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

# Classifica o produto (curso) por tipo — mesma regra do painel MKT (getCursoTipo)
def curso_tipo(curso):
    c = ''.join(ch for ch in unicodedata.normalize('NFD', str(curso or '').lower()) if unicodedata.category(ch) != 'Mn')
    if c.startswith('mba'): return 'mba'
    if 'imersao' in c: return 'imersoes'
    if c.startswith('pos'): return 'pos'
    return 'outros'


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
    # "Administrador" = vendas de self-checkout (sem closer humano) → renomeia p/ exibição
    neg["Negócio - Proprietário"] = neg["Negócio - Proprietário"].replace({"Administrador": "SelfCheckout"})
    # Safra por CRIAÇÃO (cohort do funil)
    neg["AnoMes"] = neg["_criado"].dt.to_period("M").astype(str)
    neg["ano"] = neg["_criado"].dt.year
    neg["mes"] = neg["_criado"].dt.month
    # Mês do GANHO ("Ganho em") — usado p/ atribuir Vendas/Faturamento ao mês de FECHAMENTO
    neg["g_anomes"] = neg["_ganho"].dt.to_period("M").astype(str)

    # ---------- Normalização de "sem SDR" (base tem 'Sem SDR', vazio e 'Self Checkout') ----------
    SDR_SEM = {"Sem SDR": "(sem SDR)", "Self Checkout": "(sem SDR)", "SelfCheckout": "(sem SDR)", "Administrador": "(sem SDR)"}
    neg["Negócio - Proprietário SDR"] = neg["Negócio - Proprietário SDR"].replace(SDR_SEM)
    ativ["Negócio - Proprietário SDR"] = ativ["Negócio - Proprietário SDR"].replace(SDR_SEM)

    # "Qualificação OK" inclui "Check Liderança" (decisão do negócio: pendente de
    # validação da liderança conta como qualificada). Demais feedbacks = não-OK.
    QUALI_OK = ["Qualificação OK", "Check Liderança"]

    # ---------- Flags de atividade por Negócio - ID ----------
    # NÃO usamos o campo "Concluído" — é operacionalmente não-confiável (esquecido
    # ou marcado dias depois). Contabilizamos pelo TIPO + data adicionada + feedback.
    ativ["_tipo"] = ativ["Atividade - Tipo"].astype(str)
    reuniao_ok = ativ[ativ["_tipo"].str.contains("Reuni", case=False, na=False)]
    proposta = ativ[ativ["_tipo"].str.contains("Proposta", case=False, na=False)]
    noshow = ativ[ativ["_tipo"].str.contains("No Show", case=False, na=False)]

    ids_reuniao = set(reuniao_ok["Negócio - ID"].dropna().astype(int))
    ids_proposta = set(proposta["Negócio - ID"].dropna().astype(int))
    ids_noshow = set(noshow["Negócio - ID"].dropna().astype(int))

    neg["_id"] = neg["Negócio - ID"].astype("Int64")
    neg["tem_reuniao"] = neg["_id"].apply(lambda x: int(x) in ids_reuniao if pd.notna(x) else False)
    neg["tem_proposta"] = neg["_id"].apply(lambda x: int(x) in ids_proposta if pd.notna(x) else False)
    neg["tem_noshow"] = neg["_id"].apply(lambda x: int(x) in ids_noshow if pd.notna(x) else False)

    neg["valor"] = pd.to_numeric(neg["Negócio - Valor"], errors="coerce").fillna(0.0)
    # Vendas com R$0 = indicações/cortesias → NÃO contam como venda (nem no win rate)
    neg["is_ganho"] = (neg["Negócio - Status"] == "Ganho") & (neg["valor"] > 0)
    neg["is_indicacao"] = (neg["Negócio - Status"] == "Ganho") & (neg["valor"] <= 0)
    neg["is_perdido"] = neg["Negócio - Status"] == "Perdido"
    neg["is_aberto"] = neg["Negócio - Status"] == "Aberto"
    neg["is_quali_ok"] = neg["Negócio - Qualificação/Feedback:"].isin(QUALI_OK)
    neg["_ciclo"] = (neg["_ganho"] - neg["_criado"]).dt.days
    # Reunião Qualificada = negócio qualificado (OK) que teve reunião concluída
    neg["is_rq"] = neg["is_quali_ok"] & neg["tem_reuniao"]

    # ---------- KPIs globais (2025-2026) ----------
    # won_df permite atribuir Vendas/Faturamento a um cohort diferente (mês do GANHO)
    # do cohort de criação usado para criados/reuniões/perdidos.
    def kpis_de(df, mqls=0, won_df=None):
        if won_df is None:
            won_df = df[df["is_ganho"]]
        criados = len(df)
        ganhos = len(won_df)
        perdidos = int(df["is_perdido"].sum())
        abertos = int(df["is_aberto"].sum())
        fat = float(won_df["valor"].sum())
        quali = int(df["is_quali_ok"].sum())
        reun = int(df["tem_reuniao"].sum())
        rq = int(df["is_rq"].sum())
        prop = int(df["tem_proposta"].sum())
        nsh = int(df["tem_noshow"].sum())
        ciclo = won_df["_ciclo"]
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

    # ---------- Série mensal ----------
    # criados/reuniões/perdidos = cohort por CRIAÇÃO; vendas/faturamento = mês do GANHO.
    won = neg[neg["is_ganho"]]
    won_por_gmes = {m: sub for m, sub in won.groupby("g_anomes")}
    meses_univ = sorted(set(neg["AnoMes"].dropna()) | set(won["g_anomes"].dropna()) | set(mqls_mes.keys()))
    grp = {m: sub for m, sub in neg.groupby("AnoMes")}
    mensal = []
    for m in meses_univ:
        a, me = m.split("-")
        sub = grp.get(m, neg.iloc[0:0])
        wsub = won_por_gmes.get(m, neg.iloc[0:0])
        k = kpis_de(sub, mqls_mes.get(m, 0), won_df=wsub)
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
    # criados/reuniões/perdidos por CRIAÇÃO; vendas/faturamento por mês do GANHO.
    def _rec_vazio(a, me):
        return {"ano": int(a), "mes": int(me), "criados": 0, "ganhos": 0, "perdidos": 0,
                "faturamento": 0.0, "qualificados": 0, "com_reuniao": 0, "rq": 0, "no_show": 0}
    def ranking_mensal(df, col_pessoa):
        out = {}
        for (pessoa, m), sub in df.groupby([col_pessoa, "AnoMes"]):
            pessoa = "(sem dono)" if pd.isna(pessoa) else str(pessoa)
            a, me = m.split("-")
            rec = out.setdefault(pessoa, {}).setdefault(m, _rec_vazio(a, me))
            rec["criados"] += len(sub)
            rec["perdidos"] += int(sub["is_perdido"].sum())
            rec["qualificados"] += int(sub["is_quali_ok"].sum())
            rec["com_reuniao"] += int(sub["tem_reuniao"].sum())
            rec["rq"] += int(sub["is_rq"].sum())
            rec["no_show"] += int(sub["tem_noshow"].sum())
        for (pessoa, m), sub in df[df["is_ganho"]].groupby([col_pessoa, "g_anomes"]):
            pessoa = "(sem dono)" if pd.isna(pessoa) else str(pessoa)
            a, me = m.split("-")
            rec = out.setdefault(pessoa, {}).setdefault(m, _rec_vazio(a, me))
            rec["ganhos"] += len(sub)
            rec["faturamento"] = round(rec["faturamento"] + float(sub["valor"].sum()), 2)
        return out

    closers_raw = ranking_mensal(neg, "Negócio - Proprietário")

    def empacota(raw, marca_bot=False):
        lst = []
        for nome, meses in raw.items():
            serie = [dict(periodo=p, **v) for p, v in sorted(meses.items())]
            item = {"nome": nome, "mensal": serie}
            if marca_bot:
                item["is_bot"] = ("bot" in nome.lower())
                item["sem_sdr"] = nome in ("(sem dono)", "Sem SDR", "(sem SDR)")
            lst.append(item)
        return lst

    closers = empacota(closers_raw)

    # ---------- SDRs por ATIVIDADE (não por negócio) ----------
    # Propostas WhatsApp · Reuniões total · Reuniões com Qualificação OK · No-show
    # Bucketado pela DATA da atividade (quando o SDR fez o trabalho).
    av = ativ.copy()
    av["_dt"] = pd.to_datetime(av["Atividade - Data adicionada"], errors="coerce")
    av = av[av["_dt"].dt.year >= ANO_INI]
    av["AnoMes"] = av["_dt"].dt.to_period("M").astype(str)
    av["sdr"] = av["Negócio - Proprietário SDR"].fillna("(sem SDR)").astype(str)
    av["_ok"] = av["Negócio - Qualificação/Feedback:"].isin(QUALI_OK)
    av["is_reu"] = av["_tipo"].str.contains("Reuni", case=False, na=False)
    av["is_prop"] = av["_tipo"].str.contains("Proposta", case=False, na=False)
    av["is_ns"] = av["_tipo"].str.contains("No Show", case=False, na=False)
    av["is_reu_ok"] = av["is_reu"] & av["_ok"]
    sdr_raw_at = {}
    for (sdr, m), sub in av.groupby(["sdr", "AnoMes"]):
        a, me = m.split("-")
        sdr_raw_at.setdefault(sdr, {})[m] = {
            "ano": int(a), "mes": int(me),
            "propostas": int(sub["is_prop"].sum()),
            "reunioes_total": int(sub["is_reu"].sum()),
            "reunioes_ok": int(sub["is_reu_ok"].sum()),
            "no_show": int(sub["is_ns"].sum()),
        }
    sdrs = empacota(sdr_raw_at, marca_bot=True)

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
    reu["_ok"] = reu["Negócio - Qualificação/Feedback:"].isin(QUALI_OK)
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
    neg["_tipocurso"] = neg["_curso"].apply(curso_tipo)   # mba | pos | imersoes | outros
    # Negócios ganhos com data de ganho válida (vendas/faturamento por mês do GANHO)
    won_g = neg[neg["is_ganho"] & neg["_ganho"].notna()].copy()
    won_g["g_ano"] = won_g["_ganho"].dt.year
    won_g["g_mes"] = won_g["_ganho"].dt.month
    cc_acc = {}
    for (c, cu, a, me), sub in neg.groupby(["_closer", "_curso", "ano", "mes"]):
        cc_acc[(c, cu, int(a), int(me))] = {
            "closer": c, "curso": cu, "ano": int(a), "mes": int(me),
            "reunioes": int(sub["tem_reuniao"].sum()), "vendas": 0, "faturamento": 0.0,
        }
    for (c, cu, a, me), sub in won_g.groupby(["_closer", "_curso", "g_ano", "g_mes"]):
        rec = cc_acc.get((c, cu, int(a), int(me)))
        if rec is None:
            rec = cc_acc[(c, cu, int(a), int(me))] = {"closer": c, "curso": cu, "ano": int(a), "mes": int(me), "reunioes": 0, "vendas": 0, "faturamento": 0.0}
        rec["vendas"] += len(sub)
        rec["faturamento"] = round(rec["faturamento"] + float(sub["valor"].sum()), 2)
    closer_curso_mensal = list(cc_acc.values())

    # ---------- DIÁRIO: Vendas por Closer × Curso (data do Ganho) ----------
    gan2 = neg[neg["is_ganho"]].copy()
    gan2 = gan2[gan2["_ganho"].dt.year >= ANO_INI]
    gan2["data"] = gan2["_ganho"].dt.strftime("%Y-%m-%d")
    venda_closer_curso_diario = []
    for (c, cu, d), sub in gan2.groupby(["_closer", "_curso", "data"]):
        venda_closer_curso_diario.append({
            "closer": c, "curso": cu, "data": d,
            "qtd": len(sub),
            "faturamento": round(float(sub["valor"].sum()), 2),
        })

    # ---------- Performance por Curso (mensal) ----------
    # criados/reuniões/perdidos por CRIAÇÃO; vendas/faturamento por mês do GANHO.
    cm_acc = {}
    for (cu, a, me), sub in neg.groupby(["_curso", "ano", "mes"]):
        cm_acc[(cu, int(a), int(me))] = {
            "curso": cu, "ano": int(a), "mes": int(me), "criados": len(sub),
            "ganhos": 0, "perdidos": int(sub["is_perdido"].sum()), "faturamento": 0.0,
            "qualificados": int(sub["is_quali_ok"].sum()), "com_reuniao": int(sub["tem_reuniao"].sum()),
            "rq": int(sub["is_rq"].sum()),
        }
    for (cu, a, me), sub in won_g.groupby(["_curso", "g_ano", "g_mes"]):
        rec = cm_acc.get((cu, int(a), int(me)))
        if rec is None:
            rec = cm_acc[(cu, int(a), int(me))] = {"curso": cu, "ano": int(a), "mes": int(me), "criados": 0, "ganhos": 0, "perdidos": 0, "faturamento": 0.0, "qualificados": 0, "com_reuniao": 0, "rq": 0}
        rec["ganhos"] += len(sub)
        rec["faturamento"] = round(rec["faturamento"] + float(sub["valor"].sum()), 2)
    curso_mensal = list(cm_acc.values())

    # ---------- Breakdown por TIPO de curso (filtro do front: MBA/Pós/Imersão) ----------
    # CLOSER × tipo × mês (métricas de negócio; vendas/fat por mês do GANHO)
    def _ct_vazio(c, tp, a, me):
        return {"closer": c, "tipo": tp, "ano": int(a), "mes": int(me), "criados": 0, "perdidos": 0,
                "qualificados": 0, "com_reuniao": 0, "rq": 0, "no_show": 0, "ganhos": 0, "faturamento": 0.0}
    ct_acc = {}
    for (c, tp, a, me), sub in neg.groupby(["_closer", "_tipocurso", "ano", "mes"]):
        rec = ct_acc.setdefault((c, tp, int(a), int(me)), _ct_vazio(c, tp, a, me))
        rec["criados"] += len(sub); rec["perdidos"] += int(sub["is_perdido"].sum())
        rec["qualificados"] += int(sub["is_quali_ok"].sum()); rec["com_reuniao"] += int(sub["tem_reuniao"].sum())
        rec["rq"] += int(sub["is_rq"].sum()); rec["no_show"] += int(sub["tem_noshow"].sum())
    for (c, tp, a, me), sub in won_g.groupby(["_closer", "_tipocurso", "g_ano", "g_mes"]):
        rec = ct_acc.setdefault((c, tp, int(a), int(me)), _ct_vazio(c, tp, a, me))
        rec["ganhos"] += len(sub); rec["faturamento"] = round(rec["faturamento"] + float(sub["valor"].sum()), 2)
    closer_tipo_mensal = list(ct_acc.values())

    # SDR × tipo × mês (atividades; herda o tipo do produto do negócio via Negócio - ID)
    id_tipo = dict(zip(neg["Negócio - ID"], neg["_tipocurso"]))
    av["_tipocurso"] = av["Negócio - ID"].map(id_tipo).fillna("outros")
    st_acc = {}
    for (s, tp, m), sub in av.groupby(["sdr", "_tipocurso", "AnoMes"]):
        a, me = m.split("-")
        st_acc[(s, tp, m)] = {
            "sdr": s, "tipo": tp, "ano": int(a), "mes": int(me),
            "propostas": int(sub["is_prop"].sum()), "reunioes_total": int(sub["is_reu"].sum()),
            "reunioes_ok": int(sub["is_reu_ok"].sum()), "no_show": int(sub["is_ns"].sum()),
        }
    sdr_tipo_mensal = list(st_acc.values())

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
        "closer_tipo_mensal": closer_tipo_mensal,
        "sdr_tipo_mensal": sdr_tipo_mensal,
        "closers": closers,
        "sdrs": sdrs,
        "sdr_reunioes_diario": sdr_reunioes_diario,
        "closer_vendas_diario": closer_vendas_diario,
        "venda_closer_curso_diario": venda_closer_curso_diario,
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
