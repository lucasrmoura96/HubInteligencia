/* ============================================================
   HUB AGROADVANCE — Insight IA (botão "Coletar insight IA")
   ------------------------------------------------------------
   Coleta o RESUMO do recorte filtrado no momento (KPIs, ranking,
   funil, MQLs/dia) e envia ao Worker da Cloudflare, que chama o GPT
   com a chave SEGURA (no servidor) e devolve o insight.

   >>> CONFIGURE AQUI depois de publicar o Worker: <<<
   ============================================================ */
const INSIGHT_API_URL = "COLE_AQUI_A_URL_DO_SEU_WORKER"; // preenchido após `wrangler deploy`
const INSIGHT_HUB_TOKEN = "0a037157967fedbfb1e9a42ba21530aeedb4fd7186355081"; // = HUB_TOKEN do Worker

(function () {
  const r2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);

  // ---------- Coleta o recorte filtrado atual ----------
  function collectResumo() {
    const tab = STATE.tab;
    const k = calcKpisFiltrados();
    const rank = (typeof calcRankingFiltrado === "function") ? calcRankingFiltrado() : null;
    const diario = (typeof getDiarioFiltrado === "function") ? getDiarioFiltrado() : [];

    let diarioResumo = null;
    if (diario.length) {
      const totMq = diario.reduce((a, d) => a + (d.mqls || 0), 0);
      const totLe = diario.reduce((a, d) => a + (d.leads || 0), 0);
      const melhor = diario.reduce((a, d) => (d.mqls > a.mqls ? d : a), diario[0]);
      const pior = diario.reduce((a, d) => (d.mqls < a.mqls ? d : a), diario[0]);
      diarioResumo = {
        dias: diario.length,
        total_mqls: totMq,
        total_leads: totLe,
        pct_mql_medio: totLe ? r2(totMq / totLe * 100) : 0,
        melhor_dia: { data: melhor.data, mqls: melhor.mqls },
        pior_dia: { data: pior.data, mqls: pior.mqls },
      };
    }

    const fmtCamp = (c) => ({
      campanha: c.campanha, leads: c.leads, mqls: c.mqls,
      pct_mql: r2(c.pct_mql), custo: r2(c.custo),
    });

    return {
      aba: tab === "fundo" ? "Fundo (comercial / vendas)" : "Topo (marketing / topo de funil)",
      periodo: (typeof labelPeriodoAtual === "function") ? labelPeriodoAtual() : "—",
      filtros: {
        tipo_curso: STATE.tipoCurso,
        cursos: STATE.cursos || [],
        visao_temporal: STATE.visaoOrigem ? "data de conversão de origem" : "data do evento",
      },
      kpis: {
        leads: k.leads, mqls: k.mqls, pct_mql: r2(k.pct_mql),
        investimento: r2(k.custo), cpl: r2(k.cpl), cpmql: r2(k.cpmql),
        reunioes: k.reunioes, ganhos_vendas: k.ganhos, faturamento: r2(k.faturamento),
        ticket_medio: r2(k.ticket_medio), roas: r2(k.roas), cac: r2(k.cac),
        taxa_mql_reuniao: r2(k.pct_mql_reuniao), taxa_reuniao_venda: r2(k.pct_reuniao_ganho),
      },
      ranking_campanhas: rank ? {
        melhores_pct_mql: (rank.top5 || []).map(fmtCamp),
        piores_pct_mql: (rank.bottom5 || []).map(fmtCamp),
      } : null,
      mqls_por_dia: diarioResumo,
    };
  }

  // ---------- Markdown -> HTML (mínimo e seguro) ----------
  function mdToHtml(md) {
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*(?!\*)(.+?)\*/g, "<em>$1</em>");
    const lines = esc(md).split("\n");
    let html = "", inList = false;
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    for (const raw of lines) {
      const l = raw.trim();
      if (/^###?\s+/.test(l)) { closeList(); html += "<h3>" + inline(l.replace(/^###?\s+/, "")) + "</h3>"; }
      else if (/^[-*]\s+/.test(l)) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inline(l.replace(/^[-*]\s+/, "")) + "</li>"; }
      else if (l === "") { closeList(); }
      else { closeList(); html += "<p>" + inline(l) + "</p>"; }
    }
    closeList();
    return html;
  }

  // ---------- Modal ----------
  function getModal() {
    let ov = document.getElementById("insightModal");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "insightModal";
    ov.className = "insight-overlay hidden";
    ov.innerHTML = `
      <div class="insight-card">
        <div class="insight-head">
          <div class="insight-title"><span class="insight-spark">✨</span> Insight IA <span class="insight-period" id="insightPeriod"></span></div>
          <div class="insight-actions">
            <button class="insight-copy" id="insightCopy" title="Copiar">Copiar</button>
            <button class="insight-close" id="insightClose" aria-label="Fechar">✕</button>
          </div>
        </div>
        <div class="insight-body" id="insightBody"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) fechar(); });
    ov.querySelector("#insightClose").addEventListener("click", fechar);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
    return ov;
  }
  function abrir() { getModal().classList.remove("hidden"); document.documentElement.style.overflow = "hidden"; }
  function fechar() { const m = document.getElementById("insightModal"); if (m) m.classList.add("hidden"); document.documentElement.style.overflow = ""; }

  function setLoading(periodo) {
    const ov = getModal();
    ov.querySelector("#insightPeriod").textContent = periodo ? "· " + periodo : "";
    ov.querySelector("#insightBody").innerHTML =
      '<div class="insight-loading"><div class="insight-spinner"></div><p>Analisando o recorte filtrado…</p></div>';
    ov.querySelector("#insightCopy").style.display = "none";
    abrir();
  }
  function setErro(msg) {
    getModal().querySelector("#insightBody").innerHTML =
      '<div class="insight-erro"><strong>Não rolou.</strong><br>' + String(msg || "Erro desconhecido.") + "</div>";
  }
  function setInsight(texto) {
    const ov = getModal();
    ov.querySelector("#insightBody").innerHTML = mdToHtml(texto);
    const copy = ov.querySelector("#insightCopy");
    copy.style.display = "";
    copy.onclick = () => {
      navigator.clipboard.writeText(texto).then(() => {
        copy.textContent = "Copiado!"; setTimeout(() => (copy.textContent = "Copiar"), 1500);
      });
    };
  }

  // ---------- Fluxo principal ----------
  async function pedirInsight() {
    if (!STATE || !STATE.data) { return; }
    if (!INSIGHT_API_URL || INSIGHT_API_URL.indexOf("COLE_AQUI") === 0) {
      setLoading(null);
      setErro("Configure a URL do Worker em <code>assets/js/insight.js</code> (INSIGHT_API_URL) e publique. Passo a passo no chat.");
      return;
    }
    const resumo = collectResumo();
    setLoading(resumo.periodo);
    try {
      const r = await fetch(INSIGHT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Token": INSIGHT_HUB_TOKEN },
        body: JSON.stringify({ resumo }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.insight) {
        setErro((data && (data.detail || data.error)) || ("HTTP " + r.status));
        return;
      }
      setInsight(data.insight);
    } catch (e) {
      setErro("Erro de conexão com a IA: " + e.message);
    }
  }

  // Liga o botão quando o DOM estiver pronto
  function bind() {
    const btn = document.getElementById("btnInsightIA");
    if (btn) btn.addEventListener("click", pedirInsight);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.HubInsight = { pedirInsight, collectResumo };
})();
