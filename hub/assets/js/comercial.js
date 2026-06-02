/* ============================================================
   HUB AGROADVANCE — Painel COMERCIAL (v1.5)
   Funil real: MQLs → Reuniões Qualificadas (no-show) → Vendas → Faturamento
   Dados cifrados (área "comercial") via HubAuth. Estilo do painel MKT.
   ============================================================ */
const CMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const cN   = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const cR$  = (n) => (n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', {maximumFractionDigits:0}));
const cPct = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + '%');
const cssVarC = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const escC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// filtro.mes/dia: 'all' OU Array<string>. filtro.range: {de,ate,deNum,ateNum} ou null
const CS = { data: null, filtro: { ano: 'all', mes: 'all', dia: 'all', range: null }, closerSel: null,
             selSdr: 'todos', selCloser: 'todos', selCurso: 'todos', selCursoVenda: 'todos',
             aba: 'sdr' };
let cChartSdr = null, cChartCloser = null, cReunChart = null, cVendaChart = null;
const MS_C = {};  // instâncias dos multi-selects

// ---------- helpers de filtro (mesma lógica do painel MKT) ----------
function cAnoAtivo(a) { const f = CS.filtro.ano; return f === 'all' || String(f) === String(a); }
function cMesAtivo(m) {
  const f = CS.filtro.mes;
  if (f === 'all' || (Array.isArray(f) && f.length === 0)) return true;
  if (Array.isArray(f)) return f.map(String).includes(String(m));
  return String(f) === String(m);
}
function cDiaAtivo(d) {
  const f = CS.filtro.dia;
  if (f === 'all' || (Array.isArray(f) && f.length === 0)) return true;
  if (Array.isArray(f)) return f.map(String).includes(String(d));
  return String(f) === String(d);
}
function cNenhumFiltro() {
  const f = CS.filtro;
  if (f.range) return false;
  const mesAll = f.mes === 'all' || (Array.isArray(f.mes) && f.mes.length === 0);
  const diaAll = f.dia === 'all' || (Array.isArray(f.dia) && f.dia.length === 0);
  return f.ano === 'all' && mesAll && diaAll;
}
function cDataParaNum(s) { const [y,m,d] = String(s).split('-').map(Number); return y*10000 + m*100 + d; }
function cTupleAtivo(ano, mes, dia = null) {
  const r = CS.filtro.range;
  if (r) {
    const deN = r.deNum, ateN = r.ateNum, m = parseInt(mes,10);
    if (dia != null) { const n = ano*10000 + m*100 + parseInt(dia,10); return n>=deN && n<=ateN; }
    const last = new Date(ano, m, 0).getDate();
    return (ano*10000+m*100+last) >= deN && (ano*10000+m*100+1) <= ateN;
  }
  return cAnoAtivo(ano) && cMesAtivo(mes) && (dia == null || cDiaAtivo(dia));
}
function cDataIsoAtiva(iso) {
  if (!iso) return false;
  const r = CS.filtro.range;
  if (r) { const n = cDataParaNum(iso); return n >= r.deNum && n <= r.ateNum; }
  const [y,m,d] = iso.split('-');
  return cAnoAtivo(y) && cMesAtivo(parseInt(m,10)) && cDiaAtivo(parseInt(d,10));
}
function cMesesSel() { const f = CS.filtro.mes; if (f==='all') return null; if (Array.isArray(f)) return f.length?f.map(String):null; return [String(f)]; }
function cDiasSel() { const f = CS.filtro.dia; if (f==='all') return null; if (Array.isArray(f)) return f.length?f.map(String):null; return [String(f)]; }

// data 'YYYY-MM-DD' bate com o filtro? (séries diárias)
function dataNoFiltro(dataStr) { return cDataIsoAtiva(dataStr); }

function somaMeses(serie) {
  const acc = { mqls:0, criados:0, ganhos:0, perdidos:0, faturamento:0, qualificados:0,
                com_reuniao:0, reunioes_qualificadas:0, com_proposta:0, no_show:0, abertos:0 };
  (serie || []).forEach(m => {
    if (!cTupleAtivo(m.ano, m.mes)) return;
    for (const k in acc) acc[k] += (m[k] || 0);
  });
  return acc;
}

// ---------- Multi-select com checkboxes (igual ao MKT) ----------
function createMultiSelectC(config) {
  const { mount, label, options, placeholder = 'Todos', onChange } = config;
  mount.classList.add('ms-dropdown');
  mount.innerHTML = `
    <button type="button" class="ms-btn"><span class="ms-label">${escC(label)}:</span>
      <span class="ms-value">${escC(placeholder)}</span>
      <svg class="ms-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
    <div class="ms-panel" hidden>
      <div class="ms-actions"><button type="button" class="ms-action ms-all">Todos</button><button type="button" class="ms-action ms-none">Limpar</button></div>
      <div class="ms-list">${options.map(o => `<label class="ms-item" data-value="${escC(o.value)}"><input type="checkbox" value="${escC(o.value)}" /><span>${escC(o.text)}</span></label>`).join('')}</div>
    </div>`;
  const btn = mount.querySelector('.ms-btn'), panel = mount.querySelector('.ms-panel'),
        valueEl = mount.querySelector('.ms-value'), inputs = mount.querySelectorAll('.ms-list input');
  const sel = () => Array.from(inputs).filter(i => i.checked).map(i => i.value);
  function lbl() {
    const s = sel();
    if (!s.length) { valueEl.textContent = placeholder; mount.classList.remove('has-selection'); return; }
    if (s.length === 1) { const o = options.find(x => String(x.value)===s[0]); valueEl.textContent = o?o.text:s[0]; }
    else if (s.length === options.length) valueEl.textContent = `Todos (${s.length})`;
    else valueEl.textContent = `${s.length} selecionados`;
    mount.classList.add('has-selection');
  }
  function setValores(arr) { const set = new Set((arr||[]).map(String)); inputs.forEach(i => i.checked = set.has(String(i.value))); lbl(); }
  btn.addEventListener('click', (e) => { e.stopPropagation();
    if (panel.hidden) { document.querySelectorAll('.ms-dropdown.open').forEach(d => { if (d!==mount){ d.querySelector('.ms-panel').hidden=true; d.classList.remove('open'); } }); panel.hidden=false; mount.classList.add('open'); }
    else { panel.hidden=true; mount.classList.remove('open'); } });
  document.addEventListener('click', (e) => { if (!mount.contains(e.target)) { panel.hidden=true; mount.classList.remove('open'); } });
  inputs.forEach(i => i.addEventListener('change', () => { lbl(); onChange(sel()); }));
  mount.querySelector('.ms-all').addEventListener('click', (e) => { e.stopPropagation(); inputs.forEach(i=>i.checked=true); lbl(); onChange(sel()); });
  mount.querySelector('.ms-none').addEventListener('click', (e) => { e.stopPropagation(); inputs.forEach(i=>i.checked=false); lbl(); onChange(sel()); });
  lbl();
  return { setValores };
}
function derivar(a) {
  return { ...a,
    win_rate: (a.ganhos + a.perdidos) ? a.ganhos/(a.ganhos+a.perdidos)*100 : 0,
    ticket: a.ganhos ? a.faturamento/a.ganhos : 0,
    taxa_qualificacao: a.criados ? a.qualificados/a.criados*100 : 0,
    no_show_rate: (a.com_reuniao + a.no_show) ? a.no_show/(a.com_reuniao+a.no_show)*100 : 0,
    conv_mql_rq: a.mqls ? a.reunioes_qualificadas/a.mqls*100 : 0,
    conv_rq_venda: a.reunioes_qualificadas ? a.ganhos/a.reunioes_qualificadas*100 : 0,
  };
}

// Fonte de dados: global OU closer selecionado (cross-filter)
function serieAtiva() {
  if (CS.closerSel) {
    const c = (CS.data.closers || []).find(x => x.nome === CS.closerSel);
    return c ? c.mensal : [];
  }
  return CS.data.mensal;
}

// ---- SDR é medido por ATIVIDADE: propostas WA · reuniões total · reuniões quali OK · no-show ----
// Série mensal agregada de TODOS os SDRs + MQLs (do RD, contexto de topo)
function getSdrMensal() {
  const acc = {};
  const get = (a, me) => (acc[a + '-' + me] || (acc[a + '-' + me] = { ano:a, mes:me, mqls:0, propostas:0, reunioes_total:0, reunioes_ok:0, no_show:0 }));
  (CS.data.sdrs || []).forEach(s => (s.mensal || []).forEach(m => {
    const A = get(m.ano, m.mes);
    A.propostas += m.propostas||0; A.reunioes_total += m.reunioes_total||0; A.reunioes_ok += m.reunioes_ok||0; A.no_show += m.no_show||0;
  }));
  (CS.data.mensal || []).forEach(m => { get(m.ano, m.mes).mqls += m.mqls||0; });
  return Object.values(acc).sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
}
function somaSdr(serie) {
  const acc = { mqls:0, propostas:0, reunioes_total:0, reunioes_ok:0, no_show:0 };
  (serie || []).forEach(m => { if (!cTupleAtivo(m.ano, m.mes)) return; for (const k in acc) acc[k] += (m[k] || 0); });
  acc.no_show_rate = (acc.reunioes_total + acc.no_show) ? acc.no_show / (acc.reunioes_total + acc.no_show) * 100 : 0;
  acc.aproveitamento = acc.reunioes_total ? acc.reunioes_ok / acc.reunioes_total * 100 : 0;
  acc.conv_mql_rq = acc.mqls ? acc.reunioes_ok / acc.mqls * 100 : 0;
  return acc;
}

// ---------- MoM: período anterior comparável (só quando 1 mês + 1 ano, sem dia/range) ----------
function kpisPeriodoAnterior() {
  const f = CS.filtro;
  if (f.range) return null;
  const mSel = cMesesSel(), dSel = cDiasSel();
  if (f.ano === 'all' || !mSel || mSel.length !== 1 || (dSel && dSel.length)) return null;
  let ano = parseInt(f.ano,10), mes = parseInt(mSel[0],10) - 1;
  if (mes < 1) { mes = 12; ano -= 1; }
  const serie = serieAtiva();
  const acc = { mqls:0, criados:0, ganhos:0, perdidos:0, faturamento:0, qualificados:0, com_reuniao:0, reunioes_qualificadas:0, no_show:0, abertos:0, com_proposta:0 };
  (serie||[]).forEach(m => { if (m.ano===ano && m.mes===mes) for (const k in acc) acc[k]+=(m[k]||0); });
  return derivar(acc);
}
function badge(atual, ant, inverter=false) {
  if (ant == null || atual == null || ant === 0) return '';
  const diff = (atual - ant) / ant * 100;
  if (Math.abs(diff) < 0.05) return `<span class="kpi-yoy flat">— MoM</span>`;
  let dir = diff > 0 ? 'up' : 'down';
  if (inverter) dir = dir === 'up' ? 'down' : 'up';
  const seta = diff > 0 ? '↑' : '↓';
  return `<span class="kpi-yoy ${dir}">${seta} ${Math.abs(diff).toLocaleString('pt-BR',{maximumFractionDigits:1})}% MoM</span>`;
}

function labelPeriodoC() {
  const f = CS.filtro;
  let base;
  if (f.range) {
    const fmt = (s) => s.split('-').reverse().join('/');
    base = `${fmt(f.range.de)} → ${fmt(f.range.ate)}`;
  } else {
    const p = [], mSel = cMesesSel(), dSel = cDiasSel();
    if (dSel) p.push(dSel.length === 1 ? `Dia ${dSel[0]}` : `${dSel.length} dias`);
    if (mSel) p.push(mSel.length === 1 ? CMES[parseInt(mSel[0],10)-1] : `${mSel.length} meses`);
    if (f.ano !== 'all') p.push(String(f.ano));
    base = p.length ? p.join(' · ') : 'Tudo (2025-2026)';
  }
  if (CS.closerSel) base = `${CS.closerSel} · ${base}`;
  return base;
}

// ---------- KPIs por aba ----------
function kpiHero(label, val, sub, badgeHtml) {
  return `<div class="kpi-cell hero fundo"><span class="kpi-label">${label}</span><span class="kpi-value">${val}</span>${badgeHtml||''}<span class="kpi-sub">${sub}</span></div>`;
}
function kpiSec(label, val, sub, alerta) {
  return `<div class="kpi-cell ${alerta?'alert':''}"><span class="kpi-label">${label}</span><span class="kpi-value t-num">${val}</span><span class="kpi-sub">${sub}</span></div>`;
}

function renderKpisSdr() {
  const k = somaSdr(getSdrMensal());   // SDR = atividades (propostas, reuniões, no-show)
  const hint = document.getElementById('cKpiSdrHint'); if (hint) hint.textContent = labelPeriodoC();
  const heroes = `<div class="kpi-heroes">
    ${kpiHero('◆ MQLs', cN(k.mqls), 'leads qualificados (RD)', '')}
    ${kpiHero('Reuniões realizadas', cN(k.reunioes_total), `<span class="hero-rate">aproveitamento <b>${cPct(k.aproveitamento)}</b></span>`, '')}
    ${kpiHero('Reuniões Qualif. OK', cN(k.reunioes_ok), `<span class="hero-rate">de ${cN(k.reunioes_total)} reuniões</span>`, '')}
    ${kpiHero('No-show', cN(k.no_show), `${cPct(k.no_show_rate)} das agendadas`, '')}
  </div>`;
  const sec = `<div class="kpi-grid-sec">
    ${kpiSec('Propostas WhatsApp', cN(k.propostas), 'enviadas')}
    ${kpiSec('Conversão MQL→RQ', cPct(k.conv_mql_rq), 'MQL → reunião quali. OK')}
    ${kpiSec('Aproveitamento', cPct(k.aproveitamento), 'reuniões OK ÷ total')}
    ${kpiSec('No-show', cPct(k.no_show_rate), 'das reuniões agendadas', k.no_show_rate>=30)}
  </div>`;
  document.getElementById('cKpiSdr').innerHTML = heroes + sec;
}

function renderKpisCloser() {
  const k = derivar(somaMeses(serieAtiva()));
  const ant = kpisPeriodoAnterior();
  const cicloMed = CS.data.kpis ? CS.data.kpis.ciclo_mediana_dias : null;
  const B = (cur, key) => ant ? badge(cur, ant[key]) : '';
  const hint = document.getElementById('cKpiCloserHint'); if (hint) hint.textContent = labelPeriodoC();
  const heroes = `<div class="kpi-heroes">
    ${kpiHero('Vendas', cN(k.ganhos), `${cN(k.perdidos)} perdidos`, B(k.ganhos,'ganhos'))}
    ${kpiHero('Faturamento', cR$(k.faturamento), `ticket ${cR$(k.ticket)}`, B(k.faturamento,'faturamento'))}
    ${kpiHero('Win rate', cPct(k.win_rate), 'ganhos ÷ (ganhos+perdidos)', '')}
    ${kpiHero('Conversão RQ→Venda', cPct(k.conv_rq_venda), 'da reunião qual. à venda', '')}
  </div>`;
  const sec = `<div class="kpi-grid-sec">
    ${kpiSec('Reuniões Qualificadas', cN(k.reunioes_qualificadas), 'base do fechamento')}
    ${kpiSec('Ticket médio', cR$(k.ticket), 'por venda')}
    ${kpiSec('Negócios criados', cN(k.criados), 'no pipeline')}
    ${kpiSec('Ciclo (mediana)', cicloMed==null?'—':`${cicloMed} dia(s)`, 'criação → ganho · geral')}
  </div>`;
  document.getElementById('cKpiCloser').innerHTML = heroes + sec;
}

// ---------- Evolução mensal (genérica) ----------
function mesesParaSerie(serie) {
  let meses = (serie || []).slice();
  if (CS.filtro.ano !== 'all') meses = meses.filter(m => cAnoAtivo(m.ano));
  else meses = meses.slice(-14);
  return meses;
}
function buildSerie(canvasId, prevChart, meses, datasets, comLinha) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (prevChart) prevChart.destroy();
  const txt = cssVarC('--text-muted'), grid = cssVarC('--chart-grid');
  const labelsCol = {
    id: 'labelsCol',
    afterDatasetsDraw(chart) {
      const c = chart.ctx; c.save();
      c.font = '700 11px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type === 'line') return;
        chart.getDatasetMeta(di).data.forEach((bar, idx) => {
          const v = ds.data[idx]; if (!v) return;
          c.fillStyle = ds._lblColor || txt; c.fillText(cN(v), bar.x, bar.y - 4);
        });
      });
      c.restore();
    },
  };
  const scales = {
    x: { grid: { display:false }, ticks: { color:txt, font:{ family:'JetBrains Mono, monospace', size:12 } } },
    y: { position:'left', beginAtZero:true, grid:{ color:grid }, ticks:{ color:txt, font:{ family:'JetBrains Mono, monospace', size:12 } } },
  };
  if (comLinha) scales.y1 = { position:'right', beginAtZero:true, grid:{ display:false }, ticks:{ color:txt, font:{ family:'JetBrains Mono, monospace', size:11 }, callback:v=>'R$ '+(v/1000)+'k' } };
  return new Chart(ctx, {
    type: 'bar', plugins: [labelsCol],
    data: { labels: meses.map(m => `${CMES[m.mes-1]}/${String(m.ano).slice(-2)}`), datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode:'index', intersect:false },
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { position:'bottom', labels: { color:txt, font:{ family:'JetBrains Mono, monospace', size:12 }, usePointStyle:true, pointStyle:'rectRounded', padding:14 } },
        tooltip: { callbacks: { label: (c) => c.dataset.yAxisID==='y1' ? '  Faturamento '+cR$(c.parsed.y) : '  '+c.dataset.label+' '+cN(c.parsed.y) } },
      },
      scales,
    },
  });
}
function renderSerieSdr() {
  const accent = cssVarC('--chart-2')||'#3b82f6', brand = cssVarC('--chart-1')||'#1fb541';
  const meses = mesesParaSerie(getSdrMensal());
  cChartSdr = buildSerie('cSerieSdr', cChartSdr, meses, [
    { label:'Reuniões total', data: meses.map(m => m.reunioes_total||0), backgroundColor: accent+'aa', borderRadius:4, yAxisID:'y', _lblColor: accent },
    { label:'Reuniões Quali OK', data: meses.map(m => m.reunioes_ok||0), backgroundColor: brand, borderRadius:4, yAxisID:'y', _lblColor: brand },
  ], false);
}
function renderSerieCloser() {
  const brand = cssVarC('--chart-1')||'#1fb541', sand = cssVarC('--chart-3')||'#d99a2b';
  const meses = mesesParaSerie(serieAtiva());
  cChartCloser = buildSerie('cSerieCloser', cChartCloser, meses, [
    { label:'Vendas', data: meses.map(m => m.ganhos||0), backgroundColor: brand, borderRadius:4, yAxisID:'y', _lblColor: brand },
    { label:'Faturamento', data: meses.map(m => m.faturamento||0), type:'line', borderColor: sand, borderWidth:2.5, tension:0.3, fill:false, yAxisID:'y1', pointRadius:2, order:0 },
  ], true);
}

// ---------- Funil centralizado (genérico) ----------
function renderFunilGenerico(innerId, etapas) {
  const base = Math.max(...etapas.map(e => e.valor || 0), 1);
  let html = '';
  etapas.forEach((e, i) => {
    const isNull = e.valor == null;
    const larg = isNull ? 30 : Math.max(22, (e.valor / base) * 100);
    const valTxt = isNull ? '—' : cN(e.valor);
    const fat = e.faturamento != null ? `<span class="fv-fat">${cR$(e.faturamento)}</span>` : '';
    html += `<div class="fv-stage" style="width:${larg}%; background:linear-gradient(135deg, ${e.cor}, ${e.cor}cc)"><span class="fv-nome">${e.etapa}</span><span class="fv-val">${valTxt}${fat}</span></div>`;
    if (i < etapas.length - 1) {
      const prox = etapas[i+1].valor, atual = e.valor;
      const conv = (prox != null && atual) ? (prox / atual * 100) : null;
      html += `<div class="fv-conn">${conv == null ? '▾' : '▾ ' + cPct(conv) + ' do anterior'}</div>`;
    }
  });
  document.getElementById(innerId).innerHTML = html;
}
function renderFunilSdr() {
  const k = somaSdr(getSdrMensal());
  renderFunilGenerico('cFunilSdr', [
    { etapa: 'MQLs', valor: k.mqls, cor: '#3b82f6' },
    { etapa: 'Reuniões realizadas', valor: k.reunioes_total, cor: '#1fb541' },
    { etapa: 'Reuniões Qualif. OK', valor: k.reunioes_ok, cor: '#0f7c2e' },
  ]);
}
function renderFunilCloser() {
  const k = derivar(somaMeses(serieAtiva()));
  renderFunilGenerico('cFunilCloser', [
    { etapa: 'Reuniões Qualificadas', valor: k.reunioes_qualificadas, cor: '#1fb541' },
    { etapa: 'Vendas', valor: k.ganhos, faturamento: k.faturamento, cor: '#0f7c2e' },
  ]);
}

// ---------- Pódio + Ranking Closers ----------
function closersAgreg() {
  return (CS.data.closers || []).map(c => {
    const a = derivar(somaMeses(c.mensal));
    return { nome: c.nome, criados: a.criados, ganhos: a.ganhos, win: a.win_rate, fat: a.faturamento, ticket: a.ticket };
  }).filter(c => c.criados > 0).sort((a,b) => b.fat - a.fat);
}
function iniciais(nome){ return nome.split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase(); }

function renderClosersC() {
  const linhas = closersAgreg();
  document.getElementById('cClosersHint').textContent = `${linhas.length} closers · ${CS.filtro.mes!=='all'?CMES[parseInt(CS.filtro.mes,10)-1]+' ':''}${CS.filtro.ano!=='all'?CS.filtro.ano:'2025-26'}`;
  const top3 = linhas.slice(0,3);
  const medal = ['gold','silver','bronze'], emoji = ['🥇','🥈','🥉'];
  const podio = `
    <div class="podio">
      ${top3.map((c,i) => `
        <div class="podio-card ${medal[i]} ${CS.closerSel===c.nome?'sel':''}" data-closer="${escC(c.nome)}">
          <div class="podio-medal">${emoji[i]}</div>
          <div class="podio-ini">${escC(iniciais(c.nome))}</div>
          <div class="podio-nome">${escC(c.nome)}</div>
          <div class="podio-fat">${cR$(c.fat)}</div>
          <div class="podio-sub">${cN(c.ganhos)} vendas · win ${cPct(c.win)}</div>
        </div>`).join('')}
    </div>`;
  const tabela = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Closer</th><th class="num">Criados</th><th class="num">Vendas</th><th class="num">Win rate</th><th class="num">Faturamento</th><th class="num">Ticket</th></tr></thead>
      <tbody>
        ${linhas.map((c,i) => `
          <tr class="${i<3?'top3':''} ${CS.closerSel===c.nome?'sel':''}" data-closer="${escC(c.nome)}">
            <td class="pos">${i+1}</td><td class="nome">${escC(c.nome)}</td>
            <td class="num">${cN(c.criados)}</td><td class="num"><b>${cN(c.ganhos)}</b></td>
            <td class="num">${cPct(c.win)}</td><td class="num">${cR$(c.fat)}</td><td class="num">${cR$(c.ticket)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  const wrap = document.getElementById('cClosers');
  wrap.innerHTML = podio + tabela;
  // cross-filter: clicar liga/desliga closer
  wrap.querySelectorAll('[data-closer]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const nome = el.getAttribute('data-closer');
      CS.closerSel = (CS.closerSel === nome) ? null : nome;
      renderAllC();
      renderBannerC();
    });
  });
}

// ---------- Pódio + Ranking SDRs (por ATIVIDADE) ----------
function renderSdrsC() {
  const linhas = (CS.data.sdrs || []).map(s => {
    const a = somaSdr(s.mensal);
    return { nome:s.nome, is_bot:s.is_bot, sem:s.sem_sdr, prop:a.propostas, reuT:a.reunioes_total, reuOk:a.reunioes_ok, ns:a.no_show, nsRate:a.no_show_rate };
  }).filter(s => s.reuT>0 || s.prop>0 || s.ns>0).sort((a,b) => b.reuOk - a.reuOk);
  const tag = (s) => s.is_bot ? '<span class="sdr-tag bot">automação</span>' : (s.sem ? '<span class="sdr-tag sem">sem SDR</span>' : '');

  // Pódio: top 3 SDRs HUMANOS por reuniões qualificadas OK
  const humanos = linhas.filter(s => !s.is_bot && !s.sem).slice(0, 3);
  const emoji = ['🥇','🥈','🥉'], medal = ['gold','silver','bronze'];
  const podio = `
    <div class="podio">
      ${humanos.map((s,i) => `
        <div class="podio-card ${medal[i]}">
          <div class="podio-medal">${emoji[i]}</div>
          <div class="podio-ini">${escC(iniciais(s.nome))}</div>
          <div class="podio-nome">${escC(s.nome)}</div>
          <div class="podio-fat">${cN(s.reuOk)} reuniões OK</div>
          <div class="podio-sub">${cN(s.reuT)} reuniões · no-show ${cPct(s.nsRate)}</div>
        </div>`).join('')}
    </div>`;

  const tabela = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>SDR</th><th class="num">Propostas WA</th><th class="num">Reuniões</th><th class="num">Reuniões Quali OK</th><th class="num">No-show</th><th class="num">No-show %</th></tr></thead>
      <tbody>
        ${linhas.map((s,i) => `
          <tr class="${s.is_bot?'is-bot':''}">
            <td class="pos">${i+1}</td><td class="nome">${escC(s.nome)} ${tag(s)}</td>
            <td class="num">${cN(s.prop)}</td><td class="num">${cN(s.reuT)}</td>
            <td class="num"><b>${cN(s.reuOk)}</b></td><td class="num">${cN(s.ns)}</td><td class="num">${cPct(s.nsRate)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  document.getElementById('cSdrs').innerHTML = podio + tabela;
}

// ---------- Helper: chart diário (barras por dia) ----------
function chartDiario(canvasId, innerId, chartRef, linhas, cor, labelMetric, isMoeda) {
  const inner = document.getElementById(innerId);
  const perDay = 26;
  inner.style.minWidth = Math.max(linhas.length * perDay, 600) + 'px';
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (chartRef) chartRef.destroy();
  const txt = cssVarC('--text-muted'), grid = cssVarC('--chart-grid');
  const ch = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: linhas.map(l => { const [,m,d] = l.data.split('-'); return `${d}/${m}`; }),
      datasets: [{ label: labelMetric, data: linhas.map(l => l.v), backgroundColor: cor, borderRadius: 3, barPercentage: 0.78, categoryPercentage: 0.85 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (it) => { const l = linhas[it[0].dataIndex]; const [y,m,d]=l.data.split('-'); return `${d}/${m}/${y}`; },
          label: (c) => '  ' + labelMetric + ' ' + (isMoeda ? cR$(c.parsed.y) : cN(c.parsed.y)) } },
      },
      scales: {
        x: { grid:{ display:false }, ticks:{ color:txt, font:{ family:'JetBrains Mono, monospace', size:13 }, maxRotation:90, minRotation:60, autoSkip: linhas.length>62 } },
        y: { beginAtZero:true, grid:{ color:grid }, ticks:{ color:txt, font:{ family:'JetBrains Mono, monospace', size:12 }, callback: v => isMoeda ? 'R$'+(v/1000)+'k' : v } },
      },
    },
  });
  const scroll = inner.parentElement;
  if (scroll && linhas.length > 31) requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
  return ch;
}

// Paleta para empilhar por pessoa
const PALETA_C = ['#1fb541','#3b82f6','#e0a82e','#9333ea','#ef4444','#06b6d4','#f97316','#ec4899','#84cc16'];

// Pivota linhas diárias por pessoa → datasets empilhados (top N + Outros)
function pivotDiario(rows, pessoaCampo, valorCampo, selecionado, topN = 9) {
  const datas = Array.from(new Set(rows.map(r => r.data))).sort();
  if (selecionado && selecionado !== 'todos') {
    const acc = {}; rows.forEach(r => acc[r.data] = (acc[r.data]||0) + (r[valorCampo]||0));
    return { datas, datasets: [{ label: selecionado, data: datas.map(d => acc[d]||0), backgroundColor: PALETA_C[0], stack: 's' }] };
  }
  const tot = {}; rows.forEach(r => tot[r[pessoaCampo]] = (tot[r[pessoaCampo]]||0) + (r[valorCampo]||0));
  const pessoas = Object.keys(tot).sort((a,b) => tot[b]-tot[a]);
  const top = pessoas.slice(0, topN), temOutros = pessoas.length > topN;
  const mapa = {};
  rows.forEach(r => {
    const p = top.includes(r[pessoaCampo]) ? r[pessoaCampo] : 'Outros';
    (mapa[p] = mapa[p] || {})[r.data] = (mapa[p][r.data]||0) + (r[valorCampo]||0);
  });
  const ordem = [...top]; if (temOutros) ordem.push('Outros');
  const datasets = ordem.map((p, i) => ({
    label: p, data: datas.map(d => (mapa[p] && mapa[p][d]) || 0),
    backgroundColor: p === 'Outros' ? '#9ca3af' : PALETA_C[i % PALETA_C.length],
    stack: 's', borderRadius: 2,
  }));
  return { datas, datasets };
}

function baseStackedOpts(txt, grid, isMoedaY1) {
  return {
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: txt, font: { family:'JetBrains Mono, monospace', size:11 }, usePointStyle:true, pointStyle:'rectRounded', padding:10, boxWidth:9, boxHeight:9 } },
      tooltip: { itemSort: (a,b) => b.parsed.y - a.parsed.y,
        callbacks: { label: (c) => c.dataset.yAxisID==='y1' ? '  Faturamento '+cR$(c.parsed.y) : `  ${c.dataset.label}: ${cN(c.parsed.y)}` } },
    },
    scales: {
      x: { stacked: true, grid: { display:false }, ticks: { color:txt, font:{ family:'JetBrains Mono, monospace', size:13 }, maxRotation:90, minRotation:60 } },
      y: { stacked: true, beginAtZero:true, grid:{ color:grid }, ticks:{ color:txt, font:{ family:'JetBrains Mono, monospace', size:12 } } },
    },
  };
}

// ---------- Heatmap: pessoa (linhas) × data (colunas), número na célula ----------
function renderHeatmap(innerId, rows, pessoaCampo, valorCampo, corRGB, fatCampo) {
  const host = document.getElementById(innerId);
  const datas = Array.from(new Set(rows.map(r => r.data))).sort();
  if (!datas.length) { host.innerHTML = '<div class="hm-empty">Sem dados para esse recorte.</div>'; return; }
  const tot = {}, cell = {}, fat = {};
  rows.forEach(r => {
    tot[r[pessoaCampo]] = (tot[r[pessoaCampo]] || 0) + (r[valorCampo] || 0);
    const key = r[pessoaCampo] + '|' + r.data;
    cell[key] = (cell[key] || 0) + (r[valorCampo] || 0);
    if (fatCampo) fat[key] = (fat[key] || 0) + (r[fatCampo] || 0);
  });
  const pessoas = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  const maxCell = Math.max(...Object.values(cell), 1);
  const fmtD = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };

  const head = `<tr><th class="hm-name">Nome</th><th class="hm-tot">Tot</th>${datas.map(d => `<th>${fmtD(d)}</th>`).join('')}</tr>`;
  const body = pessoas.map(p => {
    const cells = datas.map(d => {
      const v = cell[p + '|' + d] || 0;
      const bg = v ? `background:rgba(${corRGB},${(0.15 + v / maxCell * 0.75).toFixed(2)})` : '';
      const ttl = (fatCampo && v) ? ` title="${cR$(fat[p + '|' + d] || 0)}"` : '';
      return `<td class="hm-cell" style="${bg}"${ttl}>${v || ''}</td>`;
    }).join('');
    return `<tr><td class="hm-name">${escC(p)}</td><td class="hm-tot">${cN(tot[p])}</td>${cells}</tr>`;
  }).join('');
  host.innerHTML = `<table class="hm-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ---------- Reuniões Qualificadas: SDR × Dia ----------
function renderReunDia() {
  const rows = (CS.data.sdr_reunioes_diario || [])
    .filter(r => dataNoFiltro(r.data) && (CS.selSdr === 'todos' || r.sdr === CS.selSdr))
    .map(r => ({ sdr: r.sdr, data: r.data, v: r.qtd_ok || 0 }));
  renderHeatmap('cReunDiaInner', rows, 'sdr', 'v', '59,130,246');
}

// ---------- Vendas: Closer × Dia (filtrável por Curso; célula = nº vendas; hover = faturamento) ----------
function renderVendaDia() {
  // usa o dado diário por closer+curso; soma cursos quando "todos"
  const fonte = CS.data.venda_closer_curso_diario || [];
  const rows = fonte
    .filter(r => dataNoFiltro(r.data)
      && (CS.selCloser === 'todos' || r.closer === CS.selCloser)
      && (CS.selCursoVenda === 'todos' || r.curso === CS.selCursoVenda))
    .map(r => ({ closer: r.closer, data: r.data, v: r.qtd, fat: r.faturamento }));
  renderHeatmap('cVendaDiaInner', rows, 'closer', 'v', '31,181,65', 'fat');
}

// ---------- Closer × Curso ----------
function renderCloserCursoC() {
  const rows = (CS.data.closer_curso_mensal || []).filter(r =>
    cTupleAtivo(r.ano, r.mes) && (CS.selCurso === 'todos' || r.curso === CS.selCurso));
  const acc = {};
  rows.forEach(r => {
    const A = acc[r.closer] || (acc[r.closer] = { closer: r.closer, reunioes: 0, vendas: 0, faturamento: 0 });
    A.reunioes += r.reunioes; A.vendas += r.vendas; A.faturamento += r.faturamento;
  });
  const linhas = Object.values(acc).filter(c => c.reunioes > 0 || c.vendas > 0)
    .sort((a, b) => b.vendas - a.vendas || b.reunioes - a.reunioes);
  const cursoLbl = CS.selCurso === 'todos' ? 'todos os cursos' : CS.selCurso;
  document.getElementById('cCloserCurso').innerHTML = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Closer · <small style="font-weight:400;color:var(--text-soft)">${escC(cursoLbl)}</small></th><th class="num">Reuniões</th><th class="num">Vendas</th><th class="num">Conv. R→V</th><th class="num">Faturamento</th></tr></thead>
      <tbody>
        ${linhas.length ? linhas.map((c, i) => `
          <tr>
            <td class="pos">${i+1}</td><td class="nome">${escC(c.closer)}</td>
            <td class="num">${cN(c.reunioes)}</td><td class="num"><b>${cN(c.vendas)}</b></td>
            <td class="num">${cPct(c.reunioes ? c.vendas/c.reunioes*100 : 0)}</td>
            <td class="num">${cR$(c.faturamento)}</td>
          </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Sem dados para esse recorte.</td></tr>'}
      </tbody>
    </table>`;
}

// ---------- Banner de cross-filter ----------
function renderBannerC() {
  let b = document.getElementById('cBanner');
  if (!b) {
    b = document.createElement('div'); b.id = 'cBanner'; b.className = 'selection-banner';
    const fb = document.querySelector('.filter-bar');
    fb.parentNode.insertBefore(b, fb.nextSibling);
  }
  if (CS.closerSel) {
    b.classList.remove('hidden');
    b.innerHTML = `<span class="sb-tag">Closer selecionado</span><span class="sb-val">${escC(CS.closerSel)}</span>
      <button class="sb-clear" id="cClearSel">✕ Limpar</button>`;
    b.querySelector('#cClearSel').onclick = () => { CS.closerSel = null; renderAllC(); renderBannerC(); };
  } else { b.classList.add('hidden'); }
}

// Pílula colorida de taxa (good/mid/bad). inverted=true => menor é melhor (no-show)
function pillC(v, good, mid, inverted = false) {
  let cls;
  if (inverted) cls = v <= good ? 'good' : (v <= mid ? 'mid' : 'bad');
  else cls = v >= good ? 'good' : (v >= mid ? 'mid' : 'bad');
  return `<span class="pct-pill ${cls}">${cPct(v)}</span>`;
}

// ---------- Performance por Curso ----------
function renderCursoPerf() {
  const acc = {};
  (CS.data.curso_mensal || []).filter(r => cTupleAtivo(r.ano, r.mes)).forEach(r => {
    const A = acc[r.curso] || (acc[r.curso] = { criados:0, ganhos:0, perdidos:0, fat:0, rq:0 });
    A.criados += r.criados; A.ganhos += r.ganhos; A.perdidos += r.perdidos; A.fat += r.faturamento; A.rq += r.rq;
  });
  const linhas = Object.entries(acc).map(([curso, a]) => ({
    curso, ...a,
    win: (a.ganhos + a.perdidos) ? a.ganhos/(a.ganhos+a.perdidos)*100 : 0,
    ticket: a.ganhos ? a.fat/a.ganhos : 0,
    convRq: a.rq ? a.ganhos/a.rq*100 : 0,
  })).filter(c => c.ganhos > 0 || c.criados > 0).sort((a,b) => b.fat - a.fat);

  document.getElementById('cCursoPerf').innerHTML = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Curso</th><th class="num">Criados</th><th class="num">RQ</th><th class="num">Vendas</th><th class="num">Win rate</th><th class="num">Conv. RQ→V</th><th class="num">Ticket</th><th class="num">Faturamento</th></tr></thead>
      <tbody>
        ${linhas.length ? linhas.map((c,i) => `
          <tr class="${i<3?'top3':''}">
            <td class="pos">${i+1}</td><td class="nome">${escC(c.curso)}</td>
            <td class="num">${cN(c.criados)}</td><td class="num">${cN(c.rq)}</td>
            <td class="num"><b>${cN(c.ganhos)}</b></td>
            <td class="num">${pillC(c.win, 25, 15)}</td>
            <td class="num">${pillC(c.convRq, 40, 20)}</td>
            <td class="num">${cR$(c.ticket)}</td><td class="num">${cR$(c.fat)}</td>
          </tr>`).join('') : '<tr><td colspan="9" style="text-align:center;padding:18px;color:var(--text-muted)">Sem dados.</td></tr>'}
      </tbody>
    </table>`;
}

// ---------- Eficiência · SDRs (aproveitamento das reuniões, não só volume) ----------
function renderEfSdr() {
  const linhas = (CS.data.sdrs || []).map(s => {
    const a = somaSdr(s.mensal);
    return { nome:s.nome, is_bot:s.is_bot, sem:s.sem_sdr, reuT:a.reunioes_total, reuOk:a.reunioes_ok, ns:a.no_show,
      aprov: a.aproveitamento, nsRate: a.no_show_rate };
  }).filter(s => s.reuT >= 5)  // volume mínimo de reuniões p/ a taxa fazer sentido
    .sort((a,b) => b.aprov - a.aprov);
  const tag = (s) => s.is_bot ? '<span class="sdr-tag bot">automação</span>' : (s.sem ? '<span class="sdr-tag sem">sem SDR</span>' : '');
  document.getElementById('cEfSdr').innerHTML = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>SDR</th><th class="num">Reuniões</th><th class="num">Quali OK</th><th class="num">Aproveitamento</th><th class="num">No-show %</th></tr></thead>
      <tbody>
        ${linhas.map((s,i) => `
          <tr class="${s.is_bot?'is-bot':''}">
            <td class="pos">${i+1}</td><td class="nome">${escC(s.nome)} ${tag(s)}</td>
            <td class="num">${cN(s.reuT)}</td><td class="num"><b>${cN(s.reuOk)}</b></td>
            <td class="num">${pillC(s.aprov, 80, 60)}</td>
            <td class="num">${pillC(s.nsRate, 15, 30, true)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------- Eficiência · Closers (conversão, não só volume) ----------
function renderEfCloser() {
  const linhas = (CS.data.closers || []).map(c => {
    const a = somaMeses(c.mensal);
    return { nome:c.nome, rq:a.reunioes_qualificadas, ganhos:a.ganhos, perdidos:a.perdidos, fat:a.faturamento,
      convRq: a.reunioes_qualificadas ? a.ganhos/a.reunioes_qualificadas*100 : 0,
      win: (a.ganhos+a.perdidos) ? a.ganhos/(a.ganhos+a.perdidos)*100 : 0,
      ticket: a.ganhos ? a.fat/a.ganhos : 0 };
  }).filter(c => c.rq >= 3)  // volume mínimo de RQ p/ conversão fazer sentido
    .sort((a,b) => b.convRq - a.convRq);
  document.getElementById('cEfCloser').innerHTML = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Closer</th><th class="num">RQ</th><th class="num">Vendas</th><th class="num">Conv. RQ→Venda</th><th class="num">Win rate</th><th class="num">Ticket</th></tr></thead>
      <tbody>
        ${linhas.map((c,i) => `
          <tr class="${i<3?'top3':''}">
            <td class="pos">${i+1}</td><td class="nome">${escC(c.nome)}</td>
            <td class="num">${cN(c.rq)}</td><td class="num"><b>${cN(c.ganhos)}</b></td>
            <td class="num">${pillC(c.convRq, 40, 20)}</td>
            <td class="num">${pillC(c.win, 25, 15)}</td>
            <td class="num">${cR$(c.ticket)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------- Análise de Perdas (Pareto dos motivos) ----------
let cPerdasChart = null;
function renderPerdas() {
  const acc = {};
  (CS.data.motivos_perda_mensal || []).filter(r => cTupleAtivo(r.ano, r.mes))
    .forEach(r => { acc[r.motivo] = (acc[r.motivo] || 0) + r.qtd; });
  let arr = Object.entries(acc).map(([motivo, qtd]) => ({ motivo, qtd })).sort((a, b) => b.qtd - a.qtd);
  const total = arr.reduce((s, x) => s + x.qtd, 0);
  const hint = document.getElementById('cPerdasHint');
  const box = document.getElementById('cPerdasBox');

  if (!total) {
    if (cPerdasChart) { cPerdasChart.destroy(); cPerdasChart = null; }
    hint.textContent = 'Sem perdas no recorte';
    box.style.height = '120px';
    box.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted)">Sem perdas para esse período.</div>';
    return;
  }
  if (!document.getElementById('cPerdasChart')) box.innerHTML = '<canvas id="cPerdasChart"></canvas>';

  const TOPN = 12;
  const top = arr.slice(0, TOPN);
  const resto = arr.slice(TOPN).reduce((s, x) => s + x.qtd, 0);
  if (resto > 0) top.push({ motivo: 'Outros', qtd: resto });
  const top3 = arr.slice(0, 3).reduce((s, x) => s + x.qtd, 0);
  hint.textContent = `${cN(total)} perdas · top 3 motivos = ${cPct(top3 / total * 100)}`;

  box.style.height = Math.max(300, top.length * 34 + 70) + 'px';
  const ctx = document.getElementById('cPerdasChart').getContext('2d');
  if (cPerdasChart) cPerdasChart.destroy();
  const txt = cssVarC('--text-muted'), grid = cssVarC('--chart-grid');

  const labelPlugin = {
    id: 'perdasLabels',
    afterDatasetsDraw(ch) {
      const c = ch.ctx; c.save();
      c.font = '700 12px "JetBrains Mono", monospace'; c.textBaseline = 'middle';
      ch.getDatasetMeta(0).data.forEach((bar, i) => {
        const q = top[i].qtd, p = (q / total * 100).toFixed(1).replace('.', ',');
        c.fillStyle = txt; c.textAlign = 'left';
        c.fillText(`${cN(q)} · ${p}%`, bar.x + 8, bar.y);
      });
      c.restore();
    },
  };
  cPerdasChart = new Chart(ctx, {
    type: 'bar',
    plugins: [labelPlugin],
    data: {
      labels: top.map(t => t.motivo),
      datasets: [{ data: top.map(t => t.qtd), backgroundColor: top.map(t => t.motivo === 'Outros' ? '#9ca3af' : '#ef4444'), borderRadius: 4, barPercentage: 0.82 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 70 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `  ${cN(c.parsed.x)} perdas · ${(c.parsed.x/total*100).toFixed(1)}%` } },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { family:'JetBrains Mono, monospace', size:11 } } },
        y: { grid: { display: false }, ticks: { color: cssVarC('--text'), font: { family:'JetBrains Mono, monospace', size:12, weight:600 } } },
      },
    },
  });
}

// Renderiza só a aba ativa (SDR ou Closer). Charts precisam do container visível.
function renderAtiva() {
  if (CS.aba === 'sdr') {
    renderKpisSdr(); renderFunilSdr(); renderSerieSdr();
    renderSdrsC(); renderReunDia(); renderEfSdr();
  } else {
    renderKpisCloser(); renderFunilCloser(); renderSerieCloser();
    renderClosersC(); renderVendaDia(); renderCloserCursoC(); renderCursoPerf(); renderEfCloser();
  }
}
// Alias mantido (todos os handlers de filtro chamam renderAllC)
function renderAllC() { renderAtiva(); }

function setupTabsC() {
  document.querySelectorAll('.tabs-funnel .tab-funnel[data-aba]').forEach(b => {
    b.classList.toggle('active', b.dataset.aba === CS.aba);
    b.onclick = () => {
      if (CS.aba === b.dataset.aba) return;
      CS.aba = b.dataset.aba;
      CS.closerSel = null;  // cross-filter de closer não faz sentido entre abas
      document.querySelectorAll('.tabs-funnel .tab-funnel').forEach(x => x.classList.toggle('active', x.dataset.aba === CS.aba));
      document.getElementById('paneSdr').classList.toggle('hidden', CS.aba !== 'sdr');
      document.getElementById('paneCloser').classList.toggle('hidden', CS.aba !== 'closer');
      renderBannerC();
      renderAtiva();
    };
  });
  document.getElementById('paneSdr').classList.toggle('hidden', CS.aba !== 'sdr');
  document.getElementById('paneCloser').classList.toggle('hidden', CS.aba !== 'closer');
}

// ---------- Filtros (padrão MKT: Ano + Mês/Dia multi + presets + range) ----------
function clearPresetsC() { document.querySelectorAll('.filter-bar .preset').forEach(b => b.classList.remove('active')); }

function setupFiltrosC() {
  const anos = (CS.data.filtros_disponiveis && CS.data.filtros_disponiveis.anos) || [];
  const selA = document.getElementById('cAno');
  selA.innerHTML = '<option value="all">Todos os anos</option>' + anos.map(a => `<option value="${a}">${a}</option>`).join('');
  selA.value = CS.filtro.ano;
  selA.onchange = () => { CS.filtro.ano = selA.value; clearPresetsC(); renderAllC(); };

  // Mês multi
  MS_C.mes = createMultiSelectC({
    mount: document.getElementById('cMesWrap'), label: 'Mês', placeholder: 'Todos',
    options: CMES.map((n,i) => ({ value: String(i+1), text: n })),
    onChange: (arr) => { CS.filtro.mes = arr.length ? arr : 'all'; clearPresetsC(); renderAllC(); },
  });
  // Dia multi
  MS_C.dia = createMultiSelectC({
    mount: document.getElementById('cDiaWrap'), label: 'Dia', placeholder: 'Todos',
    options: Array.from({length:31}, (_,i) => ({ value: String(i+1), text: String(i+1) })),
    onChange: (arr) => { CS.filtro.dia = arr.length ? arr : 'all'; clearPresetsC(); renderAllC(); },
  });

  // Presets
  document.querySelectorAll('.filter-bar .preset[data-preset]').forEach(b => {
    b.onclick = () => {
      const p = b.dataset.preset; clearPresetsC(); b.classList.add('active');
      const ref = CS.data.meta && CS.data.meta.data_referencia ? new Date(CS.data.meta.data_referencia + 'T00:00:00') : new Date();
      if (p === 'all') CS.filtro = { ano:'all', mes:'all', dia:'all', range:null };
      else if (p === 'ytd') CS.filtro = { ano:String(ref.getFullYear()), mes:'all', dia:'all', range:null };
      else if (p === 'month') CS.filtro = { ano:String(ref.getFullYear()), mes:[String(ref.getMonth()+1)], dia:'all', range:null };
      else if (p === 'today') CS.filtro = { ano:String(ref.getFullYear()), mes:[String(ref.getMonth()+1)], dia:[String(ref.getDate())], range:null };
      selA.value = CS.filtro.ano;
      MS_C.mes.setValores(cMesesSel() || []); MS_C.dia.setValores(cDiasSel() || []);
      const bp = document.getElementById('cBtnPers'); if (bp){ bp.classList.remove('has-range'); bp.textContent='Personalizado'; }
      renderAllC();
    };
  });

  // Range personalizado
  const btnPers = document.getElementById('cBtnPers'), rangePanel = document.getElementById('cRangePanel');
  if (btnPers && rangePanel) {
    const fb = document.querySelector('.filter-bar');
    const rDe = document.getElementById('cRangeDe'), rAte = document.getElementById('cRangeAte');
    const ref = CS.data.meta && CS.data.meta.data_referencia ? new Date(CS.data.meta.data_referencia+'T00:00:00') : new Date();
    const ini = new Date(ref); ini.setDate(ini.getDate()-30);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!rDe.value) rDe.value = iso(ini); if (!rAte.value) rAte.value = iso(ref);
    rangePanel.hidden = true;
    const abrir = () => { rangePanel.hidden=false; fb && fb.classList.add('range-open'); };
    const fechar = () => { rangePanel.hidden=true; fb && fb.classList.remove('range-open'); };
    btnPers.onclick = (e) => { e.stopPropagation();
      document.querySelectorAll('.ms-dropdown.open').forEach(d => { d.querySelector('.ms-panel').hidden=true; d.classList.remove('open'); });
      rangePanel.hidden ? abrir() : fechar(); };
    document.addEventListener('click', (e) => { if (!rangePanel.hidden && !btnPers.contains(e.target) && !rangePanel.contains(e.target)) fechar(); });
    document.getElementById('cRangeApply').onclick = () => {
      const de = rDe.value, ate = rAte.value; if (!de||!ate) return; if (de>ate){ alert('Data inicial deve ser <= final.'); return; }
      CS.filtro = { ano:'all', mes:'all', dia:'all', range:{ de, ate, deNum:cDataParaNum(de), ateNum:cDataParaNum(ate) } };
      selA.value='all'; MS_C.mes.setValores([]); MS_C.dia.setValores([]); clearPresetsC();
      btnPers.classList.add('has-range'); btnPers.textContent = `Range: ${de.split('-').reverse().join('/')} → ${ate.split('-').reverse().join('/')}`;
      fechar(); renderAllC();
    };
    document.getElementById('cRangeClear').onclick = () => { CS.filtro.range=null; btnPers.classList.remove('has-range'); btnPers.textContent='Personalizado'; fechar(); renderAllC(); };
  }

  // Limpar tudo
  document.getElementById('cClear').onclick = () => {
    CS.filtro = { ano:'all', mes:'all', dia:'all', range:null }; CS.closerSel = null;
    selA.value='all'; MS_C.mes.setValores([]); MS_C.dia.setValores([]);
    if (btnPers){ btnPers.classList.remove('has-range'); btnPers.textContent='Personalizado'; if(rangePanel) rangePanel.hidden=true; }
    document.querySelector('.filter-bar') && document.querySelector('.filter-bar').classList.remove('range-open');
    clearPresetsC(); renderAllC(); renderBannerC();
  };

  // Seletores das seções diárias / curso
  const distintos = (arr, campo) => Array.from(new Set((arr||[]).map(x => x[campo]))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const optTodos = (lista, label) => `<option value="todos">${label}</option>` + lista.map(v => `<option value="${escC(v)}">${escC(v)}</option>`).join('');

  const selSdr = document.getElementById('cSelSdr');
  selSdr.innerHTML = optTodos(distintos(CS.data.sdr_reunioes_diario, 'sdr'), 'Todos os SDRs');
  selSdr.onchange = () => { CS.selSdr = selSdr.value; renderReunDia(); };

  const selCloser = document.getElementById('cSelCloser');
  selCloser.innerHTML = optTodos(distintos(CS.data.closer_vendas_diario, 'closer'), 'Todos os closers');
  selCloser.onchange = () => { CS.selCloser = selCloser.value; renderVendaDia(); };

  const selCursoV = document.getElementById('cSelCursoVenda');
  if (selCursoV) {
    const cursosV = (CS.data.filtros_disponiveis && CS.data.filtros_disponiveis.produtos) || distintos(CS.data.venda_closer_curso_diario, 'curso');
    selCursoV.innerHTML = optTodos(cursosV, 'Todos os cursos');
    selCursoV.onchange = () => { CS.selCursoVenda = selCursoV.value; renderVendaDia(); };
  }

  const selCurso = document.getElementById('cSelCurso');
  const cursos = (CS.data.filtros_disponiveis && CS.data.filtros_disponiveis.produtos) || distintos(CS.data.closer_curso_mensal, 'curso');
  selCurso.innerHTML = optTodos(cursos, 'Todos os cursos');
  selCurso.onchange = () => { CS.selCurso = selCurso.value; renderCloserCursoC(); };
}

// ---------- Init ----------
(async function initC() {
  document.documentElement.dataset.theme = localStorage.getItem('hub-theme') || 'light';
  if (!window.PAINEL_ENC_COMERCIAL || !window.HubAuth) {
    document.body.innerHTML = '<div style="font-family:sans-serif;padding:40px;text-align:center">Dados da área comercial não encontrados. Rode <b>Atualizar HUB MKT.bat</b>.</div>';
    return;
  }
  try { CS.data = await HubAuth.unlock({ key:'comercial', varName:'PAINEL_ENC_COMERCIAL', nome:'Comercial' }); }
  catch (e) { console.error(e); return; }
  document.getElementById('cHint').textContent = CS.data.meta && CS.data.meta.data_referencia ? ('Dados até ' + CS.data.meta.data_referencia) : '';
  setupFiltrosC();
  setupTabsC();

  // Abre já filtrado no MÊS ATUAL (mês do dado mais recente) — só na abertura
  (function abrirNoMesAtual() {
    try {
      const ref = CS.data.meta && CS.data.meta.data_referencia ? new Date(CS.data.meta.data_referencia + 'T00:00:00') : new Date();
      CS.filtro = { ano: String(ref.getFullYear()), mes: [String(ref.getMonth() + 1)], dia: 'all', range: null };
      const selA = document.getElementById('cAno'); if (selA) selA.value = CS.filtro.ano;
      MS_C.mes && MS_C.mes.setValores(cMesesSel() || []);
      MS_C.dia && MS_C.dia.setValores([]);
      clearPresetsC();
      const mb = document.querySelector('.filter-bar .preset[data-preset="month"]'); if (mb) mb.classList.add('active');
    } catch (e) { /* fallback: mantém 'Tudo' */ }
  })();

  renderAtiva();
})();
