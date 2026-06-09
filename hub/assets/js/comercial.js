/* ============================================================
   HUB AGROADVANCE — Painel COMERCIAL (v1.5)
   Funil real: MQLs → Reuniões Qualificadas (no-show) → Vendas → Faturamento
   Dados cifrados (área "comercial") via HubAuth. Estilo do painel MKT.
   ============================================================ */
const CMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const cN   = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const cR$  = (n) => (n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', {maximumFractionDigits:0}));
const cPct = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + '%');
const cNr  = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('pt-BR'));  // contagem inteira (p/ deltas proporcionais)

// ---------- Sparkline (mini-tendência inline SVG) ----------
// Mês corrente AINDA incompleto (data_referencia antes do fim do mês) — excluído do sparkline
// pra não cair artificialmente no começo do mês.
function mesCorrenteParcial() {
  const ref = (CS.data.meta && CS.data.meta.data_referencia) ? new Date(CS.data.meta.data_referencia + 'T00:00:00') : null;
  if (!ref) return null;
  const ultimoDia = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  if (ref.getDate() >= ultimoDia) return null;   // mês já completo
  return { ano: ref.getFullYear(), mes: ref.getMonth() + 1 };
}
// janela contínua dos últimos n meses FECHADOS (termina no último mês fechado; mês corrente parcial fora)
function janelaMeses(n) {
  const ref = (CS.data.meta && CS.data.meta.data_referencia) ? new Date(CS.data.meta.data_referencia + 'T00:00:00') : new Date();
  let y = ref.getFullYear(), m = ref.getMonth() + 1;
  if (mesCorrenteParcial()) { m -= 1; if (m < 1) { m = 12; y -= 1; } }   // mês corrente incompleto → começa no anterior
  const out = [];
  for (let i = n - 1; i >= 0; i--) { let yy = y, mm = m - i; while (mm < 1) { mm += 12; yy -= 1; } out.push(yy + '-' + mm); }
  return out;
}
function ultimosMeses(mensal, field, n) {
  n = n || 12;
  const idx = {};
  (mensal || []).forEach(r => { const k = r.ano + '-' + r.mes; idx[k] = (idx[k] || 0) + (Number(r[field]) || 0); });
  return janelaMeses(n).map(k => idx[k] || 0);   // preenche meses ausentes com 0 (trajetória contínua)
}
function sparkline(vals) {
  const data = (vals || []).filter(v => v != null);
  if (data.length < 2 || Math.max(...data) === 0) return '<span class="spark spark-na">—</span>';
  const w = 72, h = 20, pad = 2.5;
  const max = Math.max(...data), min = Math.min(...data), range = (max - min) || 1, n = data.length;
  const X = i => pad + (i / (n - 1)) * (w - 2 * pad);
  const Y = v => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const pts = data.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const up = data[n - 1] >= data[0];
  const cor = up ? '#1fb541' : '#d99a2b';                  // verde subindo · âmbar caindo (no período)
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(n - 1).toFixed(1)}" cy="${Y(data[n - 1]).toFixed(1)}" r="2.1" fill="${cor}"/></svg>`;
}
const cssVarC = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const escC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// filtro.mes/dia: 'all' OU Array<string>. filtro.range: {de,ate,deNum,ateNum} ou null
const CS = { data: null, filtro: { ano: 'all', mes: 'all', dia: 'all', range: null }, closerSel: null,
             selSdr: 'todos', selCloser: 'todos', selCurso: 'todos', selCursoVenda: 'todos',
             tipoCurso: 'all',   // all | mba | pos | imersoes (filtro de tipo de produto)
             cursoSel: null,     // recorte por 1 produto (aba Closer) — exclui closerSel
             sdrSel: null,       // recorte por 1 SDR (aba SDR)
             aba: 'sdr' };
// Classificação de produto por tipo (mesma regra do painel MKT)
function getCursoTipoC(curso) {
  const c = String(curso == null ? '' : curso).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (c.startsWith('mba')) return 'mba';
  if (c.includes('imersao')) return 'imersoes';
  if (c.startsWith('pos')) return 'pos';
  return 'outros';
}
function cursoMatchTipoC(curso, tipo) { return (!tipo || tipo === 'all') ? true : getCursoTipoC(curso) === tipo; }
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

// Série mensal (estilo CS.data.mensal) do tipo de curso atual, opcionalmente de 1 closer
function serieCloserTipo(closerNome) {
  const tp = CS.tipoCurso, acc = {};
  (CS.data.closer_tipo_mensal || []).forEach(r => {
    if (r.tipo !== tp) return;
    if (closerNome && r.closer !== closerNome) return;
    const k = r.ano + '-' + r.mes;
    const A = acc[k] || (acc[k] = { ano:r.ano, mes:r.mes, mqls:0, criados:0, ganhos:0, perdidos:0, faturamento:0, qualificados:0, com_reuniao:0, reunioes_qualificadas:0, com_proposta:0, no_show:0, abertos:0 });
    A.criados+=r.criados; A.ganhos+=r.ganhos; A.perdidos+=r.perdidos; A.faturamento+=r.faturamento;
    A.qualificados+=r.qualificados; A.com_reuniao+=r.com_reuniao; A.reunioes_qualificadas+=r.rq; A.no_show+=r.no_show;
  });
  return Object.values(acc);
}
// Série mensal (estilo CS.data.mensal) de UM curso — métricas de negócio do curso_mensal
function serieCursoMensal(curso) {
  const acc = {};
  (CS.data.curso_mensal || []).forEach(r => {
    if (r.curso !== curso) return;
    const k = r.ano + '-' + r.mes;
    const A = acc[k] || (acc[k] = { ano:r.ano, mes:r.mes, mqls:0, criados:0, ganhos:0, perdidos:0, faturamento:0, qualificados:0, com_reuniao:0, reunioes_qualificadas:0, com_proposta:0, no_show:0, abertos:0 });
    A.criados+=r.criados; A.ganhos+=r.ganhos; A.perdidos+=r.perdidos; A.faturamento+=r.faturamento;
    A.qualificados+=r.qualificados; A.com_reuniao+=r.com_reuniao; A.reunioes_qualificadas+=r.rq;
  });
  return Object.values(acc);
}
// Fonte de dados: recorte por CURSO (precedência) > TIPO > cross-filter de closer
function serieAtiva() {
  if (CS.cursoSel) return serieCursoMensal(CS.cursoSel);
  if (CS.tipoCurso !== 'all') return serieCloserTipo(CS.closerSel || null);
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
  if (CS.tipoCurso !== 'all') {
    (CS.data.sdr_tipo_mensal || []).forEach(r => { if (r.tipo !== CS.tipoCurso) return; if (CS.sdrSel && r.sdr !== CS.sdrSel) return;
      const A = get(r.ano, r.mes); A.propostas+=r.propostas; A.reunioes_total+=r.reunioes_total; A.reunioes_ok+=r.reunioes_ok; A.no_show+=r.no_show; });
  } else {
    (CS.data.sdrs || []).forEach(s => { if (CS.sdrSel && s.nome !== CS.sdrSel) return; (s.mensal || []).forEach(m => {
      const A = get(m.ano, m.mes);
      A.propostas += m.propostas||0; A.reunioes_total += m.reunioes_total||0; A.reunioes_ok += m.reunioes_ok||0; A.no_show += m.no_show||0;
    }); });
  }
  // MQLs SEMPRE totais — o RD Station não separa por produto/tipo
  (CS.data.mensal || []).forEach(m => { get(m.ano, m.mes).mqls += m.mqls||0; });
  return Object.values(acc).sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
}
// SDRs como entidades {nome,is_bot,sem,mensal} respeitando o tipo (p/ ranking e eficiência)
function sdrEntidades() {
  const soUm = (arr) => CS.sdrSel ? arr.filter(s => s.nome === CS.sdrSel) : arr;
  if (CS.tipoCurso === 'all') return soUm((CS.data.sdrs || []).map(s => ({ nome:s.nome, is_bot:s.is_bot, sem:s.sem_sdr, mensal:s.mensal })));
  const meta = {}; (CS.data.sdrs || []).forEach(s => meta[s.nome] = s);
  const byS = {};
  (CS.data.sdr_tipo_mensal || []).forEach(r => { if (r.tipo !== CS.tipoCurso) return; (byS[r.sdr] = byS[r.sdr] || []).push(r); });
  return soUm(Object.entries(byS).map(([nome, rows]) => ({
    nome, is_bot: meta[nome] ? meta[nome].is_bot : /bot/i.test(nome), sem: meta[nome] ? meta[nome].sem_sdr : (nome === '(sem SDR)'),
    mensal: rows.map(r => ({ ano:r.ano, mes:r.mes, propostas:r.propostas, reunioes_total:r.reunioes_total, reunioes_ok:r.reunioes_ok, no_show:r.no_show })),
  })));
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
  if (CS.tipoCurso !== 'all') base = `${({ mba:'MBA', pos:'Pós', imersoes:'Imersões' })[CS.tipoCurso] || CS.tipoCurso} · ${base}`;
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
// Card uniforme da linha única de KPIs (taxa no subtítulo; MoM fixo no rodapé)
function kUno(label, val, sub, momHtml) {
  return `<div class="kpi-cell uno"><span class="kpi-label">${label}</span><span class="kpi-value">${val}</span><span class="kpi-sub">${sub}</span>${momHtml ? `<span class="kpi-mom-wrap">${momHtml}</span>` : ''}</div>`;
}

// ---------- MoM (mês vs mês anterior) com proporcionalidade de dias ----------
// Detecta se o filtro é exatamente 1 mês de 1 ano (sem dia/range) e calcula o fator
// de proporção quando o mês selecionado é o ATUAL (parcial): compara só os dias decorridos.
function momInfo() {
  const f = CS.filtro;
  if (f.range) return { ok: false };
  const mSel = cMesesSel(), dSel = cDiasSel();
  if (f.ano === 'all' || !mSel || mSel.length !== 1 || (dSel && dSel.length)) return { ok: false };
  const ano = parseInt(f.ano, 10), mes = parseInt(mSel[0], 10);
  let pAno = ano, pMes = mes - 1;
  if (pMes < 1) { pMes = 12; pAno -= 1; }
  const ref = (CS.data.meta && CS.data.meta.data_referencia) ? new Date(CS.data.meta.data_referencia + 'T00:00:00') : null;
  let fator = 1, partial = false, dCur = null;
  if (ref && ref.getFullYear() === ano && (ref.getMonth() + 1) === mes) {
    dCur = ref.getDate();
    const ultimoDiaMes = new Date(ano, mes, 0).getDate();
    if (dCur < ultimoDiaMes) {                          // mês corrente ainda incompleto
      partial = true;
      const dPrev = new Date(pAno, pMes, 0).getDate();  // dias do mês anterior
      fator = dCur / dPrev;                             // proporcional aos dias decorridos
    }
  }
  return { ok: true, ano, mes, pAno, pMes, fator, partial, dCur };
}
function _prevAcc(serie, info, chaves) {
  const acc = {}; chaves.forEach(k => acc[k] = 0);
  (serie || []).forEach(m => { if (m.ano === info.pAno && m.mes === info.pMes) chaves.forEach(k => acc[k] += (m[k] || 0)); });
  return acc;
}
function sdrPrevAcc(info)    { return _prevAcc(getSdrMensal(), info, ['mqls','propostas','reunioes_total','reunioes_ok','no_show']); }
function closerPrevAcc(info) { return _prevAcc(serieAtiva(),  info, ['criados','ganhos','perdidos','faturamento','reunioes_qualificadas','qualificados']); }

// Renderiza a pílula de MoM. inverter=true p/ métricas onde subir é RUIM (no-show).
function momBadge(cur, prev, opts) {
  opts = opts || {};
  if (prev == null) return '';
  const base = prev * (opts.fator || 1);
  if (!base) return '';
  const diff = (cur - base) / base * 100;
  const flat = Math.abs(diff) < 0.05;
  const subiu = diff > 0;
  const bom = opts.inverter ? !subiu : subiu;
  const cls = flat ? 'flat' : (bom ? 'pos' : 'neg');
  const seta = flat ? '→' : (subiu ? '↑' : '↓');
  const pct = Math.abs(diff).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const tag = opts.tag || 'MoM';
  const titulo = opts.partial
    ? `${tag !== 'MoM' ? tag + ' · ' : ''}Comparado proporcionalmente a ${opts.dCur} dia(s) do mês anterior (mês corrente ainda em curso)`
    : `${tag !== 'MoM' ? tag + ' · ' : ''}Comparado ao mês anterior`;
  // Volume que a % representa: o valor do mês anterior (base, proporcional se mês corrente). Ao lado da %.
  const fmt = opts.fmt || cNr;
  const volHtml = `<span class="km-vol">de ${fmt(base)}</span>`;
  return `<span class="kpi-mom ${cls}" title="${titulo}"><span class="km-pct">${seta} ${pct}% <small>${tag}</small></span>${volHtml}</span>`;
}

function renderKpisSdr() {
  const k = somaSdr(getSdrMensal());   // SDR = atividades (propostas, reuniões, no-show)
  const hint = document.getElementById('cKpiSdrHint'); if (hint) hint.textContent = labelPeriodoC();
  const info = momInfo();
  const prev = info.ok ? sdrPrevAcc(info) : null;
  const M = (key, inverter) => prev ? momBadge(k[key], prev[key], { fator: info.fator, partial: info.partial, dCur: info.dCur, inverter, fmt: cNr }) : '';
  // Linha única, ordem de funil: topo → reuniões → qualificadas → perdas → caminho alternativo
  const mqlSub = CS.tipoCurso === 'all' ? 'leads de topo · RD' : 'todos os produtos · RD não separa';
  // Vendas = resultado do time (negócios ganhos); respeita o tipo. MoM de vendas E de faturamento.
  const vSerie = (CS.tipoCurso !== 'all') ? serieCloserTipo(null) : CS.data.mensal;
  const vk = somaMeses(vSerie);
  const vprev = info.ok ? _prevAcc(vSerie, info, ['ganhos', 'faturamento']) : null;
  const Mv = (key, tag, fmt) => vprev ? momBadge(vk[key], vprev[key], { fator: info.fator, partial: info.partial, dCur: info.dCur, tag, fmt: fmt || cNr }) : '';
  document.getElementById('cKpiSdr').innerHTML = `<div class="kpi-row">
    ${kUno('MQLs', cN(k.mqls), mqlSub, M('mqls'))}
    ${kUno('Reuniões realizadas', cN(k.reunioes_total), 'total no período', M('reunioes_total'))}
    ${kUno('Reuniões Qualif.', cN(k.reunioes_ok), `aproveitamento ${cPct(k.aproveitamento)}`, M('reunioes_ok'))}
    ${kUno('No-show', cN(k.no_show), `${cPct(k.no_show_rate)} das agendadas`, M('no_show', true))}
    ${kUno('Vendas', cN(vk.ganhos), `${cR$(vk.faturamento)} em faturamento`, Mv('ganhos', 'vendas', cNr) + Mv('faturamento', 'R$', cR$))}
  </div>`;
}

function renderKpisCloser() {
  const k = derivar(somaMeses(serieAtiva()));
  const info = momInfo();
  const prev = info.ok ? closerPrevAcc(info) : null;
  const M = (key, inverter, fmt) => prev ? momBadge(k[key], prev[key], { fator: info.fator, partial: info.partial, dCur: info.dCur, inverter, fmt: fmt || cNr }) : '';
  const hint = document.getElementById('cKpiCloserHint'); if (hint) hint.textContent = labelPeriodoC();
  // Linha única, ordem de funil: pipeline → reuniões qualif. → vendas → faturamento (taxa de cada etapa no subtítulo)
  document.getElementById('cKpiCloser').innerHTML = `<div class="kpi-row">
    ${kUno('Negócios criados', cN(k.criados), 'leads no pipeline', M('criados'))}
    ${kUno('Reuniões Qualif.', cN(k.reunioes_qualificadas), `${cPct(k.conv_rq_venda)} viraram venda`, M('reunioes_qualificadas'))}
    ${kUno('Vendas', cN(k.ganhos), `win rate ${cPct(k.win_rate)}`, M('ganhos'))}
    ${kUno('Faturamento', cR$(k.faturamento), `ticket ${cR$(k.ticket)}`, M('faturamento', false, cR$))}
  </div>`;
}

// ---------- Ticker de destaques (superlativos do período filtrado) ----------
// Sem pessoas: produto mais/menos vendido, maior faturamento, melhor dia, pico de vendas.
// Clicar congela e abre painel estático; clicar de novo volta a rolar.
function tkItemHtml(f) {
  return `<span class="tk-item ${f.cls || ''}"><span class="tk-lab">${f.icon} ${f.label}</span> <b>${escC(f.name)}</b> <span class="tk-val">${f.value}</span></span>`;
}
function tkRowHtml(f) {
  return `<div class="tk-prow ${f.cls || ''}"><span class="tk-lab">${f.icon} ${f.label}</span><b class="tk-prow-nome">${escC(f.name)}</b><span class="tk-val">${f.value}</span></div>`;
}
function calcTickerFacts() {
  const cAcc = {};
  (CS.data.curso_mensal || []).forEach(r => {
    if (r.curso === '(sem produto)') return;
    if (!cTupleAtivo(r.ano, r.mes) || !cursoMatchTipoC(r.curso, CS.tipoCurso)) return;
    const A = cAcc[r.curso] || (cAcc[r.curso] = { vendas: 0, fat: 0 });
    A.vendas += r.ganhos; A.fat += r.faturamento;
  });
  const cursos = Object.entries(cAcc).map(([curso, a]) => ({ curso, ...a })).filter(c => c.vendas > 0);
  const dAcc = {};
  (CS.data.venda_closer_curso_diario || []).forEach(r => {
    if (!cDataIsoAtiva(r.data) || !cursoMatchTipoC(r.curso, CS.tipoCurso)) return;
    const A = dAcc[r.data] || (dAcc[r.data] = { qtd: 0, fat: 0 });
    A.qtd += r.qtd; A.fat += r.faturamento;
  });
  const dias = Object.entries(dAcc).map(([data, a]) => ({ data, ...a }));

  const facts = [];
  if (cursos.length) {
    const maisV  = cursos.slice().sort((a, b) => b.vendas - a.vendas || b.fat - a.fat)[0];
    const menosV = cursos.slice().sort((a, b) => a.vendas - b.vendas || a.fat - b.fat)[0];
    const maiorF = cursos.slice().sort((a, b) => b.fat - a.fat)[0];
    facts.push({ icon: '🏆', label: 'Produto mais vendido', name: maisV.curso, value: `${cN(maisV.vendas)} vendas · ${cR$(maisV.fat)}`, cls: 'pos' });
    if (maiorF.curso !== maisV.curso) facts.push({ icon: '💰', label: 'Maior faturamento', name: maiorF.curso, value: cR$(maiorF.fat), cls: 'pos' });
    if (menosV.curso !== maisV.curso) facts.push({ icon: '🔻', label: 'Produto menos vendido', name: menosV.curso, value: `${cN(menosV.vendas)} venda(s) · ${cR$(menosV.fat)}`, cls: 'muted' });
  }
  if (dias.length) {
    const melhorF = dias.slice().sort((a, b) => b.fat - a.fat)[0];
    const picoV   = dias.slice().sort((a, b) => b.qtd - a.qtd)[0];
    facts.push({ icon: '📅', label: 'Melhor dia (faturamento)', name: cDataBR(melhorF.data), value: cR$(melhorF.fat), cls: 'pos' });
    if (picoV.data !== melhorF.data) facts.push({ icon: '🔝', label: 'Pico de vendas', name: cDataBR(picoV.data), value: `${cN(picoV.qtd)} vendas`, cls: 'pos' });
  }
  return facts;
}
function renderTicker() {
  const host = document.getElementById('cTicker'); if (!host) return;
  const facts = calcTickerFacts();
  if (!facts.length) { host.style.display = 'none'; host.innerHTML = ''; host.classList.remove('expanded'); return; }
  host.style.display = '';
  const seq = facts.map(tkItemHtml).join('<span class="tk-sep">•</span>');
  host.innerHTML =
    `<div class="tk-bar">
       <span class="tk-tag"><span class="tk-pulse"></span>Destaques
         <svg class="tk-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
       </span>
       <div class="tk-viewport"><div class="tk-track">${seq}<span class="tk-sep">•</span>${seq}</div></div>
       <span class="tk-toggle-hint">clique para fixar / voltar a rolar</span>
     </div>
     <div class="tk-panel">${facts.map(tkRowHtml).join('')}</div>`;
}

// ---------- Evolução mensal (genérica) ----------
function mesesParaSerie(serie) {
  let meses = (serie || []).slice();
  if (CS.filtro.ano !== 'all') meses = meses.filter(m => cAnoAtivo(m.ano));
  else meses = meses.slice(-14);
  return meses;
}
// índice do mês corrente PARCIAL (mês da data_referência ainda não fechado) na série, ou -1
function idxMesParcial(meses) {
  const ref = (CS.data.meta && CS.data.meta.data_referencia) ? new Date(CS.data.meta.data_referencia + 'T00:00:00') : null;
  if (!ref) return -1;
  const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  if (ref.getDate() >= ultimo) return -1;            // mês já completo
  return (meses || []).findIndex(m => m.ano === ref.getFullYear() && m.mes === (ref.getMonth() + 1));
}
function buildSerie(canvasId, prevChart, meses, datasets, comLinha, parcialIdx = -1) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (prevChart) prevChart.destroy();
  const txt = cssVarC('--text-muted'), grid = cssVarC('--chart-grid');
  const labelsCol = {
    id: 'labelsCol',
    afterDatasetsDraw(chart) {
      const c = chart.ctx; c.save();
      c.font = '700 11px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.lineJoin = 'round';
      const halo = cssVarC('--surface') || '#fff';
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type === 'line') return;
        chart.getDatasetMeta(di).data.forEach((bar, idx) => {
          const v = ds.data[idx]; if (!v) return;
          const yy = bar.y - 5, t = cN(v);
          // halo na cor do fundo → o número fica nítido mesmo onde a linha passa
          c.lineWidth = 3.5; c.strokeStyle = halo; c.strokeText(t, bar.x, yy);
          c.fillStyle = ds._lblColor || txt; c.fillText(t, bar.x, yy);
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
    data: { labels: meses.map((m,i) => `${CMES[m.mes-1]}/${String(m.ano).slice(-2)}` + (i===parcialIdx ? ' (parc.)' : '')), datasets },
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
  const p = idxMesParcial(meses);
  cChartSdr = buildSerie('cSerieSdr', cChartSdr, meses, [
    { label:'Reuniões total', data: meses.map(m => m.reunioes_total||0), backgroundColor: meses.map((_,i)=> i===p ? accent+'33' : accent+'aa'), borderRadius:4, yAxisID:'y', _lblColor: accent },
    { label:'Reuniões Quali OK', data: meses.map(m => m.reunioes_ok||0), backgroundColor: meses.map((_,i)=> i===p ? brand+'55' : brand), borderRadius:4, yAxisID:'y', _lblColor: brand },
  ], false, p);
}
function renderSerieCloser() {
  const brand = cssVarC('--chart-1')||'#1fb541', sand = cssVarC('--chart-3')||'#d99a2b';
  const meses = mesesParaSerie(serieAtiva());
  const p = idxMesParcial(meses);
  cChartCloser = buildSerie('cSerieCloser', cChartCloser, meses, [
    { label:'Vendas', data: meses.map(m => m.ganhos||0), backgroundColor: meses.map((_,i)=> i===p ? brand+'55' : brand), borderRadius:4, yAxisID:'y', _lblColor: brand },
    { label:'Faturamento', data: meses.map(m => m.faturamento||0), type:'line', borderColor: sand, borderWidth:2.5, tension:0.3, fill:false, yAxisID:'y1', pointRadius:2, order:-1 },
  ], true, p);
}

// ---------- Funil centralizado (genérico) ----------
// Pirâmide invertida. Barras proporcionais ao VALOR; o estágio MQL (topo:true) é
// tratado à parte (sempre a barra mais larga = boca do funil), pois é ordens de
// grandeza maior. As demais escalam proporcionalmente entre si (base = maior não-MQL).
function renderFunilGenerico(innerId, etapas) {
  const TOPO_W = 100, MAX_REST_W = 88, FLOOR_W = 34;
  const rest = etapas.filter(e => !e.topo && e.valor != null);
  const maxRest = Math.max(...rest.map(e => e.valor || 0), 1);
  let html = '';
  etapas.forEach((e, i) => {
    const isNull = e.valor == null;
    const larg = e.topo ? TOPO_W
               : isNull ? FLOOR_W
               : Math.max(FLOOR_W, (e.valor / maxRest) * MAX_REST_W);
    const valTxt = isNull ? '—' : cN(e.valor);
    html += `<div class="fv-stage${e.topo ? ' fv-topo' : ''}" style="width:${larg}%; background:linear-gradient(135deg, ${e.cor}, ${e.cor}cc)"><span class="fv-nome">${e.etapa}</span><span class="fv-val">${valTxt}</span></div>`;
    // Faturamento: minimalista ABAIXO da barra (fora dela), não numa barra própria
    if (e.faturamento != null) html += `<div class="fv-cap">${cR$(e.faturamento)} <span>em faturamento</span></div>`;
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
  const vk = somaMeses((CS.tipoCurso !== 'all') ? serieCloserTipo(null) : CS.data.mensal);   // vendas do time
  const etapas = [
    { etapa: 'Reuniões', valor: k.reunioes_total, cor: '#1fb541' },
    { etapa: 'Reuniões Quali OK', valor: k.reunioes_ok, cor: '#0f7c2e' },
    { etapa: 'Vendas', valor: vk.ganhos, faturamento: vk.faturamento, cor: '#0a5c22' },
  ];
  // MQLs (RD) não têm produto/tipo → só entram no funil quando NÃO há filtro de tipo
  if (CS.tipoCurso === 'all') etapas.unshift({ etapa: 'MQLs', valor: k.mqls, cor: '#3b82f6', topo: true });
  renderFunilGenerico('cFunilSdr', etapas);
}
function renderFunilCloser() {
  const k = derivar(somaMeses(serieAtiva()));
  renderFunilGenerico('cFunilCloser', [
    { etapa: 'Reuniões', valor: k.com_reuniao, cor: '#1fb541' },
    { etapa: 'Reuniões quali OK', valor: k.reunioes_qualificadas, cor: '#15933a' },
    { etapa: 'Vendas', valor: k.ganhos, faturamento: k.faturamento, cor: '#0f7c2e' },
  ]);
}

// ---------- Pódio + Ranking Closers ----------
// Entidades que NÃO são closers-pessoa (saem do pódio humano)
const CLOSER_AUTO = new Set(['SelfCheckout', 'Consulta Comercial', 'Closer Externo']);
function closersAgreg() {
  // Recorte por CURSO: ranking de closers naquele produto (closer_curso_mensal: vendas/fat/reuniões)
  if (CS.cursoSel) {
    const acc = {};
    (CS.data.closer_curso_mensal || []).forEach(r => {
      if (r.curso !== CS.cursoSel || !cTupleAtivo(r.ano, r.mes)) return;
      const A = acc[r.closer] || (acc[r.closer] = { nome: r.closer, auto: CLOSER_AUTO.has(r.closer), criados: null, ganhos: 0, win: null, fat: 0, ticket: 0, mensal: [] });
      A.ganhos += r.vendas; A.fat += r.faturamento;
      A.mensal.push({ ano: r.ano, mes: r.mes, faturamento: r.faturamento });
    });
    return Object.values(acc).map(c => ({ ...c, ticket: c.ganhos ? c.fat / c.ganhos : 0 }))
      .filter(c => c.ganhos > 0).sort((a, b) => b.fat - a.fat);
  }
  const fonte = (CS.tipoCurso !== 'all')
    ? [...new Set((CS.data.closer_tipo_mensal || []).filter(r => r.tipo === CS.tipoCurso).map(r => r.closer))].map(nome => ({ nome, mensal: serieCloserTipo(nome) }))
    : (CS.data.closers || []);
  return fonte.map(c => {
    const a = derivar(somaMeses(c.mensal));
    return { nome: c.nome, auto: CLOSER_AUTO.has(c.nome), criados: a.criados, ganhos: a.ganhos, win: a.win_rate, fat: a.faturamento, ticket: a.ticket, mensal: c.mensal };
  }).filter(c => c.criados > 0).sort((a,b) => b.fat - a.fat);
}
function iniciais(nome){ return nome.split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase(); }

function renderClosersC() {
  const linhas = closersAgreg();
  const humanos = linhas.filter(c => !c.auto);
  document.getElementById('cClosersHint').textContent = `${humanos.length} closers · ${CS.filtro.mes!=='all'&&!Array.isArray(CS.filtro.mes)?CMES[parseInt(CS.filtro.mes,10)-1]+' ':''}${CS.filtro.ano!=='all'?CS.filtro.ano:'2025-26'}`;

  const top3 = humanos.slice(0,3);
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
  const tagC = (c) => c.auto ? '<span class="sdr-tag bot">automático/externo</span>' : '';
  const tabela = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Closer</th><th class="spark-th">12m · fat.</th><th class="num">Negócios</th><th class="num">Vendas</th><th class="num">Win rate</th><th class="num">Faturamento</th><th class="num">Ticket</th></tr></thead>
      <tbody>
        ${linhas.map((c,i) => `
          <tr class="${c.auto?'is-bot':''} ${CS.closerSel===c.nome?'sel':''}" data-closer="${escC(c.nome)}">
            <td class="pos">${i+1}</td><td class="nome">${escC(c.nome)} ${tagC(c)}</td>
            <td class="spark-td">${sparkline(ultimosMeses(c.mensal,'faturamento',12))}</td>
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
      if (CS.closerSel) CS.cursoSel = null;
      renderAllC();
    });
  });
}

// ---------- Pódio + Ranking SDRs (por ATIVIDADE) ----------
function renderSdrsC() {
  const linhas = sdrEntidades().map(s => {
    const a = somaSdr(s.mensal);
    return { nome:s.nome, is_bot:s.is_bot, sem:s.sem, prop:a.propostas, reuT:a.reunioes_total, reuOk:a.reunioes_ok, ns:a.no_show, nsRate:a.no_show_rate, mensalSerie:s.mensal };
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
      <thead><tr><th>#</th><th>SDR</th><th class="spark-th">12m · reuniões OK</th><th class="num">Proposta wpp</th><th class="num">Reuniões</th><th class="num">Reuniões Quali OK</th><th class="num">No-show</th><th class="num">No-show %</th></tr></thead>
      <tbody>
        ${linhas.map((s,i) => `
          <tr class="${s.is_bot?'is-bot':''}">
            <td class="pos">${i+1}</td><td class="nome">${escC(s.nome)} ${tag(s)}</td>
            <td class="spark-td">${sparkline(ultimosMeses(s.mensalSerie,'reunioes_ok',12))}</td>
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
  const sdrEf = CS.sdrSel || (CS.selSdr !== 'todos' ? CS.selSdr : null);
  const rows = (CS.data.sdr_reunioes_diario || [])
    .filter(r => dataNoFiltro(r.data) && (!sdrEf || r.sdr === sdrEf))
    .map(r => ({ sdr: r.sdr, data: r.data, v: r.qtd_ok || 0 }));
  renderHeatmap('cReunDiaInner', rows, 'sdr', 'v', '59,130,246');
}

// ---------- Vendas: Closer × Dia (filtrável por Curso; célula = nº vendas; hover = faturamento) ----------
function renderVendaDia() {
  // usa o dado diário por closer+curso; soma cursos quando "todos"
  const fonte = CS.data.venda_closer_curso_diario || [];
  const closerEf = CS.closerSel || (CS.selCloser !== 'todos' ? CS.selCloser : null);
  const cursoEf = CS.cursoSel || (CS.selCursoVenda !== 'todos' ? CS.selCursoVenda : null);
  const rows = fonte
    .filter(r => dataNoFiltro(r.data)
      && (!closerEf || r.closer === closerEf)
      && (!cursoEf || r.curso === cursoEf)
      && cursoMatchTipoC(r.curso, CS.tipoCurso))
    .map(r => ({ closer: r.closer, data: r.data, v: r.qtd, fat: r.faturamento }));
  renderHeatmap('cVendaDiaInner', rows, 'closer', 'v', '31,181,65', 'fat');
}

// data ISO 'YYYY-MM-DD' -> 'DD/MM/YYYY'
function cDataBR(iso) { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; }
// rótulo de curso: deixa claro quando o produto não foi informado na base
function lblCurso(c) { return (c === '(sem produto)') ? 'Produto não informado' : c; }
// Liga o toggle de drilldown: clicar numa tr.row-click mostra/esconde a tr.drill-row seguinte
function wireDrill(host) {
  host.querySelectorAll('tr.row-click').forEach(tr => {
    tr.onclick = () => {
      const d = tr.nextElementSibling;
      if (d && d.classList.contains('drill-row')) { d.classList.toggle('hidden'); tr.classList.toggle('open'); }
    };
  });
}

// ---------- Closer × Curso ----------
function renderCloserCursoC() {
  const cursoEf = CS.cursoSel || (CS.selCurso !== 'todos' ? CS.selCurso : null);
  const rows = (CS.data.closer_curso_mensal || []).filter(r =>
    cTupleAtivo(r.ano, r.mes) && (!cursoEf || r.curso === cursoEf) && cursoMatchTipoC(r.curso, CS.tipoCurso));
  const acc = {};
  rows.forEach(r => {
    const A = acc[r.closer] || (acc[r.closer] = { closer: r.closer, reunioes: 0, vendas: 0, faturamento: 0, cursos: {} });
    A.reunioes += r.reunioes; A.vendas += r.vendas; A.faturamento += r.faturamento;
    if (r.vendas > 0 || r.faturamento > 0) {
      const C = A.cursos[r.curso] || (A.cursos[r.curso] = { vendas: 0, faturamento: 0 });
      C.vendas += r.vendas; C.faturamento += r.faturamento;
    }
  });
  const linhas = Object.values(acc).filter(c => c.reunioes > 0 || c.vendas > 0)
    .sort((a, b) => b.vendas - a.vendas || b.reunioes - a.reunioes);
  const cursoLbl = CS.selCurso === 'todos' ? 'todos os cursos' : CS.selCurso;
  const body = linhas.length ? linhas.map((c, i) => {
    const prods = Object.entries(c.cursos).map(([cu, v]) => ({ cu, ...v })).sort((a, b) => b.faturamento - a.faturamento);
    const drill = prods.length ? `
      <tr class="drill-row hidden"><td></td><td colspan="5"><div class="drill-box">
        <div class="drill-title">Produtos vendidos por ${escC(c.closer)}</div>
        ${prods.map(p => `<div class="drill-item"><span class="di-nome">${escC(lblCurso(p.cu))}</span><span class="di-q">${cN(p.vendas)} venda(s)</span><span class="di-fat">${cR$(p.faturamento)}</span></div>`).join('')}
      </div></td></tr>` : '';
    return `
      <tr class="${prods.length ? 'row-click' : ''}">
        <td class="pos">${i+1}</td><td class="nome">${prods.length ? '<span class="drill-caret">▸</span> ' : ''}${escC(c.closer)}</td>
        <td class="num">${cN(c.reunioes)}</td><td class="num"><b>${cN(c.vendas)}</b></td>
        <td class="num">${cPct(c.reunioes ? c.vendas/c.reunioes*100 : 0)}</td>
        <td class="num">${cR$(c.faturamento)}</td>
      </tr>${drill}`;
  }).join('') : '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Sem dados para esse recorte.</td></tr>';
  const host = document.getElementById('cCloserCurso');
  host.innerHTML = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Closer · <small style="font-weight:400;color:var(--text-soft)">${escC(cursoLbl)}</small></th><th class="num">Reuniões</th><th class="num">Vendas</th><th class="num">Conversão</th><th class="num">Faturamento</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  wireDrill(host);
}

// ---------- Chips do filtro ativo (resumo do recorte, removível) ----------
function periodoLabelC() {
  const f = CS.filtro;
  if (f.range) { const fmt = (s) => s.split('-').reverse().join('/'); return `${fmt(f.range.de)} → ${fmt(f.range.ate)}`; }
  const p = [], mSel = cMesesSel(), dSel = cDiasSel();
  if (dSel) p.push(dSel.length === 1 ? `Dia ${dSel[0]}` : `${dSel.length} dias`);
  if (mSel) p.push(mSel.length === 1 ? CMES[parseInt(mSel[0],10)-1] : `${mSel.length} meses`);
  if (f.ano !== 'all') p.push(String(f.ano));
  return p.length ? p.join(' · ') : null;
}
function resetPeriodoC() {
  CS.filtro = { ano:'all', mes:'all', dia:'all', range:null };
  const selA = document.getElementById('cAno'); if (selA) selA.value = 'all';
  MS_C.mes && MS_C.mes.setValores([]); MS_C.dia && MS_C.dia.setValores([]);
  const bp = document.getElementById('cBtnPers'); if (bp) { bp.classList.remove('has-range'); bp.textContent = 'Personalizado'; }
  const rp = document.getElementById('cRangePanel'); if (rp) rp.hidden = true;
  const fb = document.querySelector('.filter-bar'); if (fb) fb.classList.remove('range-open');
  clearPresetsC();
}
function renderChipsC() {
  const host = document.getElementById('cChips'); if (!host) return;
  const chips = [];
  const per = periodoLabelC();
  if (per) chips.push({ k:'Período', v: per, rem:'periodo' });
  if (CS.tipoCurso !== 'all') chips.push({ k:'Tipo', v: ({mba:'MBA',pos:'Pós',imersoes:'Imersões'})[CS.tipoCurso] || CS.tipoCurso, rem:'tipo', cls:'is-tipo' });
  if (CS.closerSel) chips.push({ k:'Closer', v: CS.closerSel, rem:'closer', cls:'is-sel' });
  if (CS.cursoSel) chips.push({ k:'Curso', v: lblCurso(CS.cursoSel), rem:'curso', cls:'is-sel' });
  if (CS.sdrSel) chips.push({ k:'SDR', v: CS.sdrSel, rem:'sdr', cls:'is-sel' });
  if (!chips.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<span class="fc-lead">Filtros</span>` +
    chips.map(c => `<span class="fchip ${c.cls||''}" data-rem="${c.rem}"><span class="fchip-k">${c.k}</span> ${escC(c.v)} <button type="button" aria-label="Remover ${c.k}">✕</button></span>`).join('') +
    (chips.length > 1 ? `<button type="button" class="fc-clear" id="cChipsClear">limpar tudo</button>` : '');
  host.querySelectorAll('.fchip button').forEach(btn => {
    btn.onclick = () => {
      const rem = btn.closest('.fchip').dataset.rem;
      if (rem === 'periodo') resetPeriodoC();
      else if (rem === 'tipo') { CS.tipoCurso = 'all'; document.querySelectorAll('.filter-type .ft-btn').forEach(x => x.classList.toggle('active', x.dataset.tipo === 'all')); }
      else if (rem === 'closer') CS.closerSel = null;
      else if (rem === 'curso') CS.cursoSel = null;
      else if (rem === 'sdr') CS.sdrSel = null;
      renderAllC();
    };
  });
  const clr = document.getElementById('cChipsClear');
  if (clr) clr.onclick = () => { const cc = document.getElementById('cClear'); if (cc) cc.click(); };
}
// alias mantido (chamadas antigas chamavam renderBannerC)
function renderBannerC() { renderChipsC(); }

// ---------- Filtros de recorte (Closer/Curso na aba Closer; SDR na aba SDR) ----------
function renderRecorteFiltros() {
  const host = document.getElementById('cRecorte'); if (!host) return;
  const opt = (lista, sel, ph) => `<option value="">${ph}</option>` +
    lista.map(v => `<option value="${escC(v)}"${v === sel ? ' selected' : ''}>${escC(v)}</option>`).join('');
  const byName = (a, b) => String(a).localeCompare(String(b), 'pt-BR');
  if (CS.aba === 'closer') {
    const closers = (CS.data.closers || []).map(c => c.nome).sort(byName);
    const cursos = (((CS.data.filtros_disponiveis || {}).produtos) || []).slice().sort(byName);
    host.innerHTML =
      `<select id="cFiltroCloser" class="sel-inline" aria-label="Filtrar por closer">${opt(closers, CS.closerSel, 'Closer: todos')}</select>` +
      `<select id="cFiltroCurso" class="sel-inline" aria-label="Filtrar por curso">${opt(cursos, CS.cursoSel, 'Curso: todos')}</select>`;
    document.getElementById('cFiltroCloser').onchange = (e) => { CS.closerSel = e.target.value || null; if (CS.closerSel) CS.cursoSel = null; renderAllC(); };
    document.getElementById('cFiltroCurso').onchange = (e) => { CS.cursoSel = e.target.value || null; if (CS.cursoSel) CS.closerSel = null; renderAllC(); };
  } else {
    const sdrs = (CS.data.sdrs || []).map(s => s.nome).sort(byName);
    host.innerHTML = `<select id="cFiltroSdr" class="sel-inline" aria-label="Filtrar por SDR">${opt(sdrs, CS.sdrSel, 'SDR: todos')}</select>`;
    document.getElementById('cFiltroSdr').onchange = (e) => { CS.sdrSel = e.target.value || null; renderAllC(); };
  }
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
  (CS.data.curso_mensal || []).filter(r => cTupleAtivo(r.ano, r.mes) && cursoMatchTipoC(r.curso, CS.tipoCurso) && (!CS.cursoSel || r.curso === CS.cursoSel)).forEach(r => {
    const A = acc[r.curso] || (acc[r.curso] = { criados:0, ganhos:0, perdidos:0, fat:0, reunioes:0 });
    A.criados += r.criados; A.ganhos += r.ganhos; A.perdidos += r.perdidos; A.fat += r.faturamento; A.reunioes += (r.com_reuniao || 0);
  });
  // Série mensal por curso (todos os meses) p/ sparkline de tendência
  const serieC = {};
  (CS.data.curso_mensal || []).forEach(r => { (serieC[r.curso] = serieC[r.curso] || []).push({ ano: r.ano, mes: r.mes, faturamento: r.faturamento }); });
  const linhas = Object.entries(acc).map(([curso, a]) => ({
    curso, ...a,
    ticket: a.ganhos ? a.fat/a.ganhos : 0,
    conv: a.reunioes ? a.ganhos/a.reunioes*100 : 0,
  })).filter(c => c.ganhos > 0 || c.criados > 0).sort((a,b) => b.fat - a.fat);

  // Vendas individuais por curso (closer + data do GANHO) p/ drilldown
  const vendasCurso = {};
  (CS.data.venda_closer_curso_diario || []).filter(r => cDataIsoAtiva(r.data) && cursoMatchTipoC(r.curso, CS.tipoCurso)).forEach(r => {
    (vendasCurso[r.curso] || (vendasCurso[r.curso] = [])).push(r);
  });

  const body = linhas.length ? linhas.map((c,i) => {
    const vendas = (vendasCurso[c.curso] || []).slice().sort((a,b) => a.data < b.data ? 1 : -1); // mais recentes 1º
    const drill = vendas.length ? `
      <tr class="drill-row hidden"><td></td><td colspan="8"><div class="drill-box">
        <div class="drill-title">Vendas de ${escC(lblCurso(c.curso))} · closer e data do ganho</div>
        ${vendas.map(v => `<div class="drill-item"><span class="di-nome">${escC(v.closer)}</span><span class="di-q">${cDataBR(v.data)}${v.qtd > 1 ? ` · ${v.qtd} vendas` : ''}</span><span class="di-fat">${cR$(v.faturamento)}</span></div>`).join('')}
      </div></td></tr>` : '';
    return `
      <tr class="${vendas.length ? 'row-click' : ''} ${i<3?'top3':''}">
        <td class="pos">${i+1}</td><td class="nome">${vendas.length ? '<span class="drill-caret">▸</span> ' : ''}${escC(lblCurso(c.curso))}</td>
        <td class="spark-td">${sparkline(ultimosMeses(serieC[c.curso],'faturamento',12))}</td>
        <td class="num">${cN(c.criados)}</td><td class="num">${cN(c.reunioes)}</td>
        <td class="num"><b>${cN(c.ganhos)}</b></td>
        <td class="num">${pillC(c.conv, 40, 20)}</td>
        <td class="num">${cR$(c.ticket)}</td><td class="num">${cR$(c.fat)}</td>
      </tr>${drill}`;
  }).join('') : '<tr><td colspan="9" style="text-align:center;padding:18px;color:var(--text-muted)">Sem dados.</td></tr>';
  const host = document.getElementById('cCursoPerf');
  host.innerHTML = `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Curso</th><th class="spark-th">12m · fat.</th><th class="num">Negócios</th><th class="num">Reuniões</th><th class="num">Vendas</th><th class="num">Conversão</th><th class="num">Ticket</th><th class="num">Faturamento</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  wireDrill(host);
}

// ---------- Eficiência · SDRs (aproveitamento das reuniões, não só volume) ----------
function renderEfSdr() {
  const linhas = sdrEntidades().map(s => {
    const a = somaSdr(s.mensal);
    return { nome:s.nome, is_bot:s.is_bot, sem:s.sem, reuT:a.reunioes_total, reuOk:a.reunioes_ok, ns:a.no_show,
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
  const fonte = (CS.tipoCurso !== 'all')
    ? [...new Set((CS.data.closer_tipo_mensal || []).filter(r => r.tipo === CS.tipoCurso).map(r => r.closer))].map(nome => ({ nome, mensal: serieCloserTipo(nome) }))
    : (CS.data.closers || []);
  const linhas = fonte.map(c => {
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
function renderAllC() { renderAtiva(); renderChipsC(); renderTicker(); renderRecorteFiltros(); }

function setupTabsC() {
  document.querySelectorAll('.tabs-funnel .tab-funnel[data-aba]').forEach(b => {
    b.classList.toggle('active', b.dataset.aba === CS.aba);
    b.onclick = () => {
      if (CS.aba === b.dataset.aba) return;
      CS.aba = b.dataset.aba;
      CS.closerSel = null; CS.cursoSel = null; CS.sdrSel = null;  // recortes são por aba
      document.querySelectorAll('.tabs-funnel .tab-funnel').forEach(x => x.classList.toggle('active', x.dataset.aba === CS.aba));
      document.getElementById('paneSdr').classList.toggle('hidden', CS.aba !== 'sdr');
      document.getElementById('paneCloser').classList.toggle('hidden', CS.aba !== 'closer');
      renderAllC();
    };
  });
  document.getElementById('paneSdr').classList.toggle('hidden', CS.aba !== 'sdr');
  document.getElementById('paneCloser').classList.toggle('hidden', CS.aba !== 'closer');
}

// ---------- Tema (toggle na sidebar, igual ao MKT) ----------
function setupChromeC() {
  const saved = localStorage.getItem('hub-theme') || 'light';
  document.documentElement.dataset.theme = saved;
  const sun = document.getElementById('iconSun'), moon = document.getElementById('iconMoon');
  const btn = document.getElementById('themeToggle');
  const refresh = (t) => { if (sun) sun.classList.toggle('hidden', t === 'dark'); if (moon) moon.classList.toggle('hidden', t !== 'dark'); };
  refresh(saved);
  if (btn) btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hub-theme', next);
    refresh(next);
    if (CS.data) renderAtiva();
  });
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
    CS.filtro = { ano:'all', mes:'all', dia:'all', range:null }; CS.closerSel = null; CS.tipoCurso = 'all'; CS.cursoSel = null; CS.sdrSel = null;
    document.querySelectorAll('.filter-type .ft-btn').forEach(x => x.classList.toggle('active', x.dataset.tipo === 'all'));
    selA.value='all'; MS_C.mes.setValores([]); MS_C.dia.setValores([]);
    if (btnPers){ btnPers.classList.remove('has-range'); btnPers.textContent='Personalizado'; if(rangePanel) rangePanel.hidden=true; }
    document.querySelector('.filter-bar') && document.querySelector('.filter-bar').classList.remove('range-open');
    clearPresetsC(); renderAllC(); renderBannerC();
  };

  // Filtro de TIPO de curso (MBA/Pós/Imersão) — afeta as duas abas (SDR parcial)
  document.querySelectorAll('.filter-type .ft-btn[data-tipo]').forEach(b => {
    b.classList.toggle('active', b.dataset.tipo === CS.tipoCurso);
    b.onclick = () => {
      CS.tipoCurso = b.dataset.tipo;
      document.querySelectorAll('.filter-type .ft-btn').forEach(x => x.classList.toggle('active', x.dataset.tipo === CS.tipoCurso));
      CS.closerSel = null;
      renderAllC(); renderBannerC();
    };
  });

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
  setupChromeC();
  if (!window.PAINEL_ENC_COMERCIAL || !window.HubAuth) {
    document.body.innerHTML = '<div style="font-family:sans-serif;padding:40px;text-align:center">Dados da área comercial não encontrados. Rode <b>Atualizar HUB MKT.bat</b>.</div>';
    return;
  }
  try { CS.data = await HubAuth.unlock({ key:'comercial', varName:'PAINEL_ENC_COMERCIAL', nome:'Comercial' }); }
  catch (e) { console.error(e); return; }
  // Data de atualização no MESMO formato da home/MKT: "Atualizado em DD/MM/AAAA, HH:MM".
  (function setHintAtualizado() {
    const el = document.getElementById('cHint'); if (!el) return;
    const m = CS.data.meta || {};
    if (m.atualizado_em) {
      el.textContent = 'Atualizado em ' + new Date(m.atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } else if (m.data_referencia) {
      el.textContent = 'Atualizado em ' + new Date(m.data_referencia + 'T00:00:00').toLocaleDateString('pt-BR');
    } else { el.textContent = ''; }
  })();
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

  // Sombra na barra de filtros quando "grudada" no topo
  (function stickyShadow() {
    const fs = document.querySelector('.filters-sticky'); if (!fs) return;
    const on = () => fs.classList.toggle('is-stuck', fs.getBoundingClientRect().top <= 0.5);
    window.addEventListener('scroll', on, { passive: true }); on();
  })();

  // Ticker: clicar fixa/abre painel estático; clicar de novo volta a rolar
  (function tickerToggle() {
    const tk = document.getElementById('cTicker'); if (!tk) return;
    tk.addEventListener('click', (e) => { if (e.target.closest('.tk-panel')) return; tk.classList.toggle('expanded'); });
  })();

  renderAllC();
})();
