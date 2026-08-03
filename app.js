// ===== ESTADO =====
let DATA = { turno:[], grupos:[], horario:[], atendente:[], produtos:[], comandas:[], notas:[], importLog:[], resumoCaixa:[] };
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

// ===== SÉRIE MENSAL (pra sparklines e aba Gráficos) =====
// Uma linha por mês que existe em ca_comandas (fonte oficial, todos os canais),
// com pessoas emparelhadas via ca_turno (só Salão, é o que temos por dia).
function monthlySeries() {
  const porPeriodo = {};
  DATA.comandas.forEach(d => {
    if (!d.periodo) return;
    if (!porPeriodo[d.periodo]) porPeriodo[d.periodo] = { periodo: d.periodo, faturado: 0, comandas: 0 };
    porPeriodo[d.periodo].faturado += Number(d.total) || 0;
    porPeriodo[d.periodo].comandas += Number(d.qtd_pedidos) || 0;
  });
  const labels = Object.keys(porPeriodo).sort((a, b) => {
    const [ma, ya] = a.split('/'); const [mb, yb] = b.split('/');
    return (Number(ya) - Number(yb)) || (MESES_ABREV.indexOf(ma) - MESES_ABREV.indexOf(mb));
  });
  return labels.map(periodo => {
    const row = porPeriodo[periodo];
    const ym = labelToYM(periodo);
    const pessoas = DATA.turno.filter(d => d.data && d.data.slice(0,7) === ym).reduce((s,d) => s + (Number(d.pessoas)||0), 0);
    return {
      periodo,
      faturado: row.faturado,
      comandas: row.comandas,
      pessoas,
      ticketMedio: row.comandas > 0 ? row.faturado / row.comandas : 0
    };
  });
}

function sparkline(values, color) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const w = 200, h = 28, pad = 3;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// Gráfico de linha maior, com eixo e pontos com hover (title nativo) — usado na aba Gráficos.
function lineChart(series, key, color, fmt) {
  const values = series.map(m => m[key]);
  if (values.length < 2) return '<div class="no-results">Poucos meses com dado pra desenhar um gráfico ainda</div>';
  const min = Math.min(0, ...values), max = Math.max(...values) || 1;
  const range = (max - min) || 1;
  const W = 700, H = 200, padL = 46, padB = 24, padT = 14, padR = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = i => padL + (i / (values.length - 1)) * plotW;
  const y = v => padT + plotH - ((v - min) / range) * plotH;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${color}"><title>${series[i].periodo}: ${fmt(v)}</title></circle>`).join('');
  const labels = series.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H-6}" text-anchor="middle" class="axis-lbl">${m.periodo}</text>`).join('');
  const yTop = `<text x="4" y="${padT+8}" class="axis-lbl">${fmt(max)}</text>`;
  const yBot = `<text x="4" y="${padT+plotH}" class="axis-lbl">${fmt(min)}</text>`;
  return `<svg width="100%" height="220" viewBox="0 0 ${W} ${H}">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+plotH}" stroke="var(--border)"/>
    <line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}" stroke="var(--border)"/>
    ${yTop}${yBot}
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"/>
    ${dots}
    ${labels}
  </svg>`;
}

let GRAFICO_METRICA = 'faturado';
function renderGraficos(metric, btn) {
  if (metric) GRAFICO_METRICA = metric;
  if (btn) { document.querySelectorAll('#graficosChips .chip').forEach(c=>c.classList.remove('on')); btn.classList.add('on'); }
  const serie = monthlySeries();
  document.getElementById('graficosPeriodo').textContent = serie.length ? `${serie[0].periodo} – ${serie[serie.length-1].periodo}` : '';
  const specs = {
    faturado: { color: 'var(--blue)', fmt: fmtBRL },
    pessoas: { color: 'var(--aqua)', fmt: fmtNum },
    comandas: { color: 'var(--yellow)', fmt: fmtNum },
    ticketMedio: { color: 'var(--orange)', fmt: fmtBRL }
  };
  const spec = specs[GRAFICO_METRICA];
  document.getElementById('graficoWrap').innerHTML = lineChart(serie, GRAFICO_METRICA, spec.color, spec.fmt);
}

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
function renderNotas(elId, contextoOuLista, periodo) {
  const contextos = Array.isArray(contextoOuLista) ? contextoOuLista : [contextoOuLista];
  const notas = contextos.flatMap(c => getNotas(c, periodo));
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
function sameMonthLastYear(label) {
  const [mes, ano] = label.split('/');
  return `${mes}/${String(parseInt(ano,10)-1).padStart(2,'0')}`;
}
function renderGeral() {
  const curLabel = document.getElementById('sel-geral').value || currentMonthLabel();
  const prevLabel = previousLabelOf(curLabel);
  const yoyLabel = sameMonthLastYear(curLabel);
  const comandasMes = DATA.comandas.filter(d => d.periodo===curLabel);
  const comandasPrev = DATA.comandas.filter(d => d.periodo===prevLabel);
  const comandasYoy = DATA.comandas.filter(d => d.periodo===yoyLabel);

  const hoje = new Date();
  const isMesAtual = curLabel === currentMonthLabel();
  document.getElementById('geralFatLbl').textContent = isMesAtual
    ? `FATURAMENTO · ${MESES_ABREV[hoje.getMonth()]} 1–${hoje.getDate()}`
    : `FATURAMENTO · ${curLabel}`;

  if (comandasMes.length === 0) {
    document.getElementById('geralFatNum').textContent = 'Sem dados ainda';
    document.getElementById('geralFatDelta').textContent = '';
    document.getElementById('geralFatDeltaYoy').textContent = '';
    document.getElementById('geralFatNote').textContent = `Aguardando import de ${curLabel}`;
    document.getElementById('geralChannels').innerHTML = '';
    document.getElementById('geralKpis').innerHTML = '';
    document.getElementById('geralGruposRows').innerHTML = '<div class="no-results">Sem dados desse mês ainda</div>';
    renderNotas('geralNotas', 'ceo', curLabel);
    return;
  }

  function deltaLine(elId, atual, anterior, rotulo) {
    const el = document.getElementById(elId);
    if (!(anterior > 0)) { el.textContent = ''; return; }
    const delta = ((atual-anterior)/anterior*100);
    el.className = 'hero-delta ' + (delta>=0?'up':'dn');
    el.textContent = `${delta>=0?'↑':'↓'} ${Math.abs(delta).toFixed(1)}% ${rotulo}`;
  }

  const totFat = comandasMes.reduce((s,d)=>s+(Number(d.total)||0),0);
  const totPrev = comandasPrev.reduce((s,d)=>s+(Number(d.total)||0),0);
  const totYoy = comandasYoy.reduce((s,d)=>s+(Number(d.total)||0),0);
  document.getElementById('geralFatNum').innerHTML = `<span class="hide-val">${fmtBRL(totFat)}</span>`;
  deltaLine('geralFatDelta', totFat, totPrev, `vs. ${prevLabel}`);
  deltaLine('geralFatDeltaYoy', totFat, totYoy, `vs. ${yoyLabel} (ano passado)`);
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

  // KPIs secundários. ca_resumo_caixa é o número OFICIAL (todos os canais,
  // extraído do relatório "Detalhamento de Caixa" do iComanda) — usa ele
  // quando existir pro mês; senão cai na aproximação via ca_turno (só Salão).
  const curYM = labelToYM(curLabel);
  const prevYM = labelToYM(prevLabel);
  const turnoMes = DATA.turno.filter(d => d.data && d.data.slice(0,7)===curYM);
  const turnoPrev = DATA.turno.filter(d => d.data && d.data.slice(0,7)===prevYM);
  const resumoAtual = (DATA.resumoCaixa||[]).find(d=>d.periodo===curLabel);
  const resumoPrev = (DATA.resumoCaixa||[]).find(d=>d.periodo===prevLabel);

  const totComandasMes = resumoAtual ? Number(resumoAtual.comandas) : comandasMes.reduce((s,d)=>s+(Number(d.qtd_pedidos)||0),0);
  const ticketMedioMes = resumoAtual ? Number(resumoAtual.ticket_medio) : (totComandasMes>0 ? totFat/totComandasMes : 0);
  const totPessoas = resumoAtual ? Number(resumoAtual.pessoas) : turnoMes.reduce((s,d)=>s+(Number(d.pessoas)||0),0);
  const totPessoasPrev = resumoPrev ? Number(resumoPrev.pessoas) : turnoPrev.reduce((s,d)=>s+(Number(d.pessoas)||0),0);
  const deltaPessoas = totPessoasPrev>0 ? ((totPessoas-totPessoasPrev)/totPessoasPrev*100) : null;
  const pessoasPorComanda = resumoAtual
    ? (Number(resumoAtual.comandas)>0 ? totPessoas/Number(resumoAtual.comandas) : null)
    : (turnoMes.reduce((s,d)=>s+(Number(d.comandas)||0),0)>0 ? totPessoas/turnoMes.reduce((s,d)=>s+(Number(d.comandas)||0),0) : null);
  const fonte = resumoAtual ? 'todos os canais' : 'salão (aprox.)';

  const serie = monthlySeries().slice(-7);
  const sTicket = sparkline(serie.map(m=>m.ticketMedio), 'var(--orange)');
  const sComandas = sparkline(serie.map(m=>m.comandas), 'var(--yellow)');
  const sPessoas = sparkline(serie.map(m=>m.pessoas), 'var(--aqua)');

  const produtosMes = DATA.produtos.filter(d => d.periodo===curLabel);
  const topProduto = produtosMes.length ? [...produtosMes].sort((a,b)=>(Number(b.qtd)||0)-(Number(a.qtd)||0))[0] : null;

  document.getElementById('geralKpis').innerHTML = `
    <div class="kpi"><div class="kpi-l">Ticket médio</div><div class="kpi-v hide-val">${fmtBRL(ticketMedioMes)}</div><div class="kpi-s">${fonte}</div>${sTicket}</div>
    <div class="kpi"><div class="kpi-l">Comandas do mês</div><div class="kpi-v">${fmtNum(totComandasMes)}</div><div class="kpi-s">${fonte}</div>${sComandas}</div>
    <div class="kpi"><div class="kpi-l">Quantidade de pessoas</div><div class="kpi-v">${fmtNum(totPessoas)}</div><div class="kpi-s ${deltaPessoas!=null?(deltaPessoas>=0?'up':'dn'):''}">${deltaPessoas!=null?`${deltaPessoas>=0?'↑':'↓'} ${Math.abs(deltaPessoas).toFixed(1)}% vs. ${prevLabel} · ${fonte}`:fonte}</div>${sPessoas}</div>
    <div class="kpi"><div class="kpi-l">Produto mais vendido</div><div class="kpi-v kpi-v-txt" title="${topProduto?topProduto.nome:''}">${topProduto?topProduto.nome:'—'}</div><div class="kpi-s">${topProduto?`${fmtNum(topProduto.qtd)} vendidos · fechamento mensal`:'sem fechamento pro mês'}</div></div>`;

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

  // ca_turno só mede o Salão — mostra também o total do mês com todos os canais
  // (ca_comandas), quando o filtro for de um mês específico.
  let totalTodosCanais = null;
  if (p) {
    const [ano, mes] = p.split('-');
    const label = `${MESES_ABREV[parseInt(mes,10)-1]}/${ano.slice(2)}`;
    const comandasP = DATA.comandas.filter(d=>d.periodo===label);
    if (comandasP.length) totalTodosCanais = comandasP.reduce((s,d)=>s+(Number(d.total)||0),0);
  }

  document.getElementById('operacaoKpis').innerHTML = `
    <div class="kpi"><div class="kpi-l">Faturamento (salão)</div><div class="kpi-v hide-val">${fmtBRL(totFat)}</div><div class="kpi-s">${rows.length} turnos</div></div>
    <div class="kpi"><div class="kpi-l">Faturamento total do mês</div><div class="kpi-v hide-val">${totalTodosCanais!=null?fmtBRL(totalTodosCanais):'—'}</div><div class="kpi-s">todos os canais</div></div>
    <div class="kpi"><div class="kpi-l">Comandas</div><div class="kpi-v">${fmtNum(totCmd)}</div><div class="kpi-s">salão, no período</div></div>
    <div class="kpi"><div class="kpi-l">Pessoas</div><div class="kpi-v">${fmtNum(totPes)}</div><div class="kpi-s">salão, no período</div></div>
    <div class="kpi"><div class="kpi-l">Ticket médio</div><div class="kpi-v hide-val">${fmtBRL(tkMed)}</div><div class="kpi-s">salão, por comanda</div></div>`;

  const periodo = p || currentMonthLabel();
  renderNotas('operacaoNotas', ['turno', 'diasemana'], periodo);

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
  renderNotas('produtosNotas', 'produtos', p || currentMonthLabel());
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

  const [turno,grupos,horario,atendente,produtos,comandas,notas,importLog,resumoCaixa] = await Promise.all([
    fetchAll('ca_turno'), fetchAll('ca_grupos'), fetchAll('ca_horario'),
    fetchAll('ca_atendente'), fetchAll('ca_produtos'), fetchAll('ca_comandas'),
    fetchAll('ca_notas'), fetchAll('ca_import_log'), fetchAll('ca_resumo_caixa')
  ]);
  DATA = {
    turno, grupos, horario, atendente, produtos, comandas, notas,
    importLog: Array.isArray(importLog)?importLog:[],
    resumoCaixa: Array.isArray(resumoCaixa)?resumoCaixa:[]
  };

  const curLabel = currentMonthLabel();
  const curYM = currentMonthYM();
  // Padrão de cada filtro: o mês atual, SE já tiver dado importado pra ele —
  // senão cai no mês mais recente que já tem dado (em vez de mostrar "sem
  // dados" pro mês calendário atual só porque ainda não foi importado).
  function defaultLabel(periods) { return periods.includes(curLabel) ? curLabel : (periods[0] || curLabel); }
  function defaultYM(yms) { return yms.includes(curYM) ? curYM : (yms[0] || curYM); }

  const turnoYMs = [...new Set(DATA.turno.map(d=>d.data?.slice(0,7)).filter(Boolean))].sort().reverse();
  const periodosProdutos = sortLabels(DATA.produtos.map(d=>d.periodo));
  const periodosAtendente = sortLabels(DATA.atendente.map(d=>d.periodo));
  const periodosComandas = sortLabels(DATA.comandas.map(d=>d.periodo));

  (function(){
    const sel = document.getElementById('sel-turno');
    sel.innerHTML = '<option value="">Todos os meses</option>' + turnoYMs.map(p=>`<option value="${p}">${p}</option>`).join('');
  })();
  populatePeriods('sel-produtos', periodosProdutos);
  populatePeriods('sel-atendente', periodosAtendente);
  populatePeriods('cmpPeriodoA', periodosComandas);
  populatePeriods('cmpPeriodoB', periodosComandas);

  // sel-geral (Visão Geral) sempre tem um mês selecionado, nunca "Todos os meses"
  // — o card principal representa um mês por vez.
  (function(){
    const sel = document.getElementById('sel-geral');
    const opts = periodosComandas.length ? periodosComandas : [curLabel];
    sel.innerHTML = opts.map(p => `<option value="${p}">${p}</option>`).join('');
  })();

  selectCurrentMonth('sel-turno', defaultYM(turnoYMs));
  selectCurrentMonth('sel-geral', defaultLabel(periodosComandas));
  selectCurrentMonth('sel-produtos', defaultLabel(periodosProdutos));
  selectCurrentMonth('sel-atendente', defaultLabel(periodosAtendente));

  const hoje = new Date();
  document.getElementById('hdrPeriodo').textContent = `${MESES_ABREV[hoje.getMonth()]} 1–${hoje.getDate()} · Fonte: iComanda`;

  renderGeral();
  renderOperacao();
  renderProdutos();
  renderEquipe();
  renderImportacoes();
  renderGraficos();
}
