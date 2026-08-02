// ===== ESTADO =====
let DATA = { turno:[], grupos:[], horario:[], atendente:[], produtos:[], comandas:[], notas:[], importLog:[] };
let SORT = {
  turno:{col:'data',dir:-1}, produtos:{col:'faturado',dir:-1}, atendente:{col:'r_total',dir:-1}
};
let FILTER_TURNO_TIPO = '';

// ===== FETCH =====
async function fetchAll(table, limit=10000) {
  if (window.DEV_MODE) return (window.MOCK_DATA && window.MOCK_DATA[table]) || [];
  const r = await fetch(`/api/${table}?limit=${limit}`, { headers: window.authHeaders ? window.authHeaders() : {} });
  if (r.status === 401) { if (window.onAuthExpired) window.onAuthExpired(); return []; }
  return r.json();
}

// ===== HELPERS DE DATA/FORMATO =====
const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function currentMonthYM() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function currentMonthLabel() { const d = new Date(); return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`; }
function previousMonthLabel() {
  const d = new Date(); d.setMonth(d.getMonth()-1);
  return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}
// "Jun/26" -> "Mai/26" — mês anterior a um período específico (não ao mês atual real),
// pra comparação funcionar mesmo quando o usuário seleciona um mês passado.
function previousLabelOf(label) {
  const [mes, ano] = label.split('/');
  let mi = MESES_ABREV.indexOf(mes) - 1;
  let anoNum = 2000 + parseInt(ano, 10);
  if (mi < 0) { mi = 11; anoNum -= 1; }
  return `${MESES_ABREV[mi]}/${String(anoNum).slice(2)}`;
}
function fmtBRL(v) { return v != null ? 'R$ ' + Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; }
function fmtBRLh(v) { return `<span class="hide-val">${fmtBRL(v)}</span>`; }
function fmtNum(v) { return v != null ? Number(v).toLocaleString('pt-BR') : '—'; }
function fmtPct(v) { return v != null ? Number(v).toFixed(1)+'%' : '—'; }
function fmtDate(v) { return v ? new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'; }

// ===== NAVEGAÇÃO =====
function showPage(page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page===page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
}

// ===== OCULTAR VALORES =====
let valuesHidden = false;
function toggleValues() {
  valuesHidden = !valuesHidden;
  document.body.classList.toggle('values-hidden', valuesHidden);
  document.getElementById('hideBtn').textContent = valuesHidden ? '👁 Mostrar valores' : '👁 Ocultar valores';
}

// ===== TABELAS: ORDENAÇÃO GENÉRICA =====
function getSorted(tab, rows) {
  const s = SORT[tab]; if (!s) return rows;
  return [...rows].sort((a,b) => {
    const va=a[s.col], vb=b[s.col];
    if (va==null) return 1; if (vb==null) return -1;
    if (typeof va==='string') return s.dir*va.localeCompare(vb,'pt');
    return s.dir*(Number(va)-Number(vb));
  });
}
function updateSortIcons(tab) {
  document.querySelectorAll(`#page-${tabToPage(tab)} thead th`).forEach(th => {
    const col = th.dataset.col; if (!col) return;
    th.classList.toggle('sorted', col===SORT[tab]?.col);
    const icon = th.querySelector('.sort-icon');
    if (icon) icon.textContent = col===SORT[tab]?.col ? (SORT[tab].dir===1?' ↑':' ↓') : ' ↕';
  });
}
function tabToPage(tab) {
  return { turno:'operacao', produtos:'produtos', atendente:'equipe' }[tab] || tab;
}
function sortTable(tab, col) {
  SORT[tab].dir = SORT[tab].col===col ? SORT[tab].dir*-1 : -1;
  SORT[tab].col = col;
  if (tab==='turno') renderOperacao();
  if (tab==='produtos') renderProdutos();
  if (tab==='atendente') renderEquipe();
}

// ===== FILTROS DE PERÍODO (selects) =====
function sortLabels(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => {
    const [ma,ya]=a.split('/'); const [mb,yb]=b.split('/');
    return (Number(yb)-Number(ya)) || (MESES_ABREV.indexOf(mb)-MESES_ABREV.indexOf(ma));
  });
}
function populatePeriods(selId, values) {
  const sel = document.getElementById(selId);
  const cur = sel.value;
  const uniq = sortLabels(values);
  sel.innerHTML = '<option value="">Todos os meses</option>' + uniq.map(p => `<option value="${p}"${p===cur?' selected':''}>${p}</option>`).join('');
}
function selectCurrentMonth(selId, value) {
  const sel = document.getElementById(selId);
  if (sel && [...sel.options].some(o => o.value===value)) sel.value = value;
}

// ===== NOTAS =====
function getNotas(contexto, periodo) {
  return DATA.notas.filter(n => n.contexto===contexto && (n.periodo===periodo || n.periodo==='geral') && n.ativo);
}
function renderNotas(elId, contexto, periodo) {
  const notas = getNotas(contexto, periodo);
  const icons = {destaque:'✨', alerta:'⚠️', aviso:'📌', observacao:'💬'};
  document.getElementById(elId).innerHTML = notas.map(n => `
    <div class="nota ${n.tag}"><span>${icons[n.tag]||'💬'}</span><span class="nota-texto">${n.texto}</span></div>
  `).join('');
}

// ===== VISÃO GERAL =====
function labelToYM(label) {
  const [mes, ano] = label.split('/');
  const mi = MESES_ABREV.indexOf(mes);
  if (mi < 0) return null;
  return `${2000+parseInt(ano,10)}-${String(mi+1).padStart(2,'0')}`;
}
function renderGeral() {
  const curLabel = document.getElementById('sel-geral').value || currentMonthLabel();
  const prevLabel = previousLabelOf(curLabel);
  const comandasMes = DATA.comandas.filter(d => d.periodo===curLabel);
  const comandasPrev = DATA.comandas.filter(d => d.periodo===prevLabel);

  const hoje = new Date();
  const isMesAtual = curLabel === currentMonthLabel();
  document.getElementById('geralFatLbl').textContent = isMesAtual
    ? `FATURAMENTO · ${MESES_ABREV[hoje.getMonth()]} 1–${hoje.getDate()}`
    : `FATURAMENTO · ${curLabel}`;

  if (comandasMes.length === 0) {
    document.getElementById('geralFatNum').textContent = 'Sem dados ainda';
    document.getElementById('geralFatDelta').textContent = '';
    document.getElementById('geralFatNote').textContent = `Aguardando import de ${curLabel}`;
    document.getElementById('geralChannels').innerHTML = '';
    document.getElementById('geralKpis').innerHTML = '';
    document.getElementById('geralGruposRows').innerHTML = '<div class="no-results">Sem dados desse mês ainda</div>';
    renderNotas('geralNotas', 'ceo', curLabel);
    return;
  }

  const totFat = comandasMes.reduce((s,d)=>s+(Number(d.total)||0),0);
  const totPrev = comandasPrev.reduce((s,d)=>s+(Number(d.total)||0),0);
  document.getElementById('geralFatNum').innerHTML = `<span class="hide-val">${fmtBRL(totFat)}</span>`;
  if (totPrev > 0) {
    const delta = ((totFat-totPrev)/totPrev*100);
    const el = document.getElementById('geralFatDelta');
    el.className = 'hero-delta ' + (delta>=0?'up':'dn');
    el.textContent = `${delta>=0?'↑':'↓'} ${Math.abs(delta).toFixed(1)}% vs. ${prevLabel} completo`;
  } else {
    document.getElementById('geralFatDelta').textContent = '';
  }
  document.getElementById('geralFatNote').textContent = 'Fonte: iComanda';

  // Canais — Salão (Mesa) vs Delivery (soma de tudo o resto, canais dinâmicos)
  const salaoRows = comandasMes.filter(d => (d.nome||'').trim().toLowerCase()==='mesa');
  const deliveryRows = comandasMes.filter(d => (d.nome||'').trim().toLowerCase()!=='mesa');
  const salaoTotal = salaoRows.reduce((s,d)=>s+(Number(d.total)||0),0);
  const deliveryTotal = deliveryRows.reduce((s,d)=>s+(Number(d.total)||0),0);
  const maxCanal = Math.max(salaoTotal, deliveryTotal, 1);
  document.getElementById('geralChannels').innerHTML = `
    <div class="chan">
      <div class="chan-top"><span class="chan-name">Salão</span><span class="chan-val hide-val">${fmtBRL(salaoTotal)}</span></div>
      <div class="chan-bar"><div style="width:${(salaoTotal/maxCanal*100).toFixed(1)}%;background:var(--blue)"></div></div>
      <div class="chan-sub"><span>${fmtNum(salaoRows.reduce((s,d)=>s+(Number(d.qtd_pedidos)||0),0))} comandas</span></div>
    </div>
    <div class="chan">
      <div class="chan-top"><span class="chan-name">Delivery</span><span class="chan-val hide-val">${fmtBRL(deliveryTotal)}</span></div>
      <div class="chan-bar">${deliveryRows.map((d,i)=>{
        const colors=['var(--orange)','var(--yellow)','var(--aqua)','var(--green)'];
        const pct = deliveryTotal>0 ? (Number(d.total)/deliveryTotal*100) : 0;
        return `<div style="width:${(deliveryTotal/maxCanal*pct/100*100).toFixed(1)}%;background:${colors[i%colors.length]}" title="${d.nome}"></div>`;
      }).join('')}</div>
      <div class="chan-sub">${deliveryRows.length ? deliveryRows.map(d=>`<span>${d.nome}: ${fmtNum(d.qtd_pedidos)}</span>`).join('') : '<span>Sem canais registrados</span>'}</div>
    </div>`;

  // KPIs secundários (a partir de ca_turno do mês — só mede Salão, é o que temos em tempo real)
  const curYM = labelToYM(curLabel);
  const turnoMes = DATA.turno.filter(d => d.data && d.data.slice(0,7)===curYM);
  const totComandasMes = comandasMes.reduce((s,d)=>s+(Number(d.qtd_pedidos)||0),0);
  const ticketMedioMes = totComandasMes>0 ? totFat/totComandasMes : 0;
  const totPessoas = turnoMes.reduce((s,d)=>s+(Number(d.pessoas)||0),0);
  const totComandasTurno = turnoMes.reduce((s,d)=>s+(Number(d.comandas)||0),0);
  const totCusto = turnoMes.reduce((s,d)=>s+(Number(d.custo)||0),0);
  const totFatTurno = turnoMes.reduce((s,d)=>s+(Number(d.faturado)||0),0);
  document.getElementById('geralKpis').innerHTML = `
    <div class="kpi"><div class="kpi-l">Ticket médio</div><div class="kpi-v hide-val">${fmtBRL(ticketMedioMes)}</div><div class="kpi-s">todos os canais</div></div>
    <div class="kpi"><div class="kpi-l">Comandas do mês</div><div class="kpi-v">${fmtNum(totComandasMes)}</div><div class="kpi-s">todos os canais</div></div>
    <div class="kpi"><div class="kpi-l">Pessoas/comanda</div><div class="kpi-v">${totComandasTurno>0?(totPessoas/totComandasTurno).toFixed(1):'—'}</div><div class="kpi-s">salão</div></div>
    <div class="kpi"><div class="kpi-l">Custo / faturamento</div><div class="kpi-v">${totFatTurno>0?fmtPct(totCusto/totFatTurno*100):'—'}</div><div class="kpi-s">salão</div></div>`;

  renderNotas('geralNotas', 'ceo', curLabel);

  // Top grupos do mês atual
  const gruposMes = DATA.grupos.filter(d => d.periodo===curLabel);
  document.getElementById('geralGruposPeriodo').textContent = curLabel;
  if (gruposMes.length === 0) {
    document.getElementById('geralGruposRows').innerHTML = '<div class="no-results">Grupos de produtos só ficam disponíveis no fechamento mensal</div>';
  } else {
    const top = [...gruposMes].sort((a,b)=>(Number(b.faturado)||0)-(Number(a.faturado)||0)).slice(0,6);
    const max = Math.max(...top.map(d=>Number(d.faturado)||0), 1);
    document.getElementById('geralGruposRows').innerHTML = top.map(d => `
      <div class="row"><span class="row-lbl" title="${d.nome}">${d.nome}</span>
      <div class="row-track"><div class="row-fill" style="width:${(Number(d.faturado)/max*100).toFixed(1)}%"></div></div>
      <span class="row-val hide-val">${fmtBRL(d.faturado)}</span></div>`).join('');
  }
}

// ===== OPERAÇÃO (Turno + Horário) =====
function filterTurno(tipo, btn) {
  FILTER_TURNO_TIPO = tipo;
  document.querySelectorAll('#filter-turno-tipo .chip').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderOperacao();
}
function renderOperacao() {
  const p = document.getElementById('sel-turno').value;
  const rows = DATA.turno.filter(d => {
    const mp = p ? d.data?.slice(0,7)===p : true;
    const mt = FILTER_TURNO_TIPO ? d.turno===FILTER_TURNO_TIPO : true;
    return mp && mt;
  });
  const totFat = rows.reduce((s,d)=>s+(Number(d.faturado)||0),0);
  const totCmd = rows.reduce((s,d)=>s+(Number(d.comandas)||0),0);
  const totPes = rows.reduce((s,d)=>s+(Number(d.pessoas)||0),0);
  const tkMed = totCmd>0 ? totFat/totCmd : 0;
  document.getElementById('operacaoKpis').innerHTML = `
    <div class="kpi"><div class="kpi-l">Faturamento (salão)</div><div class="kpi-v hide-val">${fmtBRL(totFat)}</div><div class="kpi-s">${rows.length} turnos</div></div>
    <div class="kpi"><div class="kpi-l">Comandas</div><div class="kpi-v">${fmtNum(totCmd)}</div><div class="kpi-s">no período</div></div>
    <div class="kpi"><div class="kpi-l">Pessoas</div><div class="kpi-v">${fmtNum(totPes)}</div><div class="kpi-s">no período</div></div>
    <div class="kpi"><div class="kpi-l">Ticket médio</div><div class="kpi-v hide-val">${fmtBRL(tkMed)}</div><div class="kpi-s">por comanda</div></div>`;

  const periodo = p || currentMonthLabel();
  renderNotas('operacaoNotas', 'diasemana', periodo);

  // Horário — agregado pelas linhas filtradas por mês (ca_horario é por período, não por turno tipo)
  const horarioRows = p ? DATA.horario.filter(d=>d.periodo===p) : DATA.horario;
  const aggH = {};
  horarioRows.forEach(d => { const h=Number(d.hora); if(!aggH[h]) aggH[h]={hora:h,faturado:0}; aggH[h].faturado+=Number(d.faturado)||0; });
  const aggHRows = Object.values(aggH).sort((a,b)=>a.hora-b.hora);
  if (aggHRows.length === 0) {
    document.getElementById('operacaoHorarioRows').innerHTML = '<div class="no-results">Horário só fica disponível no fechamento mensal</div>';
  } else {
    const maxH = Math.max(...aggHRows.map(d=>d.faturado), 1);
    document.getElementById('operacaoHorarioRows').innerHTML = aggHRows.map(d => `
      <div class="row"><span class="row-lbl">${String(d.hora).padStart(2,'0')}:00</span>
      <div class="row-track"><div class="row-fill" style="width:${(d.faturado/maxH*100).toFixed(1)}%;background:var(--aqua)"></div></div>
      <span class="row-val hide-val">${fmtBRL(d.faturado)}</span></div>`).join('');
  }

  const sorted = getSorted('turno', rows); updateSortIcons('turno');
  const tags = {almoco:'tag-almoco', jantar:'tag-jantar', cafe:'tag-cafe'};
  document.getElementById('body-turno').innerHTML = sorted.map(d => `<tr>
    <td>${d.data||'—'}</td><td>${d.semana||'—'}</td>
    <td><span class="tag ${tags[d.turno]||''}">${d.turno||'—'}</span></td>
    <td>${d.usuario||'—'}</td>
    <td class="hide-val">${fmtBRL(d.faturado)}</td>
    <td>${fmtNum(d.comandas)}</td><td>${fmtNum(d.pessoas)}</td>
    <td class="hide-val">${fmtBRL(d.ticket_medio)}</td>
  </tr>`).join('') || '<tr><td colspan="8" class="no-results">Sem turnos nesse filtro</td></tr>';
  document.getElementById('operacaoTurnoCount').textContent = `${rows.length} turnos`;
}

// ===== PRODUTOS (Grupos + Produtos) =====
function renderProdutos() {
  const p = document.getElementById('sel-produtos').value;
  const gruposRows = p ? DATA.grupos.filter(d=>d.periodo===p) : DATA.grupos;
  const aggG = {};
  gruposRows.forEach(d => {
    if (!aggG[d.nome]) aggG[d.nome] = {nome:d.nome, faturado:0};
    aggG[d.nome].faturado += Number(d.faturado)||0;
  });
  const topG = Object.values(aggG).sort((a,b)=>b.faturado-a.faturado).slice(0,10);
  if (topG.length === 0) {
    document.getElementById('produtosGruposRows').innerHTML = '<div class="no-results">Sem dados de grupos pro período</div>';
  } else {
    const maxG = Math.max(...topG.map(d=>d.faturado), 1);
    document.getElementById('produtosGruposRows').innerHTML = topG.map(d => `
      <div class="row"><span class="row-lbl" title="${d.nome}">${d.nome}</span>
      <div class="row-track"><div class="row-fill" style="width:${(d.faturado/maxG*100).toFixed(1)}%"></div></div>
      <span class="row-val hide-val">${fmtBRL(d.faturado)}</span></div>`).join('');
  }

  const search = (document.getElementById('searchProdutos').value||'').toLowerCase();
  let prodRows = p ? DATA.produtos.filter(d=>d.periodo===p) : DATA.produtos;
  if (search) prodRows = prodRows.filter(d => (d.nome||'').toLowerCase().includes(search));
  const sorted = getSorted('produtos', prodRows); updateSortIcons('produtos');
  document.getElementById('body-produtos').innerHTML = sorted.slice(0,200).map(d => `<tr>
    <td>${d.nome}</td><td>${fmtNum(d.qtd)}</td><td class="hide-val">${fmtBRL(d.faturado)}</td>
  </tr>`).join('') || '<tr><td colspan="3" class="no-results">Nenhum produto encontrado</td></tr>';
  document.getElementById('produtosCount').textContent = `${prodRows.length} produtos`;
}

// ===== EQUIPE (Atendentes) =====
function renderEquipe() {
  const p = document.getElementById('sel-atendente').value;
  const rows = p ? DATA.atendente.filter(d=>d.periodo===p) : DATA.atendente;
  const aggA = {};
  rows.forEach(d => {
    if (!aggA[d.nome]) aggA[d.nome] = {nome:d.nome, r_total:0, comandas:0, _cnt:0};
    aggA[d.nome].r_total += Number(d.r_total)||0;
    aggA[d.nome].comandas += Number(d.comandas)||0;
  });
  const aggRows = Object.values(aggA).map(d => ({...d, ticket_medio: d.comandas>0 ? d.r_total/d.comandas : 0}));
  const sorted = getSorted('atendente', aggRows); updateSortIcons('atendente');
  document.getElementById('body-atendente').innerHTML = sorted.map(d => `<tr>
    <td>${d.nome}</td><td class="hide-val">${fmtBRL(d.r_total)}</td><td>${fmtNum(d.comandas)}</td><td class="hide-val">${fmtBRL(d.ticket_medio)}</td>
  </tr>`).join('') || '<tr><td colspan="4" class="no-results">Sem dados pro período</td></tr>';
  document.getElementById('equipeCount').textContent = `${aggRows.length} atendentes`;

  renderNotas('equipeNotas', 'atendente', p || currentMonthLabel());
}

// ===== COMPARAR =====
function renderComparar() {
  const pa = document.getElementById('cmpPeriodoA').value;
  const pb = document.getElementById('cmpPeriodoB').value;
  if (!pa || !pb) { document.getElementById('compararResultado').innerHTML = ''; return; }

  function totals(periodo) {
    const c = DATA.comandas.filter(d=>d.periodo===periodo);
    const fat = c.reduce((s,d)=>s+(Number(d.total)||0),0);
    const cmd = c.reduce((s,d)=>s+(Number(d.qtd_pedidos)||0),0);
    return { fat, cmd, ticket: cmd>0?fat/cmd:0 };
  }
  const a = totals(pa), b = totals(pb);
  function deltaCard(label, va, vb, fmt) {
    const delta = vb>0 ? ((va-vb)/vb*100) : 0;
    const cls = delta>=0 ? 'up' : 'dn';
    return `<div class="kpi"><div class="kpi-l">${label}</div>
      <div class="kpi-v hide-val">${fmt(va)}</div>
      <div class="kpi-s hero-delta ${cls}">${delta>=0?'↑':'↓'} ${Math.abs(delta).toFixed(1)}% vs. ${pb}</div></div>`;
  }
  document.getElementById('compararResultado').innerHTML =
    deltaCard(`Faturamento (${pa})`, a.fat, b.fat, fmtBRL) +
    deltaCard(`Comandas (${pa})`, a.cmd, b.cmd, fmtNum) +
    deltaCard(`Ticket médio (${pa})`, a.ticket, b.ticket, fmtBRL);
}

// ===== IMPORTAÇÕES =====
function renderImportacoes() {
  const rows = DATA.importLog || [];
  if (rows.length === 0) {
    document.getElementById('importLogRows').innerHTML = '<div class="no-results">Nenhuma importação registrada ainda</div>';
    return;
  }
  document.getElementById('importLogRows').innerHTML = rows.map(r => `
    <div class="log-row">
      <div>
        <span class="${r.sucesso?'log-ok':'log-err'}">${r.sucesso?'✓':'✗'}</span>
        &nbsp;${r.arquivo} <span class="log-meta">(${r.modo}${r.periodos?.length ? ' · '+r.periodos.join(', ') : ''})</span>
        ${r.erro ? `<div class="log-meta" style="color:var(--red)">${r.erro}</div>` : ''}
      </div>
      <span class="log-meta">${fmtDate(r.created_at)}</span>
    </div>`).join('');
}

// ===== CARREGAMENTO GERAL =====
async function loadAll() {
  document.getElementById('hdrPeriodo').textContent = 'Atualizando...';

  const [turno,grupos,horario,atendente,produtos,comandas,notas,importLog] = await Promise.all([
    fetchAll('ca_turno'), fetchAll('ca_grupos'), fetchAll('ca_horario'),
    fetchAll('ca_atendente'), fetchAll('ca_produtos'), fetchAll('ca_comandas'),
    fetchAll('ca_notas'), fetchAll('ca_import_log')
  ]);
  DATA = { turno, grupos, horario, atendente, produtos, comandas, notas, importLog: Array.isArray(importLog)?importLog:[] };

  const curLabel = currentMonthLabel();
  const curYM = currentMonthYM();

  populatePeriods('sel-turno', DATA.turno.map(d=>d.data?.slice(0,7)).filter(Boolean));
  // sel-turno usa YYYY-MM, os demais usam "Mon/YY" — repopular sel-turno com o formato certo:
  (function(){
    const sel = document.getElementById('sel-turno');
    const uniq = [...new Set(DATA.turno.map(d=>d.data?.slice(0,7)).filter(Boolean))].sort().reverse();
    sel.innerHTML = '<option value="">Todos os meses</option>' + uniq.map(p=>`<option value="${p}">${p}</option>`).join('');
  })();
  populatePeriods('sel-produtos', DATA.produtos.map(d=>d.periodo));
  populatePeriods('sel-atendente', DATA.atendente.map(d=>d.periodo));
  const periodosComandas = sortLabels(DATA.comandas.map(d=>d.periodo));
  populatePeriods('cmpPeriodoA', periodosComandas);
  populatePeriods('cmpPeriodoB', periodosComandas);

  // sel-geral (Visão Geral) sempre tem um mês selecionado, nunca "Todos os meses"
  // — o card principal representa um mês por vez.
  (function(){
    const sel = document.getElementById('sel-geral');
    const cur = sel.value;
    const opts = periodosComandas.includes(curLabel) ? periodosComandas : [curLabel, ...periodosComandas];
    sel.innerHTML = opts.map(p => `<option value="${p}"${p===cur?' selected':''}>${p}</option>`).join('');
  })();

  selectCurrentMonth('sel-turno', curYM);
  selectCurrentMonth('sel-geral', curLabel);
  selectCurrentMonth('sel-produtos', curLabel);
  selectCurrentMonth('sel-atendente', curLabel);

  const hoje = new Date();
  document.getElementById('hdrPeriodo').textContent = `${MESES_ABREV[hoje.getMonth()]} 1–${hoje.getDate()} · Fonte: iComanda`;

  renderGeral();
  renderOperacao();
  renderProdutos();
  renderEquipe();
  renderImportacoes();
}
