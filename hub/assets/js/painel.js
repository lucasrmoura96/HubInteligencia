/* ============================================================
   HUB AGROADVANCE — Painel ATLAS
   ============================================================ */

const STATE = {
  data: null,
  tab: 'fundo',
  filtro: { ano: 'all', mes: 'all', dia: 'all' },
  tipoCurso: 'all',         // all | mba | pos | imersoes
  selecao: null,
  busca: { ranking: '', tabela: '', cursos: '' },
  sortTabela: { col: 'leads', dir: 'desc' },
};

// Classifica o curso por palavra-chave no nome
function getCursoTipo(curso) {
  if (!curso) return 'outros';
  const c = curso.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (c.startsWith('mba')) return 'mba';
  if (c.includes('imersao')) return 'imersoes';
  if (c.startsWith('pos') || c.startsWith('pós')) return 'pos';
  return 'outros';
}
function cursoMatchTipo(curso, tipo) {
  if (!tipo || tipo === 'all') return true;
  return getCursoTipo(curso) === tipo;
}

const MESES_NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Formatação pt-BR — SEMPRE com separador de milhar, nunca abreviado
const fmtN    = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const fmtR$2  = (n) => (n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
const fmtPct  = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%');
const fmtMult = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + 'x');
// Aliases legados (mantidos pra não quebrar usos antigos — não usar em código novo)
const fmtR$ = fmtR$2, fmtR$M = fmtR$2, fmtR$K = fmtR$2;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Parse de data ISO (YYYY-MM-DD) preservando timezone local.
// `new Date("2026-05-22")` é interpretado como UTC midnight → vira dia 21 no Brasil (UTC-3).
// Esta função força meia-noite LOCAL para que getDate()/getMonth() não tenham off-by-one.
function parseDataRef(isoStr) {
  if (!isoStr) return new Date();
  // Se vier só "YYYY-MM-DD" (sem hora), força T00:00:00 local
  const s = /^\d{4}-\d{2}-\d{2}$/.test(isoStr) ? isoStr + 'T00:00:00' : isoStr;
  return new Date(s);
}

function classifyFonte(fonte) {
  const f = (fonte || '').toLowerCase();
  if (f.includes('meta')) return 'meta';
  if (f.includes('google')) return 'google';
  if (f.includes('linkedin')) return 'linkedin';
  if (f.includes('whatsapp')) return 'whatsapp';
  if (f.includes('crm') || f.includes('e-mail')) return 'crm';
  if (f.includes('eventos')) return 'eventos';
  return 'outros';
}

// Logos PNG reais (Meta Ads e Google Ads enviados pelo cliente)
const SOURCE_LOGOS = {
  meta:   '<img src="assets/img/META%20ICON.png" alt="Meta" />',
  google: '<img src="assets/img/GOOGLE%20ADS%20ICON.png" alt="Google Ads" />',
};

// Versão COM logo — usada apenas na "Galeria de Criativos" (Curso → Canal)
function sourceWithLogo(fonteName, sourceClass) {
  const logo = SOURCE_LOGOS[sourceClass];
  return `<span class="source-pill ${sourceClass}">${logo ? `<span class="source-logo">${logo}</span>` : ''}${escapeHtml(fonteName)}</span>`;
}

// Versão SEM logo — usada no Ranking de Criativos (só texto)
function sourceTextOnly(fonteName, sourceClass) {
  return `<span class="source-pill ${sourceClass}">${escapeHtml(fonteName)}</span>`;
}

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pctClass(pct) {
  if (pct >= 60) return 'good';
  if (pct >= 30) return 'mid';
  return 'bad';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toast(msg, type='info') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.getElementById('toastArea').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2400);
}

// Count-up animation para números
function countUp(el, target, duration = 700, fmt = fmtN) {
  if (!el) return;
  const start = 0;
  const startT = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - startT) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = start + (target - start) * eased;
    el.textContent = fmt(val);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  };
  requestAnimationFrame(tick);
}

// ============================================================
// THEME
// ============================================================
function setupTheme() {
  const saved = localStorage.getItem('hub-theme') || 'light';
  document.documentElement.dataset.theme = saved;
  const sun = document.getElementById('iconSun');
  const moon = document.getElementById('iconMoon');
  const refresh = (t) => { sun.classList.toggle('hidden', t === 'dark'); moon.classList.toggle('hidden', t !== 'dark'); };
  refresh(saved);
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hub-theme', next);
    refresh(next);
    if (STATE.data) renderAll();
  });
}

// ============================================================
// DATA LOAD
// ============================================================
async function loadData() {
  if (window.PAINEL_DATA) { STATE.data = window.PAINEL_DATA; return true; }
  try {
    const res = await fetch('dados/performance_mkt.json');
    STATE.data = await res.json();
    return true;
  } catch (e) {
    toast('Dados não encontrados. Rode scripts/ATUALIZAR.bat', 'error');
    return false;
  }
}

function renderHeader() {
  const upd = new Date(STATE.data.meta.atualizado_em);
  let txt = upd.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  // Aviso quando data_referencia (última data presente no RD) está defasada vs hoje real
  // Detecta dados desatualizados sem precisar de monitoramento externo.
  try {
    const dataRef = parseDataRef(STATE.data.meta.data_referencia);
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const diffDias = Math.floor((hoje - dataRef) / (1000 * 60 * 60 * 24));
    if (diffDias > 1) {
      txt += ` · dados de ${diffDias} dia(s) atrás`;
    }
  } catch (e) { /* ignora */ }

  document.getElementById('updateText').textContent = txt;
}

// ============================================================
// TABS Topo/Fundo — clean: só "Topo" e "Fundo"
// ============================================================
function renderTabs() {
  document.querySelectorAll('.tab-funnel').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === STATE.tab);
    b.addEventListener('click', () => {
      STATE.tab = b.dataset.tab;
      STATE.selecao = null;
      document.querySelectorAll('.tab-funnel').forEach(x => x.classList.toggle('active', x.dataset.tab === STATE.tab));
      setupFiltros();
      renderAll();
    });
  });
}

// ============================================================
// FILTROS
// ============================================================
function setupFiltros() {
  const tab = STATE.data[STATE.tab];
  const anos = [...new Set(tab.mensal.map(m => m.ano))].sort();

  const selAno = document.getElementById('filtroAno');
  const selMes = document.getElementById('filtroMes');
  const selDia = document.getElementById('filtroDia');

  selAno.innerHTML = '<option value="all">Todos os anos</option>' + anos.map(a => `<option value="${a}">${a}</option>`).join('');
  selMes.innerHTML = '<option value="all">Todos os meses</option>' + MESES_NOMES.map((n, i) => `<option value="${i+1}">${n}</option>`).join('');
  selDia.innerHTML = '<option value="all">Todos os dias</option>' + Array.from({length: 31}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('');

  selAno.value = STATE.filtro.ano;
  selMes.value = STATE.filtro.mes;
  selDia.value = STATE.filtro.dia;

  selAno.onchange = () => { STATE.filtro.ano = selAno.value; clearPresets(); renderAll(); };
  selMes.onchange = () => { STATE.filtro.mes = selMes.value; clearPresets(); renderAll(); };
  selDia.onchange = () => { STATE.filtro.dia = selDia.value; clearPresets(); renderAll(); };

  document.querySelectorAll('.preset').forEach(b => {
    b.onclick = () => {
      const p = b.dataset.preset;
      clearPresets(); b.classList.add('active');
      const ref = parseDataRef(STATE.data.meta.data_referencia);
      if (p === 'all') STATE.filtro = { ano:'all', mes:'all', dia:'all' };
      else if (p === 'ytd') STATE.filtro = { ano: String(ref.getFullYear()), mes:'all', dia:'all' };
      else if (p === 'month') STATE.filtro = { ano: String(ref.getFullYear()), mes: String(ref.getMonth()+1), dia:'all' };
      else if (p === 'today') STATE.filtro = { ano: String(ref.getFullYear()), mes: String(ref.getMonth()+1), dia: String(ref.getDate()) };
      selAno.value = STATE.filtro.ano;
      selMes.value = STATE.filtro.mes;
      selDia.value = STATE.filtro.dia;
      renderAll();
    };
  });

  document.getElementById('btnClear').onclick = () => {
    STATE.filtro = { ano:'all', mes:'all', dia:'all' };
    selAno.value = selMes.value = selDia.value = 'all';
    clearPresets();
    renderAll();
  };

  // Filtros de TIPO de curso (MBA, Pós, Imersões)
  document.querySelectorAll('.ft-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tipo === STATE.tipoCurso);
    b.onclick = () => {
      STATE.tipoCurso = b.dataset.tipo;
      document.querySelectorAll('.ft-btn').forEach(x => x.classList.toggle('active', x.dataset.tipo === STATE.tipoCurso));
      renderAll();
    };
  });
}
function clearPresets() { document.querySelectorAll('.preset').forEach(b => b.classList.remove('active')); }

// ============================================================
// CÁLCULO KPIs FILTRADOS
// ============================================================
function calcKpisFiltrados() {
  const tab = STATE.data[STATE.tab];
  const { ano, mes, dia } = STATE.filtro;
  const tipo = STATE.tipoCurso;

  if (STATE.selecao) return calcKpisSelecao();

  // Quando há filtro de TIPO de curso, combina:
  //   - por_curso_mensal (curso × mês)  → leads, mqls, custo
  //   - por_tipo_mensal  (tipo × mês)   → reuniões, ganhos, faturamento (via Negócio - Produto de Interesse)
  // E deriva ROAS/CAC/Ticket/CPR a partir desses valores.
  if (tipo !== 'all') {
    // === Lead, MQL, Custo: vem do agregado por curso ===
    let leadsMqlsCusto;
    if (tab.por_curso_mensal && tab.por_curso_mensal.length) {
      let rows = tab.por_curso_mensal;
      if (ano !== 'all') rows = rows.filter(r => String(r.ano) === String(ano));
      if (mes !== 'all') rows = rows.filter(r => String(r.mes) === String(mes));
      rows = rows.filter(r => cursoMatchTipo(r.curso, tipo));
      leadsMqlsCusto = rows.reduce((a, c) => ({
        leads: a.leads + c.leads,
        mqls:  a.mqls  + c.mqls,
        custo: a.custo + c.custo,
      }), { leads: 0, mqls: 0, custo: 0 });
    } else {
      // Fallback legado: por_curso_real (sem dimensão temporal)
      const cursos = (tab.por_curso_real || []).filter(c => cursoMatchTipo(c.curso, tipo));
      leadsMqlsCusto = cursos.reduce((a, c) => ({
        leads: a.leads + c.leads,
        mqls:  a.mqls  + c.mqls,
        custo: a.custo + c.custo,
      }), { leads: 0, mqls: 0, custo: 0 });
    }

    // === Reuniões, Ganhos, Faturamento: vem do agregado por tipo ===
    let financeiro = { reunioes: null, ganhos: null, faturamento: null };
    if (tab.por_tipo_mensal && tab.por_tipo_mensal.length) {
      let rowsT = tab.por_tipo_mensal.filter(r => r.tipo === tipo);
      if (ano !== 'all') rowsT = rowsT.filter(r => String(r.ano) === String(ano));
      if (mes !== 'all') rowsT = rowsT.filter(r => String(r.mes) === String(mes));
      financeiro = rowsT.reduce((a, c) => ({
        reunioes:    a.reunioes    + c.reunioes,
        ganhos:      a.ganhos      + c.ganhos,
        faturamento: a.faturamento + c.faturamento,
      }), { reunioes: 0, ganhos: 0, faturamento: 0 });
    }

    const custo = leadsMqlsCusto.custo;
    return {
      ...leadsMqlsCusto,
      ...financeiro,
      pct_mql:         leadsMqlsCusto.leads ? (leadsMqlsCusto.mqls/leadsMqlsCusto.leads*100) : 0,
      pct_mql_reuniao: leadsMqlsCusto.mqls && financeiro.reunioes != null ? (financeiro.reunioes/leadsMqlsCusto.mqls*100) : 0,
      pct_reuniao_ganho: financeiro.reunioes && financeiro.ganhos != null ? (financeiro.ganhos/financeiro.reunioes*100) : 0,
      cpl:    leadsMqlsCusto.leads ? (custo/leadsMqlsCusto.leads) : 0,
      cpmql:  leadsMqlsCusto.mqls  ? (custo/leadsMqlsCusto.mqls)  : 0,
      cpr:    financeiro.reunioes  ? (custo/financeiro.reunioes)  : 0,
      ticket_medio: financeiro.ganhos ? (financeiro.faturamento/financeiro.ganhos) : 0,
      roas:   custo ? (financeiro.faturamento/custo) : 0,
      cac:    financeiro.ganhos ? (custo/financeiro.ganhos) : 0,
    };
  }

  // Dia específico → série diária + regra de 3 para reuniões (não existem na diária)
  if (dia !== 'all' && mes !== 'all' && ano !== 'all') {
    const target = `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
    const row = (tab.diario || []).find(d => d.data === target);
    if (!row) return baseKpisZero();
    // Estimativa proporcional de Reuniões Qualificadas para o dia (regra de 3 sobre o mês)
    const anoN = parseInt(ano, 10), mesN = parseInt(mes, 10);
    const mesInt = (tab.mensal || []).find(x => x.ano === anoN && x.mes === mesN);
    const diasNoMes = new Date(anoN, mesN, 0).getDate();
    const reunioesEst = mesInt && diasNoMes ? Math.round((mesInt.reunioes_qualificadas || 0) / diasNoMes) : 0;
    return {
      leads: row.leads, mqls: row.mqls, custo: row.custo,
      ganhos: row.ganhos, faturamento: row.faturamento,
      pct_mql: row.leads ? (row.mqls/row.leads*100) : 0,
      pct_mql_reuniao: row.mqls ? (reunioesEst/row.mqls*100) : 0,
      pct_reuniao_ganho: reunioesEst ? (row.ganhos/reunioesEst*100) : 0,
      cpl: row.leads ? (row.custo/row.leads) : 0,
      cpmql: row.mqls ? (row.custo/row.mqls) : 0,
      cpr: reunioesEst ? (row.custo/reunioesEst) : 0,
      reunioes: reunioesEst,
      ticket_medio: row.ganhos ? (row.faturamento/row.ganhos) : 0,
      roas: row.custo ? (row.faturamento/row.custo) : 0,
      cac: row.ganhos ? (row.custo/row.ganhos) : 0,
    };
  }

  // Agrega meses respeitando filtros Ano/Mês
  let meses = tab.mensal;
  if (ano !== 'all') meses = meses.filter(m => String(m.ano) === String(ano));
  if (mes !== 'all') meses = meses.filter(m => String(m.mes) === String(mes));
  const acc = meses.reduce((a, m) => ({
    leads: a.leads + m.leads, mqls: a.mqls + m.mqls,
    custo: a.custo + m.custo, ganhos: a.ganhos + m.ganhos,
    faturamento: a.faturamento + m.faturamento,
    reunioes: a.reunioes + m.reunioes_qualificadas,
  }), { leads:0, mqls:0, custo:0, ganhos:0, faturamento:0, reunioes:0 });

  return {
    ...acc,
    pct_mql: acc.leads ? (acc.mqls/acc.leads*100) : 0,
    pct_mql_reuniao: acc.mqls ? (acc.reunioes/acc.mqls*100) : 0,   // Taxa MQL → Reunião
    pct_reuniao_ganho: acc.reunioes ? (acc.ganhos/acc.reunioes*100) : 0, // Win Rate (Reu→Ganho)
    cpl: acc.leads ? (acc.custo/acc.leads) : 0,
    cpmql: acc.mqls ? (acc.custo/acc.mqls) : 0,
    cpr: acc.reunioes ? (acc.custo/acc.reunioes) : 0,
    ticket_medio: acc.ganhos ? (acc.faturamento/acc.ganhos) : 0,
    roas: acc.custo ? (acc.faturamento/acc.custo) : 0,
    cac: acc.ganhos ? (acc.custo/acc.ganhos) : 0,
  };
}
function baseKpisZero() {
  return { leads:0, mqls:0, custo:0, ganhos:0, faturamento:0, pct_mql:0, cpl:0, cpmql:0, cpr:0, reunioes:0, ticket_medio:0, roas:0, cac:0 };
}

// ============================================================
// MoM — Calcula KPIs do mês anterior
// Quando filtro = mês em curso, compara proporcionalmente (mesmos dias)
// ============================================================

// Agrega KPIs num período arbitrário
function calcKpisPeriodo({ ano, mes, diaInicio = null, diaFim = null }) {
  const tab = STATE.data[STATE.tab];

  // Recorte por dias → REGRA DE 3 sobre o mês inteiro para TODAS as métricas
  // (mantém comparativo apples-to-apples proporcional: "o que seria o mês passado neste mesmo
  //  ponto do mês se o ritmo fosse constante?")
  if (diaInicio != null && diaFim != null) {
    const mesInt = (tab.mensal || []).find(x => x.ano === ano && x.mes === mes);
    const diasNoMes = new Date(ano, mes, 0).getDate();    // último dia do mês
    const diasRecorte = diaFim - diaInicio + 1;
    const propor = diasNoMes ? (diasRecorte / diasNoMes) : 0;

    if (mesInt) {
      const leads = Math.round((mesInt.leads || 0) * propor);
      const mqls  = Math.round((mesInt.mqls  || 0) * propor);
      const custo = (mesInt.custo || 0) * propor;
      const ganhos = Math.round((mesInt.ganhos || 0) * propor);
      const faturamento = (mesInt.faturamento || 0) * propor;
      const reunioes = Math.round((mesInt.reunioes_qualificadas || 0) * propor);
      return {
        leads, mqls, custo, ganhos, faturamento, reunioes,
        pct_mql: leads ? (mqls/leads*100) : 0,
        pct_mql_reuniao: mqls ? (reunioes/mqls*100) : 0,
        pct_reuniao_ganho: reunioes ? (ganhos/reunioes*100) : 0,
        cpl: leads ? (custo/leads) : 0,
        cpmql: mqls ? (custo/mqls) : 0,
        cpr: reunioes ? (custo/reunioes) : 0,
        ticket_medio: ganhos ? (faturamento/ganhos) : 0,
        roas: custo ? (faturamento/custo) : 0,
        cac: ganhos ? (custo/ganhos) : 0,
      };
    }

    // Fallback: sem dado mensal — recai na série diária (caso raro)
    const inicio = `${ano}-${String(mes).padStart(2,'0')}-${String(diaInicio).padStart(2,'0')}`;
    const fim    = `${ano}-${String(mes).padStart(2,'0')}-${String(diaFim).padStart(2,'0')}`;
    const rows = (tab.diario || []).filter(d => d.data >= inicio && d.data <= fim);
    if (!rows.length) return null;
    const acc = rows.reduce((a, r) => ({
      leads: a.leads + r.leads,
      mqls: a.mqls + r.mqls,
      custo: a.custo + r.custo,
      ganhos: a.ganhos + r.ganhos,
      faturamento: a.faturamento + r.faturamento,
    }), { leads:0, mqls:0, custo:0, ganhos:0, faturamento:0 });
    return {
      ...acc, reunioes: 0,
      pct_mql: acc.leads ? (acc.mqls/acc.leads*100) : 0,
      pct_mql_reuniao: 0, pct_reuniao_ganho: 0,
      cpl: acc.leads ? (acc.custo/acc.leads) : 0,
      cpmql: acc.mqls ? (acc.custo/acc.mqls) : 0,
      cpr: 0,
      ticket_medio: acc.ganhos ? (acc.faturamento/acc.ganhos) : 0,
      roas: acc.custo ? (acc.faturamento/acc.custo) : 0,
      cac: acc.ganhos ? (acc.custo/acc.ganhos) : 0,
    };
  }

  // Mês completo → detalhamento mensal
  const m = (tab.mensal || []).find(x => x.ano === ano && x.mes === mes);
  if (!m) return null;
  return {
    leads: m.leads, mqls: m.mqls, custo: m.custo,
    pct_mql: m.pct_mql,
    pct_mql_reuniao: m.mqls ? (m.reunioes_qualificadas / m.mqls * 100) : 0,
    pct_reuniao_ganho: m.reunioes_qualificadas ? (m.ganhos / m.reunioes_qualificadas * 100) : 0,
    cpl: m.cpl, cpmql: m.cpmql,
    cpr: m.reunioes_qualificadas ? (m.custo / m.reunioes_qualificadas) : 0,
    reunioes: m.reunioes_qualificadas,
    ganhos: m.ganhos, faturamento: m.faturamento,
    ticket_medio: m.ticket_medio,
    roas: m.custo ? (m.faturamento / m.custo) : 0,
    cac: m.ganhos ? (m.custo / m.ganhos) : 0,
  };
}

function calcKpisMesAnterior() {
  if (STATE.selecao) return null;
  if (STATE.tipoCurso !== 'all') return null;

  const { ano, mes, dia } = STATE.filtro;
  // MoM exige mês específico (ano OU mês "all" não dá pra calcular)
  if (ano === 'all' || mes === 'all') return null;

  // Mês anterior
  let anoAnt = parseInt(ano, 10);
  let mesAnt = parseInt(mes, 10) - 1;
  if (mesAnt < 1) { mesAnt = 12; anoAnt -= 1; }

  // Dia específico → compara com mesmo dia do mês anterior
  if (dia !== 'all') {
    const d = parseInt(dia, 10);
    return calcKpisPeriodo({ ano: anoAnt, mes: mesAnt, diaInicio: d, diaFim: d });
  }

  // Mês em curso → comparação proporcional (mesma quantidade de dias do mês anterior)
  const dataRef = parseDataRef(STATE.data.meta.data_referencia);
  const mesEmCurso = parseInt(ano, 10) === dataRef.getFullYear()
                  && parseInt(mes, 10) === (dataRef.getMonth() + 1);

  if (mesEmCurso) {
    const diaFim = dataRef.getDate();
    return calcKpisPeriodo({ ano: anoAnt, mes: mesAnt, diaInicio: 1, diaFim });
  }

  // Mês fechado → comparação mês inteiro vs mês inteiro anterior
  return calcKpisPeriodo({ ano: anoAnt, mes: mesAnt });
}

function momLabel() {
  if (STATE.selecao || STATE.tipoCurso !== 'all') return null;
  const { ano, mes, dia } = STATE.filtro;
  if (ano === 'all' || mes === 'all') return null;
  if (dia !== 'all') return 'MoM';
  const dataRef = parseDataRef(STATE.data.meta.data_referencia);
  const mesEmCurso = parseInt(ano, 10) === dataRef.getFullYear()
                  && parseInt(mes, 10) === (dataRef.getMonth() + 1);
  return mesEmCurso ? 'MoM parc.' : 'MoM';
}

// YoY: mesmo período do ano anterior (mês, dia ou ano completo)
function calcKpisAnoAnterior() {
  if (STATE.selecao) return null;
  if (STATE.tipoCurso !== 'all') return null;

  const { ano, mes, dia } = STATE.filtro;
  // YoY exige ano específico
  if (ano === 'all') return null;

  const anoAnt = parseInt(ano, 10) - 1;
  const tab = STATE.data[STATE.tab];

  // Confirma que existe dado do ano anterior
  const temDadosAnoAnt = (tab.mensal || []).some(m => m.ano === anoAnt);
  if (!temDadosAnoAnt) return null;

  // Dia específico → mesmo dia do ano anterior
  if (dia !== 'all' && mes !== 'all') {
    const d = parseInt(dia, 10);
    const m = parseInt(mes, 10);
    return calcKpisPeriodo({ ano: anoAnt, mes: m, diaInicio: d, diaFim: d });
  }

  // Mês específico → mesmo mês ano anterior (com proporcionalidade se for mês em curso)
  if (mes !== 'all') {
    const m = parseInt(mes, 10);
    const dataRef = parseDataRef(STATE.data.meta.data_referencia);
    const mesEmCurso = parseInt(ano, 10) === dataRef.getFullYear()
                    && m === (dataRef.getMonth() + 1);
    if (mesEmCurso) {
      return calcKpisPeriodo({ ano: anoAnt, mes: m, diaInicio: 1, diaFim: dataRef.getDate() });
    }
    return calcKpisPeriodo({ ano: anoAnt, mes: m });
  }

  // Ano completo → soma todos meses do ano anterior
  const meses = (tab.mensal || []).filter(x => x.ano === anoAnt);
  if (!meses.length) return null;
  const acc = meses.reduce((a, x) => ({
    leads: a.leads + x.leads, mqls: a.mqls + x.mqls,
    custo: a.custo + x.custo, ganhos: a.ganhos + x.ganhos,
    faturamento: a.faturamento + x.faturamento,
    reunioes: a.reunioes + x.reunioes_qualificadas,
  }), { leads:0, mqls:0, custo:0, ganhos:0, faturamento:0, reunioes:0 });
  return {
    ...acc,
    pct_mql: acc.leads ? (acc.mqls/acc.leads*100) : 0,
    pct_mql_reuniao: acc.mqls ? (acc.reunioes/acc.mqls*100) : 0,
    pct_reuniao_ganho: acc.reunioes ? (acc.ganhos/acc.reunioes*100) : 0,
    cpl: acc.leads ? (acc.custo/acc.leads) : 0,
    cpmql: acc.mqls ? (acc.custo/acc.mqls) : 0,
    cpr: acc.reunioes ? (acc.custo/acc.reunioes) : 0,
    ticket_medio: acc.ganhos ? (acc.faturamento/acc.ganhos) : 0,
    roas: acc.custo ? (acc.faturamento/acc.custo) : 0,
    cac: acc.ganhos ? (acc.custo/acc.ganhos) : 0,
  };
}

function yoyLabel() {
  if (STATE.selecao || STATE.tipoCurso !== 'all') return null;
  const { ano, mes, dia } = STATE.filtro;
  if (ano === 'all') return null;
  if (dia !== 'all' || mes === 'all') return 'YoY';
  const dataRef = parseDataRef(STATE.data.meta.data_referencia);
  const mesEmCurso = parseInt(ano, 10) === dataRef.getFullYear()
                  && parseInt(mes, 10) === (dataRef.getMonth() + 1);
  return mesEmCurso ? 'YoY parc.' : 'YoY';
}

function yoyBadge(atual, anterior, inverted = false) {
  if (anterior == null || atual == null) return '';
  if (anterior === 0) return '';
  const diff = ((atual - anterior) / anterior) * 100;
  const abs = Math.abs(diff);
  const labelTxt = yoyLabel() || 'YoY';
  if (abs < 0.05) return `<span class="kpi-yoy flat">— ${labelTxt}</span>`;
  let dir = diff > 0 ? 'up' : 'down';
  if (inverted) dir = (dir === 'up') ? 'down' : 'up';
  const arrow = diff > 0 ? '↑' : '↓';
  return `<span class="kpi-yoy ${dir}">${arrow} ${abs.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1})}% ${labelTxt}</span>`;
}

// ============================================================
// HEALTH SCORE — saúde do funil (carinhas)
// 3 sinais: ROAS · Taxa MQL→Reunião · Win Rate
// ============================================================
function calcHealthScore() {
  const k = calcKpisFiltrados();
  if (STATE.selecao || STATE.tipoCurso !== 'all' || STATE.tab !== 'fundo') return null;

  // Normaliza cada sinal pra 0-100
  // ROAS: 0=ruim, 12=bom, 18+=excelente
  const roasNorm  = Math.max(0, Math.min(100, (k.roas || 0) / 18 * 100));
  // MQL→Reunião: 0=ruim, 15=neutro, 25=bom, 35+=excelente
  const mqlReuNorm = Math.max(0, Math.min(100, (k.pct_mql_reuniao || 0) / 30 * 100));
  // Win Rate (Reu→Ganho): 0=ruim, 30=neutro, 50=bom, 70+=excelente
  const winNorm   = Math.max(0, Math.min(100, (k.pct_reuniao_ganho || 0) / 60 * 100));

  // Pesos: financeiro 35% / qualificação 30% / fechamento 35%
  const score = roasNorm * 0.35 + mqlReuNorm * 0.30 + winNorm * 0.35;

  let level, label;
  if (score < 30)       { level = 'bad';      label = 'Ruim'; }
  else if (score < 55)  { level = 'warn';     label = 'Atenção'; }
  else if (score < 80)  { level = 'good';     label = 'Bom'; }
  else                  { level = 'great';    label = 'Ótimo'; }

  return {
    score: Math.round(score),
    level,
    label,
    sinais: {
      roas: { norm: Math.round(roasNorm), valor: k.roas || 0 },
      mqlReu: { norm: Math.round(mqlReuNorm), valor: k.pct_mql_reuniao || 0 },
      win: { norm: Math.round(winNorm), valor: k.pct_reuniao_ganho || 0 },
    },
  };
}

// SVG da carinha conforme nível
function healthFaceSvg(level) {
  // Boca varia por nível
  const mouths = {
    bad:   '<path d="M22 44 Q32 36 42 44" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
    warn:  '<line x1="22" y1="42" x2="42" y2="42" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    good:  '<path d="M22 40 Q32 46 42 40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
    great: '<path d="M20 38 Q32 50 44 38" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
  };
  return `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="health-face">
      <circle cx="32" cy="32" r="28" class="face-bg"/>
      <circle cx="24" cy="26" r="3" fill="currentColor"/>
      <circle cx="40" cy="26" r="3" fill="currentColor"/>
      ${mouths[level] || mouths.warn}
    </svg>
  `;
}

function renderHealthWidget() {
  const widget = document.getElementById('healthWidget');
  if (!widget) return;

  const h = calcHealthScore();
  if (!h) {
    widget.classList.add('hidden');
    return;
  }
  widget.classList.remove('hidden');
  widget.dataset.level = h.level;
  widget.innerHTML = `
    <button class="hw-toggle" aria-label="Expandir Health Score">
      ${healthFaceSvg(h.level)}
    </button>
    <div class="hw-panel">
      <div class="hw-head">
        <span class="hw-kicker">Saúde do Funil</span>
        <span class="hw-label">${h.label}</span>
      </div>
      <div class="hw-score">
        <span class="hw-num">${h.score}</span><span class="hw-of">/100</span>
      </div>
      <div class="hw-bars">
        <div class="hw-bar">
          <span class="hw-bar-label">ROAS</span>
          <div class="hw-bar-track"><span style="width: ${h.sinais.roas.norm}%"></span></div>
          <span class="hw-bar-val">${fmtMult(h.sinais.roas.valor)}</span>
        </div>
        <div class="hw-bar">
          <span class="hw-bar-label">MQL→Reu</span>
          <div class="hw-bar-track"><span style="width: ${h.sinais.mqlReu.norm}%"></span></div>
          <span class="hw-bar-val">${fmtPct(h.sinais.mqlReu.valor)}</span>
        </div>
        <div class="hw-bar">
          <span class="hw-bar-label">Win Rate</span>
          <div class="hw-bar-track"><span style="width: ${h.sinais.win.norm}%"></span></div>
          <span class="hw-bar-val">${fmtPct(h.sinais.win.valor)}</span>
        </div>
      </div>
    </div>
  `;

  // Toggle expand on click
  const btn = widget.querySelector('.hw-toggle');
  btn.addEventListener('click', () => widget.classList.toggle('open'));
}

// Calcula variação % e retorna HTML do badge MoM
// inverted=true → menor é melhor (custos)
function momBadge(atual, anterior, inverted = false) {
  if (anterior == null || atual == null) return '';
  if (anterior === 0) return '';
  const diff = ((atual - anterior) / anterior) * 100;
  const abs = Math.abs(diff);
  const labelTxt = momLabel() || 'MoM';
  if (abs < 0.05) return `<span class="kpi-yoy flat">— ${labelTxt}</span>`;
  let dir = diff > 0 ? 'up' : 'down';
  if (inverted) dir = (dir === 'up') ? 'down' : 'up';
  const arrow = diff > 0 ? '↑' : '↓';
  return `<span class="kpi-yoy ${dir}">${arrow} ${abs.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1})}% ${labelTxt}</span>`;
}

function calcKpisSelecao() {
  const sel = STATE.selecao; if (!sel) return baseKpisZero();
  if (sel.tipo === 'campanha' || sel.tipo === 'criativo') {
    const c = sel.dados;
    return {
      leads: c.leads, mqls: c.mqls, custo: c.custo,
      pct_mql: c.pct_mql, cpl: c.leads ? c.custo/c.leads : 0, cpmql: c.mqls ? c.custo/c.mqls : 0,
      ganhos: null, faturamento: null, reunioes: null,
      ticket_medio: null, roas: null, cac: null,
    };
  }
  if (sel.tipo === 'curso') {
    const tab = STATE.data[STATE.tab];
    const reg = (tab.por_curso_real || []).find(c => c.curso === sel.valor);
    if (!reg) return baseKpisZero();
    return {
      leads: reg.leads, mqls: reg.mqls, custo: reg.custo,
      pct_mql: reg.pct_mql, cpl: reg.cpl, cpmql: reg.cpmql,
      ganhos: null, faturamento: null, reunioes: null,
      ticket_medio: null, roas: null, cac: null,
    };
  }
  return baseKpisZero();
}

// ============================================================
// SELEÇÃO (cross-filter)
// ============================================================
function selecionar(tipo, valor, extra = {}) {
  if (STATE.selecao && STATE.selecao.tipo === tipo && STATE.selecao.valor === valor) {
    STATE.selecao = null;
  } else {
    STATE.selecao = { tipo, valor, ...extra };
  }
  renderAll();
}

function renderSelectionBanner() {
  const b = document.getElementById('selectionBanner');
  if (!STATE.selecao) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  const tipos = { campanha:'Campanha', criativo:'Criativo', curso:'Curso' };
  document.getElementById('selectionLabel').textContent = STATE.selecao.valor;
  document.getElementById('selectionType').textContent = ' · ' + (tipos[STATE.selecao.tipo] || STATE.selecao.tipo);
  document.getElementById('clearSelection').onclick = () => { STATE.selecao = null; renderAll(); };
}

// ============================================================
// KPI CELLS — Editorial
// ============================================================
function renderKPIs() {
  const isFundo = STATE.tab === 'fundo';
  const k = calcKpisFiltrados();
  const sel = STATE.selecao;
  const fin = STATE.data[STATE.tab].financeiro;

  // Atualiza títulos
  document.getElementById('sec1Title').textContent = isFundo ? 'Indicadores · Fundo' : 'Indicadores · Topo';
  const periodo = STATE.filtro.ano === 'all' && STATE.filtro.mes === 'all'
    ? 'Período completo'
    : `${STATE.filtro.dia !== 'all' ? STATE.filtro.dia + '/' : ''}${STATE.filtro.mes !== 'all' ? MESES_NOMES[STATE.filtro.mes-1] + ' · ' : ''}${STATE.filtro.ano !== 'all' ? STATE.filtro.ano : ''}`;
  document.getElementById('sec1Hint').textContent = sel ? `Seleção: ${sel.valor}` : periodo;

  const kAA  = calcKpisMesAnterior();     // MoM
  const kAAY = calcKpisAnoAnterior();     // YoY

  // Helper de comparativos: MoM + YoY centralizado abaixo do valor
  const cmp = (atualMoM, momVal, atualYoY, yoyVal, inverted = false) => {
    // Sem contexto temporal (filtro = "Tudo", cross-filter ou tipo) → não mostra badges
    // Evita o ruído visual de 12 cards exibindo "— sem comparativo".
    if (!kAA && !kAAY) return '';
    const m = kAA  ? momBadge(atualMoM, momVal, inverted) : '';
    const y = kAAY ? yoyBadge(atualYoY, yoyVal, inverted) : '';
    if (m || y) return `<span class="kpi-cmp">${m}${y}</span>`;
    // Placeholder discreto para manter altura consistente quando há contexto mas valor=null
    return `<span class="kpi-cmp"><span class="kpi-yoy flat">— sem comparativo</span></span>`;
  };

  // Métricas para os heros adicionais (preserva null pra exibir "—" em cross-filter
  // ou filtro de tipo, onde não há breakdown de reuniões/ganhos)
  const reunioesTotal  = (k.reunioes != null) ? k.reunioes : null;
  const matriculasTotal = (k.ganhos != null) ? k.ganhos : null;
  const labelMatric    = isFundo ? 'Matrículas' : 'Participações em Venda';
  const subMatric      = isFundo ? 'vendas fechadas' : 'leads que passaram pelo Topo';
  const subReu         = isFundo ? 'Atividade tipo Reunião + Quali. OK' : 'reuniões com assistência do Topo';

  // Reuniões e CPR são estimados via regra de 3 quando filtro de dia específico está ativo
  // (série diária não traz reuniões, então usamos proporção mensal).
  const isEstimado = STATE.filtro.dia !== 'all' && STATE.filtro.mes !== 'all' && STATE.filtro.ano !== 'all';
  const estTag = isEstimado ? '<span class="kpi-tag est">≈ estimado</span>' : '';

  // 4 cards HERO (2x2): Leads · MQLs / Reuniões · Matrículas
  const heroes = `
    <div class="kpi-heroes">
      <div class="kpi-cell hero ${isFundo ? 'fundo' : 'topo'}">
        <span class="kpi-label">${isFundo ? '◆ Leads · Fundo' : '◇ Leads · Topo'}</span>
        <span class="kpi-value">${fmtN(k.leads)}</span>
        ${cmp(k.leads, kAA && kAA.leads, k.leads, kAAY && kAAY.leads)}
        <span class="kpi-sub">no período filtrado</span>
      </div>
      <div class="kpi-cell hero ${isFundo ? 'fundo' : 'topo'}">
        <span class="kpi-label">MQLs</span>
        <span class="kpi-value">${fmtN(k.mqls)}</span>
        ${cmp(k.mqls, kAA && kAA.mqls, k.mqls, kAAY && kAAY.mqls)}
        <span class="kpi-sub">
          <span class="hero-rate">L→MQL <b>${fmtPct(k.pct_mql)}</b></span>
          ${isFundo && k.pct_mql_reuniao != null ? `<span class="hero-rate-sep">·</span><span class="hero-rate">MQL→Reu <b>${fmtPct(k.pct_mql_reuniao)}</b></span>` : ''}
        </span>
      </div>
      <div class="kpi-cell hero ${isFundo ? 'fundo' : 'topo'}">
        <span class="kpi-label">${isFundo ? 'Reuniões Qualificadas' : 'Reuniões Assistidas'}${estTag}</span>
        <span class="kpi-value">${fmtN(reunioesTotal)}</span>
        ${cmp(reunioesTotal, kAA && kAA.reunioes, reunioesTotal, kAAY && kAAY.reunioes)}
        <span class="kpi-sub">${subReu}</span>
      </div>
      <div class="kpi-cell hero ${isFundo ? 'fundo' : 'topo'}">
        <span class="kpi-label">${labelMatric}</span>
        <span class="kpi-value">${fmtN(matriculasTotal)}</span>
        ${cmp(matriculasTotal, kAA && kAA.ganhos, matriculasTotal, kAAY && kAAY.ganhos)}
        <span class="kpi-sub">${subMatric}</span>
      </div>
    </div>
  `;

  // 7 cards secundários — todos respeitando filtros (data + tipo)
  // Quando o tipo está ativo, ROAS/Faturamento/CAC/Ticket ficam null (não temos breakdown por curso)
  const showFinanceiros = !sel && k.faturamento != null;

  // Card CPR
  const cprCard = (k.cpr != null && k.cpr > 0) ? `
    <div class="kpi-cell">
      <span class="kpi-label">CPR</span>
      <span class="kpi-value t-num">${fmtR$2(k.cpr)}</span>
      ${cmp(k.cpr, kAA && kAA.cpr, k.cpr, kAAY && kAAY.cpr, true)}
      <span class="kpi-sub">custo por reunião quali.</span>
    </div>
  ` : `
    <div class="kpi-cell" style="opacity: 0.5;">
      <span class="kpi-label">CPR</span>
      <span class="kpi-value t-num" style="color: var(--text-soft);">—</span>
      <span class="kpi-sub">indisponível</span>
    </div>
  `;

  let secondary = `
    <div class="kpi-cell">
      <span class="kpi-label">Investimento</span>
      <span class="kpi-value t-num">${fmtR$2(k.custo)}</span>
      ${cmp(k.custo, kAA && kAA.custo, k.custo, kAAY && kAAY.custo, true)}
      <span class="kpi-sub">total no período</span>
    </div>
    <div class="kpi-cell">
      <span class="kpi-label">CPL</span>
      <span class="kpi-value t-num">${fmtR$2(k.cpl)}</span>
      ${cmp(k.cpl, kAA && kAA.cpl, k.cpl, kAAY && kAAY.cpl, true)}
      <span class="kpi-sub">custo por lead</span>
    </div>
    <div class="kpi-cell">
      <span class="kpi-label">CPMQL</span>
      <span class="kpi-value t-num">${fmtR$2(k.cpmql)}</span>
      ${cmp(k.cpmql, kAA && kAA.cpmql, k.cpmql, kAAY && kAAY.cpmql, true)}
      <span class="kpi-sub">custo por MQL</span>
    </div>
    ${isFundo ? cprCard : ''}
  `;

  if (showFinanceiros) {
    if (isFundo) {
      secondary += `
        <div class="kpi-cell featured-positive">
          <span class="kpi-label">ROAS <span class="kpi-tag">VENDA</span></span>
          <span class="kpi-value">${fmtMult(k.roas)}</span>
          ${cmp(k.roas, kAA && kAA.roas, k.roas, kAAY && kAAY.roas)}
          <span class="kpi-sub">receita ÷ custo Fundo</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Faturamento</span>
          <span class="kpi-value t-num">${fmtR$2(k.faturamento)}</span>
          ${cmp(k.faturamento, kAA && kAA.faturamento, k.faturamento, kAAY && kAAY.faturamento)}
          <span class="kpi-sub">${fmtN(k.ganhos)} vendas</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">CPA</span>
          <span class="kpi-value t-num">${fmtR$2(k.cac)}</span>
          ${cmp(k.cac, kAA && kAA.cac, k.cac, kAAY && kAAY.cac, true)}
          <span class="kpi-sub">custo por aquisição</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Ticket médio</span>
          <span class="kpi-value t-num">${fmtR$2(k.ticket_medio)}</span>
          ${cmp(k.ticket_medio, kAA && kAA.ticket_medio, k.ticket_medio, kAAY && kAAY.ticket_medio)}
          <span class="kpi-sub">por negócio</span>
        </div>
      `;
    } else {
      secondary += `
        <div class="kpi-cell featured-accent">
          <span class="kpi-label">ROAS <span class="kpi-tag">INFLUÊNCIA</span></span>
          <span class="kpi-value">${fmtMult(k.roas)}</span>
          ${cmp(k.roas, kAA && kAA.roas, k.roas, kAAY && kAAY.roas)}
          <span class="kpi-sub">influenciado ÷ custo Topo</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Faturamento influenciado</span>
          <span class="kpi-value t-num">${fmtR$2(k.faturamento)}</span>
          ${cmp(k.faturamento, kAA && kAA.faturamento, k.faturamento, kAAY && kAAY.faturamento)}
          <span class="kpi-sub">não-exclusivo</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Participações em venda</span>
          <span class="kpi-value t-num">${fmtN(k.ganhos)}</span>
          ${cmp(k.ganhos, kAA && kAA.ganhos, k.ganhos, kAAY && kAAY.ganhos)}
          <span class="kpi-sub">passaram pelo Topo</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Ticket médio</span>
          <span class="kpi-value t-num">${fmtR$2(k.ticket_medio)}</span>
          ${cmp(k.ticket_medio, kAA && kAA.ticket_medio, k.ticket_medio, kAAY && kAAY.ticket_medio)}
          <span class="kpi-sub">por venda assistida</span>
        </div>
      `;
    }
  } else {
    // Quando há cross-filter OU filtro de tipo, financeiros ficam indisponíveis
    const motivo = sel ? 'na seleção atual' : 'no filtro por tipo';
    for (let i = 0; i < 4; i++) {
      secondary += `
        <div class="kpi-cell" style="opacity: 0.35; pointer-events: none;">
          <span class="kpi-label">—</span>
          <span class="kpi-value t-num" style="color: var(--text-soft);">—</span>
          <span class="kpi-sub">indisponível ${motivo}</span>
        </div>
      `;
    }
  }

  document.getElementById('kpiGrid').innerHTML = heroes + `<div class="kpi-secondary">${secondary}</div>`;
}

// ============================================================
// FUNIL VERTICAL REAL — trapézios empilhados, centralizados
// RESPEITA filtro de data (Ano/Mês/Dia) e tab Topo/Fundo
// ============================================================
function renderFunil() {
  const wrap = document.getElementById('funilCard');
  if (STATE.selecao) { wrap.classList.add('hidden'); return; }
  if (STATE.tipoCurso !== 'all') { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  // CONSTRÓI o funil baseado nos KPIs filtrados (não no JSON estático)
  const k = calcKpisFiltrados();
  const isFundo = STATE.tab === 'fundo';

  // Conversões entre etapas
  const conv_leads_mql  = k.leads ? (k.mqls / k.leads * 100) : 0;
  const conv_mql_reu    = k.mqls ? (k.reunioes / k.mqls * 100) : 0;
  const conv_reu_ganho  = k.reunioes ? (k.ganhos / k.reunioes * 100) : 0;

  const funil = {
    etapas: [
      { etapa: 'Leads', valor: k.leads, conversao: null },
      { etapa: 'MQLs', valor: k.mqls, conversao: conv_leads_mql },
      {
        etapa: isFundo ? 'Reuniões Qualificadas' : 'Reuniões Assistidas',
        valor: k.reunioes || 0,
        conversao: conv_mql_reu,
      },
      {
        etapa: isFundo ? 'Ganhos' : 'Participações em Venda',
        valor: k.ganhos || 0,
        conversao: conv_reu_ganho,
        faturamento: k.faturamento != null ? k.faturamento : null,
      },
    ],
  };

  document.getElementById('funilSecTitle').textContent = isFundo
    ? 'Jornada · Captação → Venda'
    : 'Jornada · Assistência do Topo';
  document.getElementById('funilSecHint').textContent = isFundo
    ? 'Leads → MQLs → Reuniões Qualificadas → Vendas'
    : 'Leads → MQLs → Reuniões Assistidas → Participações em Venda';

  const container = document.getElementById('funilContainer');
  container.className = `funnel-vert ${isFundo ? 'fundo' : 'topo'}`;

  // Paleta degradê (verde escurecendo / azul escurecendo)
  const palette = isFundo
    ? ['#34cc5d', '#1fb541', '#137f2e', '#0a4519']
    : ['#6ca1df', '#1f5ba4', '#143a6b', '#0b2138'];

  // Larguras 100% proporcionais ao volume (REAL).
  // Piso técnico de 8% só pra garantir que o card permaneça clicável/legível
  // quando o valor é minúsculo (ex: Ganhos com 1k vs Leads com 53k).
  const maxVal = Math.max(...funil.etapas.map(e => e.valor || 0)) || 1;
  const MIN_W = 8;
  const calcWidth = (v) => {
    if (!v || maxVal === 0) return MIN_W + '%';
    const pct = (v / maxVal) * 100;
    return Math.max(MIN_W, pct).toFixed(1) + '%';
  };

  // Etapas
  let html = '';
  funil.etapas.forEach((e, i) => {
    const color = palette[i] || palette[palette.length-1];
    const pct = maxVal ? (e.valor / maxVal) * 100 : 0;
    const width = calcWidth(e.valor || 0);
    // Quando a barra fica estreita (<35% da largura), os números aparecem FORA dela
    const isNarrow = pct < 35;
    const money = e.faturamento != null
      ? `<span class="fn-money">${fmtR$2(e.faturamento)}</span>`
      : '';
    const innerHtml = isNarrow
      ? `` // barra estreita: card limpo, conteúdo fica no outside
      : `
        <div class="fn-meta">
          <span class="fn-name">${e.etapa}</span>
        </div>
        <div class="fn-value-wrap">
          <span class="fn-value">${fmtN(e.valor)}</span>
          ${money}
        </div>
      `;
    const outsideHtml = isNarrow
      ? `
        <div class="fn-outside">
          <span class="fn-name fn-name-outside">${e.etapa}</span>
          <span class="fn-value fn-value-outside">${fmtN(e.valor)}</span>
          ${money ? `<span class="fn-money fn-money-outside">${fmtR$2(e.faturamento)}</span>` : ''}
        </div>
      `
      : '';

    html += `
      <div class="fn-stage-wrap" style="--fn-w: ${width};">
        <div class="fn-stage ${isNarrow ? 'narrow' : ''}" style="--fn-w: ${width}; --fn-color: ${color};">
          ${innerHtml}
        </div>
        ${outsideHtml}
      </div>
    `;

    // Conector entre etapas (com % de conversão)
    if (i < funil.etapas.length - 1) {
      const nextConv = funil.etapas[i+1].conversao;
      if (nextConv != null) {
        const nextColor = palette[i] || color;
        html += `
          <div class="fn-conn" style="--fn-from: ${nextColor};">
            <span class="fn-pct">${fmtPct(nextConv)}</span>
          </div>
        `;
      }
      // se não há conversão (etapa zero ou nula) o gap do funnel-vert já cuida do espaço
    }
  });

  container.innerHTML = html;
}

// ============================================================
// GRÁFICOS — Tema custom Atlas
// ============================================================
let chartSerie = null, chartFontes = null;

function chartTheme() {
  return {
    text: cssVar('--text-muted'),
    soft: cssVar('--text-soft'),
    grid: cssVar('--chart-grid'),
    brand: cssVar('--chart-1'),
    accent: cssVar('--chart-2'),
    sand: cssVar('--chart-3'),
    surface: cssVar('--surface'),
    border: cssVar('--border'),
  };
}

function chartCommonOpts(theme) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 600, easing: 'easeOutCubic' },
    plugins: {
      legend: {
        position: 'bottom', align: 'start',
        labels: {
          color: theme.text,
          font: { family: 'JetBrains Mono, monospace', size: 12, weight: 500 },
          boxWidth: 9, boxHeight: 9, padding: 14, usePointStyle: true, pointStyle: 'rectRounded',
        },
      },
      tooltip: {
        backgroundColor: cssVar('--ink-900'),
        titleColor: cssVar('--paper'),
        bodyColor: cssVar('--paper'),
        titleFont: { family: 'JetBrains Mono, monospace', size: 12, weight: 600 },
        bodyFont: { family: 'JetBrains Mono, monospace', size: 13, weight: 500 },
        padding: 12, borderWidth: 0, cornerRadius: 6, displayColors: true, usePointStyle: true,
        boxPadding: 6,
      },
    },
  };
}

function renderSerieTemporal() {
  const tab = STATE.data[STATE.tab];
  let meses = tab.mensal;
  // Estratégia: gráfico de tendência precisa de contexto histórico — ignora o filtro
  // específico de MÊS (mostraria 1 barra só) mas respeita o filtro de ANO.
  // Se ano específico: mostra esse ano inteiro. Se ano=all: últimos 12 meses.
  if (STATE.filtro.ano !== 'all') {
    meses = meses.filter(m => String(m.ano) === String(STATE.filtro.ano));
  } else {
    meses = meses.slice(-12);                      // últimos 12 meses como janela móvel
  }
  // OBS: não aplicamos filtro de mes/dia aqui (gráfico precisa de série, não ponto único)

  const ctx = document.getElementById('chartSerie').getContext('2d');
  if (chartSerie) chartSerie.destroy();

  const theme = chartTheme();
  const isFundo = STATE.tab === 'fundo';
  const colorVol = isFundo ? theme.brand : theme.accent;
  const colorVolSoft = colorVol + '88';
  const colorCusto = theme.sand;

  // Tema customizado para "Volume vs. Investimento" — meses +3pt, valores +2pt
  const commonSerie = chartCommonOpts(theme);
  commonSerie.plugins.legend.labels.font = { family: 'JetBrains Mono, monospace', size: 14, weight: 500 };
  commonSerie.plugins.tooltip.titleFont = { family: 'JetBrains Mono, monospace', size: 13, weight: 600 };
  commonSerie.plugins.tooltip.bodyFont  = { family: 'JetBrains Mono, monospace', size: 14, weight: 500 };

  chartSerie = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: meses.map(m => {
        const [y, mm] = m.periodo.split('-');
        return `${MESES_NOMES[+mm-1]}/${y.slice(-2)}`;
      }),
      datasets: [
        { label: 'Leads', data: meses.map(m => m.leads), backgroundColor: colorVolSoft, borderRadius: 4, yAxisID: 'y', barPercentage: 0.6 },
        { label: 'MQLs',  data: meses.map(m => m.mqls),  backgroundColor: colorVol,     borderRadius: 4, yAxisID: 'y', barPercentage: 0.6 },
        { label: 'Custo', data: meses.map(m => m.custo), type: 'line',
          borderColor: colorCusto, backgroundColor: colorCusto + '22',
          borderWidth: 2, tension: 0.35, fill: false, yAxisID: 'y1',
          pointRadius: 3, pointBackgroundColor: colorCusto, pointHoverRadius: 5 },
      ],
    },
    options: {
      ...commonSerie,
      plugins: {
        ...commonSerie.plugins,
        tooltip: {
          ...commonSerie.plugins.tooltip,
          callbacks: {
            label: (c) => c.dataset.label === 'Custo'
              ? '  ' + c.dataset.label + '  ' + fmtR$2(c.parsed.y)
              : '  ' + c.dataset.label + '  ' + fmtN(c.parsed.y),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false }, border: { display: false },
          ticks: { color: theme.text, font: { family: 'JetBrains Mono, monospace', size: 14, weight: 600 } },
        },
        y: {
          position: 'left', beginAtZero: true,
          grid: { color: theme.grid, drawTicks: false }, border: { display: false },
          ticks: { color: theme.text, font: { family: 'JetBrains Mono, monospace', size: 13, weight: 500 }, callback: v => v.toLocaleString('pt-BR') },
        },
        y1: {
          position: 'right', beginAtZero: true,
          grid: { display: false }, border: { display: false },
          ticks: { color: theme.text, font: { family: 'JetBrains Mono, monospace', size: 13, weight: 500 }, callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') },
        },
      },
    },
  });

  document.getElementById('chartSerieTitle').textContent = STATE.selecao
    ? 'Período (global · não filtrado)'
    : 'Volume vs. Investimento';
}

function renderFontes() {
  const tab = STATE.data[STATE.tab];
  let fontes;

  if (STATE.selecao && STATE.selecao.tipo === 'campanha' && STATE.selecao.dados) {
    fontes = STATE.selecao.dados.fontes.map(f => ({ label: f.fonte, leads: f.leads, mqls: f.mqls }));
    document.getElementById('chartFontesTitle').textContent = 'Fontes desta campanha';
  } else if (STATE.selecao && STATE.selecao.tipo === 'curso') {
    const acc = {};
    (tab.todas_campanhas || []).filter(c => (c.cursos || []).includes(STATE.selecao.valor)).forEach(c => {
      (c.fontes || []).forEach(f => {
        if (!acc[f.fonte]) acc[f.fonte] = { label: f.fonte, leads: 0, mqls: 0 };
        acc[f.fonte].leads += f.leads;
        acc[f.fonte].mqls += f.mqls;
      });
    });
    fontes = Object.values(acc).sort((a, b) => b.leads - a.leads);
    document.getElementById('chartFontesTitle').textContent = `Fontes · "${STATE.selecao.valor}"`;
  } else if (STATE.tipoCurso !== 'all') {
    // Filtro de tipo ativo — agrega fontes apenas das campanhas que tem cursos do tipo
    const acc = {};
    (tab.todas_campanhas || []).filter(c => (c.cursos || []).some(cu => cursoMatchTipo(cu, STATE.tipoCurso))).forEach(c => {
      (c.fontes || []).forEach(f => {
        if (!acc[f.fonte]) acc[f.fonte] = { label: f.fonte, leads: 0, mqls: 0 };
        acc[f.fonte].leads += f.leads;
        acc[f.fonte].mqls += f.mqls;
      });
    });
    fontes = Object.values(acc).sort((a, b) => b.leads - a.leads).slice(0, 10);
    const labelTipo = { mba: 'MBA', pos: 'Pós', imersoes: 'Imersões' }[STATE.tipoCurso] || STATE.tipoCurso;
    document.getElementById('chartFontesTitle').textContent = `Fontes · ${labelTipo}`;
  } else {
    fontes = tab.distribuicoes.por_fonte;
    document.getElementById('chartFontesTitle').textContent = 'Por Fonte';
  }

  const ctx = document.getElementById('chartFontes').getContext('2d');
  if (chartFontes) chartFontes.destroy();

  const theme = chartTheme();
  const isFundo = STATE.tab === 'fundo';
  const c1 = isFundo ? theme.brand : theme.accent;

  // Tema customizado para "Por Fonte" — fontes maiores (+3pt vs padrão)
  const commonFontes = chartCommonOpts(theme);
  commonFontes.plugins.legend.labels.font = { family: 'JetBrains Mono, monospace', size: 14, weight: 500 };
  commonFontes.plugins.tooltip.titleFont = { family: 'JetBrains Mono, monospace', size: 13, weight: 600 };
  commonFontes.plugins.tooltip.bodyFont  = { family: 'JetBrains Mono, monospace', size: 14, weight: 500 };

  // Abrevia labels longos para não cortar no eixo Y (ex: "Mecanismo de Busca" -> "Mec. Busca")
  const abreviaFonte = (s) => {
    const txt = String(s || '');
    if (txt.length <= 14) return txt;
    return txt
      .replace(/Mecanismo de Busca/i, 'Mec. Busca')
      .replace(/Desconhecido/i, 'Desconhec.')
      .replace(/Whatsapp/i, 'WhatsApp');
  };

  chartFontes = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: fontes.map(x => abreviaFonte(x.label)),
      datasets: [
        { label: 'Leads', data: fontes.map(x => x.leads), backgroundColor: c1 + '55', borderRadius: 4, barPercentage: 0.7 },
        { label: 'MQLs',  data: fontes.map(x => x.mqls),  backgroundColor: c1,        borderRadius: 4, barPercentage: 0.7 },
      ],
    },
    options: {
      indexAxis: 'y', ...commonFontes,
      plugins: {
        ...commonFontes.plugins,
        tooltip: {
          ...commonFontes.plugins.tooltip,
          callbacks: { label: (c) => '  ' + c.dataset.label + '  ' + fmtN(c.parsed.x) },
        },
      },
      scales: {
        x: {
          beginAtZero: true, grid: { color: theme.grid, drawTicks: false }, border: { display: false },
          ticks: { color: theme.text, font: { family: 'JetBrains Mono, monospace', size: 13, weight: 500 }, callback: v => v.toLocaleString('pt-BR') },
        },
        y: {
          grid: { display: false }, border: { display: false },
          ticks: { color: theme.text, font: { family: 'JetBrains Mono, monospace', size: 13, weight: 500 } },
        },
      },
    },
  });
}

// ============================================================
// RANKING
// ============================================================
// Calcula Top 5 / Bottom 5 dinamicamente respeitando filtro de data
function calcRankingFiltrado() {
  const tab = STATE.data[STATE.tab];
  const { ano, mes, dia } = STATE.filtro;

  // Sem filtro temporal → ranking pré-calculado do JSON
  if (ano === 'all' && mes === 'all' && dia === 'all') {
    return tab.ranking_criativos;
  }

  // Filtra campanhas_mensal pelos meses no recorte
  let meses = tab.campanhas_mensal || [];
  if (ano !== 'all') meses = meses.filter(m => String(m.ano) === String(ano));
  if (mes !== 'all') meses = meses.filter(m => String(m.mes) === String(mes));
  if (!meses.length) return { top5: [], bottom5: [], total_campanhas_avaliadas: 0 };

  // Agrega campanhas
  const acc = {};
  meses.forEach(mObj => {
    (mObj.campanhas || []).forEach(c => {
      if (!acc[c.campanha]) acc[c.campanha] = { campanha: c.campanha, leads: 0, mqls: 0, custo: 0 };
      acc[c.campanha].leads += c.leads;
      acc[c.campanha].mqls  += c.mqls;
      acc[c.campanha].custo += c.custo;
    });
  });

  // %MQL + filtro mínimo (mesma lógica do pipeline)
  let camps = Object.values(acc).map(c => ({
    ...c,
    pct_mql: c.leads ? Number(((c.mqls / c.leads) * 100).toFixed(1)) : 0,
  }));
  const MIN_LEADS = 100;
  if (STATE.tab === 'topo') {
    camps = camps.filter(c => c.leads >= MIN_LEADS);
  } else {
    camps = camps.filter(c => c.leads >= MIN_LEADS && c.custo >= 1);
  }

  // Anexa fontes/criativos da Galeria (sem filtro temporal — limitação aceita)
  const todas = tab.todas_campanhas || [];
  const enrich = (c) => {
    const full = todas.find(x => x.campanha === c.campanha);
    return { ...c, fontes: full ? full.fontes : [] };
  };

  const top = [...camps].sort((a, b) => b.pct_mql - a.pct_mql || b.leads - a.leads).slice(0, 5);
  const bot = [...camps].sort((a, b) => a.pct_mql - b.pct_mql || b.custo - a.custo).slice(0, 5);

  return {
    top5: top.map((c, i) => ({ ...enrich(c), posicao: i + 1 })),
    bottom5: bot.map((c, i) => ({ ...enrich(c), posicao: i + 1 })),
    total_campanhas_avaliadas: camps.length,
  };
}

function renderRanking() {
  const r = calcRankingFiltrado();
  const q = normalize(STATE.busca.ranking);
  const wrap = document.getElementById('rankingWrap');
  const tipo = STATE.tipoCurso;

  // Quando filtro de tipo está ativo, só passa items cujos cursos batem
  const matchTipo = (it) => {
    if (tipo === 'all') return true;
    const camp = findCampanhaCompleta(it.campanha);
    if (!camp) return false;
    return (camp.cursos || []).some(cu => cursoMatchTipo(cu, tipo));
  };

  const matchItem = (it) => matchTipo(it) && (!q || normalize(it.campanha).includes(q) ||
    (it.fontes || []).some(f => normalize(f.fonte).includes(q) ||
      (f.criativos || []).some(c => normalize(c.criativo).includes(q))));

  const buildItem = (it, posMode) => {
    const isWorst = posMode === 'worst';
    const medalClass = isWorst
      ? (it.posicao === 1 ? 'worst1' : '')
      : (it.posicao === 1 ? 'medal-1' : it.posicao === 2 ? 'medal-2' : it.posicao === 3 ? 'medal-3' : '');
    const medalChar = String(it.posicao).padStart(2,'0');
    const alertClass = isWorst && it.custo > 1000 ? ' alert' : '';
    // Aberto se: campanha selecionada OU criativo selecionado pertence a esta campanha
    const isCampanhaSelected = STATE.selecao && STATE.selecao.tipo === 'campanha' && STATE.selecao.valor === it.campanha;
    const hasCriativoSelected = STATE.selecao && STATE.selecao.tipo === 'criativo' && STATE.selecao.campanha === it.campanha;
    const isSelected = isCampanhaSelected || hasCriativoSelected;
    const barWidth = Math.min(100, it.pct_mql).toFixed(1);

    const fontesHtml = (it.fontes || []).map(f => {
      const fClass = classifyFonte(f.fonte);
      const criativosHtml = (f.criativos || []).map(c => {
        const isThisCriativo = STATE.selecao && STATE.selecao.tipo === 'criativo'
          && STATE.selecao.valor === c.criativo
          && STATE.selecao.campanha === it.campanha;
        return `
        <div class="criativo-row${isThisCriativo ? ' selected' : ''}" data-creative="${escapeHtml(c.criativo)}" data-campanha="${escapeHtml(it.campanha)}">
          <span class="creative-name">${escapeHtml(c.criativo)}</span>
          <span>${fmtN(c.leads)} Leads · ${fmtN(c.mqls)} MQLs</span>
          <span class="drill-mini-pct ${c.pct_mql >= 50 ? 'up' : 'down'}">${fmtPct(c.pct_mql)}</span>
        </div>
        `;
      }).join('') || '<div class="text-soft" style="padding: 6px 10px; font-size: 0.74rem;">— sem criativos identificados —</div>';
      return `
        <div>
          <div class="drill-fonte">
            ${sourceWithLogo(f.fonte, fClass)}
            <span class="text-muted">${fmtN(f.leads)} Leads · ${fmtN(f.mqls)} MQLs · ${fmtR$2(f.custo)}</span>
            <span class="drill-mini-pct ${f.pct_mql >= 50 ? 'up' : 'down'}" style="margin-left: auto;">${fmtPct(f.pct_mql)}</span>
          </div>
          <div class="drill-criativos">${criativosHtml}</div>
        </div>
      `;
    }).join('') || '<div class="text-soft" style="padding: 6px 10px; font-size: 0.74rem;">— sem detalhamento —</div>';

    return `
      <div class="rank-item ${isWorst ? 'worst' : 'best'}${alertClass}${isSelected ? ' open' : ''}" data-campanha="${escapeHtml(it.campanha)}">
        <div class="rank-row">
          <div class="rank-position ${medalClass}">${medalChar}</div>
          <div class="rank-info">
            <div class="rank-name" title="${escapeHtml(it.campanha)}">${escapeHtml(it.campanha)}</div>
            <div class="rank-bar"><span style="width: ${barWidth}%;"></span></div>
            <div class="rank-metrics">
              <span><b>${fmtN(it.leads)}</b> leads</span>
              <span><b>${fmtN(it.mqls)}</b> MQLs</span>
              <span>${fmtR$2(it.custo)}</span>
              ${isWorst && it.custo > 1000 ? `<span class="alert-tag">Alto custo · baixa perf</span>` : ''}
            </div>
          </div>
          <div class="rank-pct">${fmtPct(it.pct_mql)}</div>
          <div class="rank-toggle"></div>
        </div>
        <div class="drilldown">${fontesHtml}</div>
      </div>
    `;
  };

  const topItems = r.top5.filter(matchItem);
  const botItems = r.bottom5.filter(matchItem);
  const topHtml = topItems.map(it => buildItem(it, 'best')).join('') || '<div class="empty">Sem resultados.</div>';
  const botHtml = botItems.map(it => buildItem(it, 'worst')).join('') || '<div class="empty">Sem resultados.</div>';

  wrap.innerHTML = `
    <div>
      <div class="rank-head best">
        <span class="rh-tag">★ TOP 05</span>
        <h3>Maior conversão</h3>
      </div>
      ${topHtml}
    </div>
    <div>
      <div class="rank-head worst">
        <span class="rh-tag">⚠ BOTTOM 05</span>
        <h3>Menor conversão</h3>
      </div>
      ${botHtml}
    </div>
  `;

  wrap.querySelectorAll('.rank-item').forEach(item => {
    const camp = item.dataset.campanha;
    item.querySelector('.rank-row').addEventListener('click', (e) => {
      if (e.target.closest('.rank-name')) return;
      e.stopPropagation();
      item.classList.toggle('open');
    });
    item.querySelector('.rank-name').addEventListener('click', (e) => {
      e.stopPropagation();
      const dados = findCampanhaCompleta(camp);
      if (dados) selecionar('campanha', camp, { dados });
    });
    item.querySelectorAll('.criativo-row').forEach(cr => {
      cr.addEventListener('click', (e) => {
        e.stopPropagation();
        const dados = findCriativo(cr.dataset.campanha, cr.dataset.creative);
        if (dados) selecionar('criativo', cr.dataset.creative, { campanha: cr.dataset.campanha, dados });
      });
    });
  });
}

function findCampanhaCompleta(c) { return (STATE.data[STATE.tab].todas_campanhas || []).find(x => x.campanha === c); }
function findCriativo(camp, cr) {
  const c = findCampanhaCompleta(camp); if (!c) return null;
  for (const f of c.fontes) {
    const found = (f.criativos || []).find(x => x.criativo === cr);
    if (found) return { ...found, fonte: f.fonte };
  }
  return null;
}

// ============================================================
// TABELA HIERÁRQUICA — Curso → Campanha → Canal → Criativo
// ============================================================
const TABLE_STATE = {
  abertos: { curso: new Set(), campanha: new Set(), canal: new Set() },
};

function renderTabelaHierarquica() {
  const tab = STATE.data[STATE.tab];
  let cursosBase = (tab.por_curso_real || []).slice().sort((a, b) => b.leads - a.leads);
  // Filtro por tipo de curso
  if (STATE.tipoCurso !== 'all') {
    cursosBase = cursosBase.filter(c => cursoMatchTipo(c.curso, STATE.tipoCurso));
  }
  const q = normalize(STATE.busca.tabela);

  // Se há seleção de criativo, expandir automaticamente o caminho (Curso → Campanha → Canal)
  if (STATE.selecao && STATE.selecao.tipo === 'criativo') {
    const camp = findCampanhaCompleta(STATE.selecao.campanha);
    if (camp) {
      // Acha o curso real (procura nas próprias campanhas)
      (camp.cursos || []).forEach(cu => TABLE_STATE.abertos.curso.add(cu));
      TABLE_STATE.abertos.campanha.add(camp.campanha);
      // Acha qual fonte tem esse criativo
      const f = (camp.fontes || []).find(fo => (fo.criativos || []).some(c => c.criativo === STATE.selecao.valor));
      if (f) TABLE_STATE.abertos.canal.add(`${camp.campanha}::${f.fonte}`);
    }
  } else if (STATE.selecao && STATE.selecao.tipo === 'campanha') {
    const camp = findCampanhaCompleta(STATE.selecao.valor);
    if (camp) {
      (camp.cursos || []).forEach(cu => TABLE_STATE.abertos.curso.add(cu));
      TABLE_STATE.abertos.campanha.add(camp.campanha);
    }
  } else if (STATE.selecao && STATE.selecao.tipo === 'curso') {
    TABLE_STATE.abertos.curso.add(STATE.selecao.valor);
  }

  // Match: o filtro testa em qualquer nível (curso, campanha, canal, criativo)
  const matchCurso = (curso) => {
    if (!q) return true;
    if (normalize(curso.curso).includes(q)) return true;
    // Procura nas campanhas que tem esse curso
    return campanhasDoCurso(curso.curso).some(c =>
      normalize(c.campanha).includes(q) ||
      (c.fontes || []).some(f => normalize(f.fonte).includes(q) ||
        (f.criativos || []).some(cr => normalize(cr.criativo).includes(q)))
    );
  };

  const cursos = cursosBase.filter(matchCurso);

  const headerHtml = `
    <div class="hier-header">
      <span></span>
      <span>Curso · Campanha · Canal · Criativo</span>
      <span class="hh-num">Leads</span>
      <span class="hh-num">MQLs</span>
      <span class="hh-num">% MQL</span>
      <span class="hh-num col-custo">Custo</span>
    </div>
  `;

  let body = '';

  if (!cursos.length) {
    body = '<div class="hier-empty">Sem resultados para essa busca</div>';
  }

  cursos.forEach(c => {
    const cursoOpen = TABLE_STATE.abertos.curso.has(c.curso);
    const pctCls = pctClass(c.pct_mql);
    body += `
      <div class="hier-row level-1 ${cursoOpen ? 'open' : ''}" data-curso="${escapeHtml(c.curso)}" data-action="toggle-curso">
        <span class="hier-expand">▶</span>
        <span class="hier-name" title="${escapeHtml(c.curso)}">${escapeHtml(c.curso)}</span>
        <span class="hier-num">${fmtN(c.leads)}</span>
        <span class="hier-num">${fmtN(c.mqls)}</span>
        <span class="hier-num"><span class="pct-pill ${pctCls}">${fmtPct(c.pct_mql)}</span></span>
        <span class="hier-num col-custo">${fmtR$2(c.custo)}</span>
      </div>
    `;

    if (cursoOpen) {
      const camps = campanhasDoCurso(c.curso);
      if (!camps.length) {
        body += `<div class="hier-row level-2 no-expand"><span class="hier-expand"></span><span class="hier-name" style="opacity: 0.6;">— sem campanhas identificadas —</span><span></span><span></span><span></span><span class="col-custo"></span></div>`;
      } else {
        camps.forEach(camp => {
          const campOpen = TABLE_STATE.abertos.campanha.has(camp.campanha);
          const pcCls = pctClass(camp.pct_mql);
          body += `
            <div class="hier-row level-2 ${campOpen ? 'open' : ''}" data-campanha="${escapeHtml(camp.campanha)}" data-action="toggle-campanha">
              <span class="hier-expand">▶</span>
              <span class="hier-name" title="${escapeHtml(camp.campanha)}">${escapeHtml(camp.campanha)}</span>
              <span class="hier-num">${fmtN(camp.leads)}</span>
              <span class="hier-num">${fmtN(camp.mqls)}</span>
              <span class="hier-num"><span class="pct-pill ${pcCls}">${fmtPct(camp.pct_mql)}</span></span>
              <span class="hier-num col-custo">${fmtR$2(camp.custo)}</span>
            </div>
          `;

          if (campOpen) {
            (camp.fontes || []).forEach(f => {
              const canalKey = `${camp.campanha}::${f.fonte}`;
              const canalOpen = TABLE_STATE.abertos.canal.has(canalKey);
              const fpCls = pctClass(f.pct_mql);
              const fClass = classifyFonte(f.fonte);
              body += `
                <div class="hier-row level-3 ${canalOpen ? 'open' : ''}" data-canal="${escapeHtml(canalKey)}" data-action="toggle-canal">
                  <span class="hier-expand">▶</span>
                  <span class="hier-name">${sourceWithLogo(f.fonte, fClass)}</span>
                  <span class="hier-num">${fmtN(f.leads)}</span>
                  <span class="hier-num">${fmtN(f.mqls)}</span>
                  <span class="hier-num"><span class="pct-pill ${fpCls}">${fmtPct(f.pct_mql)}</span></span>
                  <span class="hier-num col-custo">${fmtR$2(f.custo)}</span>
                </div>
              `;

              if (canalOpen) {
                const cris = f.criativos || [];
                if (!cris.length) {
                  body += `<div class="hier-row level-4 no-expand"><span class="hier-expand"></span><span class="hier-name" style="opacity:0.5;">— sem criativos identificados nas UTMs —</span><span></span><span></span><span></span><span class="col-custo"></span></div>`;
                } else {
                  cris.forEach(cr => {
                    const crCls = pctClass(cr.pct_mql);
                    const isThisCriativo = STATE.selecao
                      && STATE.selecao.tipo === 'criativo'
                      && STATE.selecao.valor === cr.criativo
                      && STATE.selecao.campanha === camp.campanha;
                    body += `
                      <div class="hier-row level-4 no-expand${isThisCriativo ? ' selected' : ''}" data-criativo="${escapeHtml(cr.criativo)}" data-campanha-cri="${escapeHtml(camp.campanha)}" data-action="select-criativo">
                        <span class="hier-expand"></span>
                        <span class="hier-name" title="${escapeHtml(cr.criativo)}">${escapeHtml(cr.criativo)}</span>
                        <span class="hier-num">${fmtN(cr.leads)}</span>
                        <span class="hier-num">${fmtN(cr.mqls)}</span>
                        <span class="hier-num"><span class="pct-pill ${crCls}">${fmtPct(cr.pct_mql)}</span></span>
                        <span class="hier-num col-custo">—</span>
                      </div>
                    `;
                  });
                }
              }
            });
          }
        });
      }
    }
  });

  document.getElementById('hierTable').innerHTML = headerHtml + body;
  document.getElementById('tabelaFooter').textContent =
    `${cursos.length} de ${cursosBase.length} cursos${q ? ` · busca: "${STATE.busca.tabela}"` : ''} · clique para expandir`;

  // Bind handlers
  document.querySelectorAll('.hier-row[data-action]').forEach(row => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = row.dataset.action;
      if (action === 'toggle-curso') {
        const k = row.dataset.curso;
        TABLE_STATE.abertos.curso.has(k) ? TABLE_STATE.abertos.curso.delete(k) : TABLE_STATE.abertos.curso.add(k);
        renderTabelaHierarquica();
      } else if (action === 'toggle-campanha') {
        const k = row.dataset.campanha;
        TABLE_STATE.abertos.campanha.has(k) ? TABLE_STATE.abertos.campanha.delete(k) : TABLE_STATE.abertos.campanha.add(k);
        renderTabelaHierarquica();
      } else if (action === 'toggle-canal') {
        const k = row.dataset.canal;
        TABLE_STATE.abertos.canal.has(k) ? TABLE_STATE.abertos.canal.delete(k) : TABLE_STATE.abertos.canal.add(k);
        renderTabelaHierarquica();
      } else if (action === 'select-criativo') {
        // Cross-filter por criativo — mantém o drilldown aberto
        const camp = row.dataset.campanhaCri;
        const cri = row.dataset.criativo;
        const dados = findCriativo(camp, cri);
        if (dados) selecionar('criativo', cri, { campanha: camp, dados });
      }
    });
  });
}

function campanhasDoCurso(cursoNome) {
  return (STATE.data[STATE.tab].todas_campanhas || [])
    .filter(c => (c.cursos || []).includes(cursoNome))
    .sort((a, b) => b.leads - a.leads);
}

function renderTabelaCampanhas() {
  const tab = STATE.data[STATE.tab];
  let camps = [...(tab.todas_campanhas || [])];
  const q = normalize(STATE.busca.tabela);

  if (q) {
    camps = camps.filter(c => {
      if (normalize(c.campanha).includes(q)) return true;
      if ((c.cursos || []).some(cu => normalize(cu).includes(q))) return true;
      return (c.fontes || []).some(f => normalize(f.fonte).includes(q) || (f.criativos || []).some(cr => normalize(cr.criativo).includes(q)));
    });
  }

  const { col, dir } = STATE.sortTabela;
  camps.sort((a, b) => {
    const va = a[col], vb = b[col];
    if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === 'asc' ? va - vb : vb - va;
  });

  const tbody = document.getElementById('tabelaCampanhasBody');
  const selCamp = STATE.selecao && STATE.selecao.tipo === 'campanha' ? STATE.selecao.valor : null;
  const selCriativo = STATE.selecao && STATE.selecao.tipo === 'criativo' ? STATE.selecao.valor : null;

  let html = '';
  camps.forEach(c => {
    const isSel = c.campanha === selCamp;
    const dim = STATE.selecao && !isSel && STATE.selecao.tipo === 'campanha' ? ' dimmed' : '';
    const pctCls = pctClass(c.pct_mql);
    const cursosHtml = (c.cursos || []).slice(0, 3).map(cu => `<span title="${escapeHtml(cu)}">· ${escapeHtml(cu)}</span>`).join('') || '<span class="text-soft">—</span>';

    html += `
      <tr class="camp-row${isSel ? ' selected open' : ''}${dim}" data-campanha="${escapeHtml(c.campanha)}">
        <td><div class="expand-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div></td>
        <td><span class="camp-name">${escapeHtml(c.campanha)}</span></td>
        <td class="num">${fmtN(c.leads)}</td>
        <td class="num">${fmtN(c.mqls)}</td>
        <td class="num"><span class="pct-pill ${pctCls}">${fmtPct(c.pct_mql)}</span></td>
        <td class="num">${fmtR$2(c.custo)}</td>
        <td><div class="cursos-mini">${cursosHtml}</div></td>
      </tr>
    `;

    if (isSel) {
      const fontesHtml = (c.fontes || []).map(f => {
        const fClass = classifyFonte(f.fonte);
        const criativosHtml = (f.criativos || []).map(cr => `
          <div class="criativo-row${cr.criativo === selCriativo ? ' selected' : ''}" data-creative="${escapeHtml(cr.criativo)}">
            <span class="creative-tag">${escapeHtml(cr.criativo)}</span>
            <span>${fmtN(cr.leads)}L · ${fmtN(cr.mqls)}M</span>
            <span class="drill-mini-pct ${cr.pct_mql >= 50 ? 'up' : 'down'}" style="margin-left:auto;">${fmtPct(cr.pct_mql)}</span>
          </div>
        `).join('') || '<div class="text-soft" style="padding:6px 10px;font-size:0.74rem;">— sem criativos identificados —</div>';
        return `
          <div>
            <div class="drill-fonte" data-fonte="${escapeHtml(f.fonte)}">
              ${sourceWithLogo(f.fonte, fClass)}
              <span class="text-muted">${fmtN(f.leads)}L · ${fmtN(f.mqls)}M · ${fmtR$2(f.custo)}</span>
              <span class="drill-mini-pct ${f.pct_mql >= 50 ? 'up' : 'down'}" style="margin-left:auto;">${fmtPct(f.pct_mql)}</span>
            </div>
            <div class="drill-criativos">${criativosHtml}</div>
          </div>
        `;
      }).join('') || '<div class="text-soft">— sem detalhamento —</div>';
      html += `<tr class="drill-tr"><td colspan="7"><div class="drill-wrap">${fontesHtml}</div></td></tr>`;
    }
  });

  tbody.innerHTML = html || '<tr><td colspan="7"><div class="empty">Sem resultados.</div></td></tr>';

  document.getElementById('tabelaFooter').textContent =
    `${camps.length} de ${(tab.todas_campanhas || []).length} campanhas${q ? ` · busca: "${STATE.busca.tabela}"` : ''}`;

  tbody.querySelectorAll('.camp-row').forEach(row => {
    const camp = row.dataset.campanha;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.criativo-row')) return;
      if (e.target.closest('.drill-fonte')) return;
      const dados = findCampanhaCompleta(camp);
      if (dados) selecionar('campanha', camp, { dados });
    });
  });
  tbody.querySelectorAll('.criativo-row').forEach(line => {
    line.addEventListener('click', (e) => {
      e.stopPropagation();
      const camp = line.closest('.drill-tr').previousElementSibling.dataset.campanha;
      const nome = line.dataset.creative;
      const dados = findCriativo(camp, nome);
      if (dados) selecionar('criativo', nome, { campanha: camp, dados });
    });
  });

  // Sort
  document.querySelectorAll('#tabelaCampanhas thead th').forEach((th, idx) => {
    const cols = [null, 'campanha', 'leads', 'mqls', 'pct_mql', 'custo', null];
    th.classList.remove('sorted-asc', 'sorted-desc');
    const c = cols[idx];
    if (!c) return;
    if (STATE.sortTabela.col === c) th.classList.add(STATE.sortTabela.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    th.onclick = () => {
      if (STATE.sortTabela.col === c) STATE.sortTabela.dir = STATE.sortTabela.dir === 'asc' ? 'desc' : 'asc';
      else { STATE.sortTabela.col = c; STATE.sortTabela.dir = 'desc'; }
      renderTabelaCampanhas();
    };
  });

  document.getElementById('tabelaTitle').textContent =
    STATE.selecao ? `Galeria de Criativos (${camps.length})` : 'Galeria de Criativos';
}

// ============================================================
// CURSOS
// ============================================================
function renderCursos() {
  let cursos = STATE.data[STATE.tab].distribuicoes.por_curso || [];
  const q = normalize(STATE.busca.cursos);
  if (q) cursos = cursos.filter(c => normalize(c.label).includes(q));
  if (!cursos.length) {
    document.getElementById('cursosList').innerHTML = '<div class="empty">Sem resultados.</div>';
    return;
  }

  const max = Math.max(...cursos.map(c => c.leads));
  const selCurso = STATE.selecao && STATE.selecao.tipo === 'curso' ? STATE.selecao.valor : null;

  const html = cursos.slice(0, 15).map(c => `
    <div class="curso-line${c.label === selCurso ? ' selected' : ''}" data-curso="${escapeHtml(c.label)}">
      <div class="curso-head">
        <span class="curso-name">${c.label.length > 56 ? escapeHtml(c.label.slice(0, 56)) + '…' : escapeHtml(c.label)}</span>
        <span class="curso-stat"><b>${fmtN(c.leads)}</b> · ${fmtPct(c.pct_mql)}</span>
      </div>
      <div class="curso-bar"><span style="width: ${(c.leads / max * 100).toFixed(1)}%;"></span></div>
    </div>
  `).join('');
  document.getElementById('cursosList').innerHTML = html;

  document.querySelectorAll('.curso-line').forEach(el => {
    el.onclick = () => selecionar('curso', el.dataset.curso);
  });
}

// ============================================================
// BUSCA
// ============================================================
function setupBusca() {
  const debounce = (fn, ms = 80) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const elR = document.getElementById('searchRanking');
  const elT = document.getElementById('searchTabela');
  if (elR) elR.addEventListener('input', debounce((e) => { STATE.busca.ranking = e.target.value; renderRanking(); }));
  if (elT) elT.addEventListener('input', debounce((e) => { STATE.busca.tabela = e.target.value; renderTabelaHierarquica(); }));
}

// ============================================================
// EXPORT
// ============================================================
function setupExport() {
  document.getElementById('btnExport').addEventListener('click', () => {
    try {
      const tab = STATE.data[STATE.tab];
      const tabName = STATE.tab === 'topo' ? 'Topo' : 'Fundo';
      const wb = XLSX.utils.book_new();
      const k = calcKpisFiltrados();
      const kpisData = [
        ['Métrica', 'Valor'],
        ['Tab', tabName],
        ['Filtro Ano', STATE.filtro.ano],
        ['Filtro Mês', STATE.filtro.mes],
        ['Filtro Dia', STATE.filtro.dia],
        ['Seleção (cross-filter)', STATE.selecao ? `${STATE.selecao.tipo}: ${STATE.selecao.valor}` : '—'],
        ['Leads', k.leads],
        ['MQLs', k.mqls],
        ['% MQL', k.pct_mql.toFixed(2) + '%'],
        ['Custo (R$)', k.custo],
        ['CPL (R$)', k.cpl.toFixed(2)],
        ['CPMQL (R$)', k.cpmql.toFixed(2)],
      ];
      const fin = STATE.data[STATE.tab].financeiro;
      if (!STATE.selecao) {
        kpisData.push(['Faturamento atribuído (R$)', fin.valor_atribuido]);
        kpisData.push(['Ganhos atribuídos', fin.ganhos_atribuidos]);
        kpisData.push(['ROAS', fin.roas + 'x']);
        kpisData.push(['CPA (R$)', fin.cac]);
        kpisData.push(['Ticket médio (R$)', fin.ticket_medio]);
        kpisData.push(['Modelo de atribuição', fin.modelo_atribuicao]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpisData), 'KPIs');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tab.mensal || []), 'Mensal');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tab.diario || []), 'Diario');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tab.por_curso_real || []), 'Por Curso');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tab.distribuicoes.por_fonte || []), 'Por Fonte');

      const todas = (tab.todas_campanhas || []).map(c => ({
        campanha: c.campanha, leads: c.leads, mqls: c.mqls,
        pct_mql: c.pct_mql, custo: c.custo, cursos: (c.cursos || []).join(' | '),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(todas), 'Todas Campanhas');

      const criativos = [];
      (tab.todas_campanhas || []).forEach(c => {
        (c.fontes || []).forEach(f => {
          (f.criativos || []).forEach(cr => {
            criativos.push({ campanha: c.campanha, fonte: f.fonte, criativo: cr.criativo,
              leads: cr.leads, mqls: cr.mqls, pct_mql: cr.pct_mql });
          });
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(criativos), 'Criativos');

      const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      XLSX.writeFile(wb, `Performance_MKT_${tabName}_${stamp}.xlsx`);
      toast('Exportado com sucesso', 'success');
    } catch (e) {
      console.error(e); toast('Erro ao exportar', 'error');
    }
  });
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
  // Guard: se loadData falhou (sem internet, JSON corrompido), evita cascata de erros
  if (!STATE.data) {
    console.warn('renderAll abortado — STATE.data ausente. Rode "Atualizar HUB MKT.bat".');
    return;
  }
  renderSelectionBanner();
  renderEmptyStateBanner();     // banner topo quando filtro retorna zero
  renderKPIs();
  renderSerieTemporal();
  renderFontes();
  renderFunil();
  renderCanaisPagos();          // canais Meta/Google/LinkedIn ao lado do funil
  renderRanking();
  renderTabelaHierarquica();
  renderHealthWidget();
}

// Detecta filtro vazio (zero leads/mqls/custo) e exibe banner amigável
// para que a diretoria não interprete zeros como "performance morta".
function renderEmptyStateBanner() {
  const id = 'emptyStateBanner';
  let banner = document.getElementById(id);
  const k = calcKpisFiltrados();
  const hasFiltro = STATE.filtro.ano !== 'all' || STATE.filtro.mes !== 'all'
                 || STATE.filtro.dia !== 'all' || STATE.tipoCurso !== 'all';
  const zerado = (!k.leads && !k.mqls && !k.custo);

  let mensagem = null;

  if (!STATE.selecao && hasFiltro && zerado) {
    // Filtro vazio — sem registros para o recorte
    mensagem = '<strong>Sem dados.</strong> Não há registros para este recorte de filtro. Ajuste o período ou o tipo de curso.';
  }
  // (Removido: banner de tipoCurso obsoleto — agora o pipeline preenche Reuniões/Matrículas/ROAS/Faturamento/CPA via por_tipo_mensal.)

  if (mensagem) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = id;
      banner.className = 'warn-banner';
      const sb = document.getElementById('selectionBanner');
      sb.parentNode.insertBefore(banner, sb.nextSibling);
    }
    banner.innerHTML = mensagem;
    banner.classList.remove('hidden');
  } else if (banner) {
    banner.classList.add('hidden');
  }
}

// ============================================================
// CANAIS PAGOS — Meta · Google · LinkedIn (ao lado do funil)
// ============================================================
function renderCanaisPagos() {
  const wrap = document.getElementById('canaisPagos');
  if (!wrap) return;
  if (STATE.selecao || STATE.tipoCurso !== 'all') {
    // Em cross-filter ou tipo, esconde
    wrap.innerHTML = `<div class="canais-head"><h3>Canais Pagos</h3><span class="hint">— ajuste o filtro —</span></div><div class="empty-small">Disponível sem cross-filter ou filtro de tipo</div>`;
    return;
  }

  const tab = STATE.data[STATE.tab];
  const { ano, mes } = STATE.filtro;

  // Decide se usa dados filtrados (mensal) ou globais
  let porFonteAgregado = [];
  if (ano !== 'all' || mes !== 'all') {
    // Filtra por_fonte_mensal e agrega
    let meses = tab.por_fonte_mensal || [];
    if (ano !== 'all') meses = meses.filter(m => String(m.ano) === String(ano));
    if (mes !== 'all') meses = meses.filter(m => String(m.mes) === String(mes));
    const acc = {};
    meses.forEach(m => (m.fontes || []).forEach(f => {
      if (!acc[f.fonte]) acc[f.fonte] = { label: f.fonte, leads: 0, mqls: 0, custo: 0 };
      acc[f.fonte].leads += f.leads;
      acc[f.fonte].mqls  += f.mqls;
      acc[f.fonte].custo += f.custo;
    }));
    porFonteAgregado = Object.values(acc);
  } else {
    // Sem filtro temporal → soma os totais de por_fonte_mensal pra ter consistência
    const acc = {};
    (tab.por_fonte_mensal || []).forEach(m => (m.fontes || []).forEach(f => {
      if (!acc[f.fonte]) acc[f.fonte] = { label: f.fonte, leads: 0, mqls: 0, custo: 0 };
      acc[f.fonte].leads += f.leads;
      acc[f.fonte].mqls  += f.mqls;
      acc[f.fonte].custo += f.custo;
    }));
    porFonteAgregado = Object.values(acc);
  }

  const findFonte = (key) => porFonteAgregado.find(p => p.label.toLowerCase().includes(key));

  const canais = [
    {
      key: 'meta',
      nome: 'Meta Ads',
      logo: 'assets/img/META%20ICON.png',
      raw: findFonte('meta'),
    },
    {
      key: 'google',
      nome: 'Google Ads',
      logo: 'assets/img/GOOGLE%20ADS%20ICON.png',
      raw: findFonte('google'),
    },
    {
      key: 'linkedin',
      nome: 'LinkedIn Ads',
      logo: null,
      raw: findFonte('linkedin'),
    },
  ].map(c => {
    const leads = c.raw ? c.raw.leads : 0;
    const mqls  = c.raw ? c.raw.mqls  : 0;
    const custo = c.raw ? c.raw.custo : 0;
    return {
      ...c,
      leads, mqls, custo,
      pct_mql: leads ? (mqls / leads * 100) : 0,
      cpmql: mqls ? (custo / mqls) : 0,
    };
  });

  // Máximo de leads/custo pra normalizar a barra
  const maxLeads = Math.max(...canais.map(c => c.leads), 1);

  const html = canais.map(c => {
    const pctCls = pctClass(c.pct_mql);
    const barWidth = (c.leads / maxLeads * 100).toFixed(1);
    const logoHtml = c.logo
      ? `<img src="${c.logo}" alt="${c.nome}" />`
      : `<span style="font-family:var(--font-display);font-weight:800;font-size:0.7rem;color:#0A66C2;">in</span>`;
    return `
      <div class="canal-card" data-canal="${c.key}" data-canal-key="${c.key}" data-canal-fonte="${c.raw ? escapeHtml(c.raw.label) : ''}">
        <div class="canal-logo">${logoHtml}</div>
        <div class="canal-body">
          <div class="canal-head-row">
            <span class="canal-nome">${c.nome}</span>
            <span class="canal-pct ${pctCls}">${fmtPct(c.pct_mql)} MQL</span>
          </div>
          <div class="canal-metrics">
            <div class="canal-metric">
              <span class="canal-metric-label">Leads</span>
              <span class="canal-metric-value">${fmtN(c.leads)}</span>
            </div>
            <div class="canal-metric">
              <span class="canal-metric-label">MQLs</span>
              <span class="canal-metric-value">${fmtN(c.mqls)}</span>
            </div>
            <div class="canal-metric">
              <span class="canal-metric-label">Investido</span>
              <span class="canal-metric-value">${fmtR$2(c.custo)}</span>
            </div>
          </div>
          <div class="canal-bar" title="Participação em Leads: ${barWidth}%">
            <span style="width: ${barWidth}%"></span>
          </div>
          <a class="canal-detalhe" tabindex="0">
            Ver campanhas
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </a>
        </div>
      </div>
    `;
  }).join('');
  wrap.innerHTML = html;

  // Card inteiro clicável + link "Ver campanhas"
  wrap.querySelectorAll('.canal-card').forEach(card => {
    card.addEventListener('click', () => {
      openCanalDrawer(card.dataset.canalKey, card.dataset.canalFonte);
    });
  });
}

// ============================================================
// DRAWER lateral — Campanhas detalhadas do canal
// ============================================================
const CANAL_DRAWER_STATE = { canalKey: null, fonteNome: null, busca: '' };

const CANAL_LOGOS_MAP = {
  meta:     '<img src="assets/img/META%20ICON.png" alt="Meta" />',
  google:   '<img src="assets/img/GOOGLE%20ADS%20ICON.png" alt="Google Ads" />',
  linkedin: '<span style="font-family:var(--font-display);font-weight:800;font-size:0.95rem;color:#0A66C2;">in</span>',
};
const CANAL_NOMES_MAP = { meta: 'Meta Ads', google: 'Google Ads', linkedin: 'LinkedIn Ads' };

function openCanalDrawer(canalKey, fonteNome) {
  CANAL_DRAWER_STATE.canalKey = canalKey;
  CANAL_DRAWER_STATE.fonteNome = fonteNome;
  CANAL_DRAWER_STATE.busca = '';
  document.getElementById('cdSearch').value = '';

  const drawer = document.getElementById('canalDrawer');
  drawer.classList.remove('hidden');
  renderCanalDrawer();
  // dispara animação no próximo frame
  requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add('open')));
  document.body.style.overflow = 'hidden';
}

function closeCanalDrawer() {
  const drawer = document.getElementById('canalDrawer');
  drawer.classList.remove('open');
  document.body.style.overflow = '';
  // hidden é setado pelo CSS transition (visibility tem delay)
}

function renderCanalDrawer() {
  const { canalKey, fonteNome, busca } = CANAL_DRAWER_STATE;
  if (!canalKey) return;

  document.getElementById('cdLogo').innerHTML = CANAL_LOGOS_MAP[canalKey] || '';
  document.getElementById('cdNome').textContent = CANAL_NOMES_MAP[canalKey] || canalKey;

  const tab = STATE.data[STATE.tab];
  const { ano, mes } = STATE.filtro;

  // Coleta campanhas do canal RESPEITANDO filtro de data via campanhas_por_fonte_mensal
  let meses = tab.campanhas_por_fonte_mensal || [];
  if (ano !== 'all') meses = meses.filter(m => String(m.ano) === String(ano));
  if (mes !== 'all') meses = meses.filter(m => String(m.mes) === String(mes));

  // Agrega por nome de campanha
  const acc = {};
  meses.forEach(mObj => {
    const campsDaFonte = (mObj.por_fonte || {})[fonteNome] || [];
    campsDaFonte.forEach(c => {
      if (!acc[c.campanha]) acc[c.campanha] = { campanha: c.campanha, leads: 0, mqls: 0, custo: 0 };
      acc[c.campanha].leads += c.leads;
      acc[c.campanha].mqls  += c.mqls;
      acc[c.campanha].custo += c.custo;
    });
  });
  const campanhas = Object.values(acc).map(c => ({
    ...c,
    pct_mql: c.leads ? (c.mqls / c.leads * 100) : 0,
  }));

  // Busca
  const q = normalize(busca);
  const filtradas = q
    ? campanhas.filter(c => normalize(c.campanha).includes(q))
    : campanhas;

  // Ordenação por investimento desc
  filtradas.sort((a, b) => b.custo - a.custo);

  // Totais (do conjunto filtrado)
  const totalLeads = filtradas.reduce((s, c) => s + c.leads, 0);
  const totalMqls  = filtradas.reduce((s, c) => s + c.mqls, 0);
  const totalCusto = filtradas.reduce((s, c) => s + c.custo, 0);
  const totalPct = totalLeads ? (totalMqls / totalLeads * 100) : 0;

  document.getElementById('cdSummary').innerHTML = `
    <div class="cd-summary-cell">
      <span class="cd-summary-label">Campanhas</span>
      <span class="cd-summary-value">${fmtN(filtradas.length)}</span>
    </div>
    <div class="cd-summary-cell">
      <span class="cd-summary-label">% MQL médio</span>
      <span class="cd-summary-value">${fmtPct(totalPct)}</span>
    </div>
    <div class="cd-summary-cell">
      <span class="cd-summary-label">Investimento total</span>
      <span class="cd-summary-value">${fmtR$2(totalCusto)}</span>
    </div>
  `;

  const list = document.getElementById('cdList');
  if (!filtradas.length) {
    list.innerHTML = `<div style="padding: 32px; text-align: center; color: var(--text-soft); font-family: var(--font-display); font-size: 0.84rem;">Nenhuma campanha encontrada</div>`;
  } else {
    list.innerHTML = filtradas.map(c => {
      const pctCls = pctClass(c.pct_mql);
      return `
        <div class="cd-row">
          <span class="cd-camp" title="${escapeHtml(c.campanha)}">${escapeHtml(c.campanha)}</span>
          <span class="num">${fmtN(c.leads)}</span>
          <span class="num cd-mqls">${fmtN(c.mqls)}</span>
          <span class="num"><span class="pct-pill ${pctCls}">${fmtPct(c.pct_mql)}</span></span>
          <span class="num">${fmtR$2(c.custo)}</span>
        </div>
      `;
    }).join('');
  }

  // Texto do filtro ativo
  let filtroTxt = 'período completo';
  if (ano !== 'all' && mes !== 'all')        filtroTxt = `${MESES_NOMES[parseInt(mes,10)-1]}/${ano}`;
  else if (ano !== 'all')                    filtroTxt = `${ano}`;
  else if (mes !== 'all')                    filtroTxt = `${MESES_NOMES[parseInt(mes,10)-1]} (todos anos)`;
  document.getElementById('cdFoot').textContent =
    `${filtradas.length} campanha(s) · ${filtroTxt} · ordem: investimento ↓`;
}

function setupCanalDrawer() {
  const drawer = document.getElementById('canalDrawer');
  if (!drawer) return;
  // Fechar
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeCanalDrawer();
  });
  // ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeCanalDrawer();
  });
  // Busca
  document.getElementById('cdSearch').addEventListener('input', (e) => {
    CANAL_DRAWER_STATE.busca = e.target.value;
    renderCanalDrawer();
  });
}

// ============================================================
// INIT
// ============================================================
(async function init() {
  setupTheme();
  const ok = await loadData();
  if (!ok) return;
  renderHeader();
  renderTabs();
  setupFiltros();
  setupBusca();
  setupExport();
  setupCanalDrawer();
  renderAll();
})();
