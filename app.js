
let DATA = { turno:[], grupos:[], horario:[], atendente:[], produtos:[], comandas:[] };
let SORT = {
  turno:{col:'data',dir:-1}, grupos:{col:'faturado',dir:-1},
  horario:{col:'hora',dir:1}, atendente:{col:'r_total',dir:-1},
  produtos:{col:'faturado',dir:-1}, ranking:{col:'faturado',dir:-1},
  comandas:{col:'total',dir:-1}
};
let FILTER_TURNO_TYPE = '';

// Extrair tamanho do nome do produto
function extractTam(nome) {
  const n = nome.toLowerCase();
  if (n.includes('4 pessoa') || n.includes('4p')) return '4P';
  if (n.includes('3 pessoa') || n.includes('3p')) return '3P';
  if (n.includes('2 pessoa') || n.includes('2p')) return '2P';
  if (n.includes('individual') || n.includes(' ind') || n.includes('(ind')) return 'Ind.';
  if (n.includes('executiv')) return 'Exec.';
  return '—';
}

// Inferir grupo pelo nome
function inferGrupo(nome, grupos) {
  const n = nome.toLowerCase();
  // Tenta casar com grupos reais da tabela ca_grupos
  const KEYWORDS = {
    'BACALHAUS': ['bacalhau','bacalhão'],
    'FRUTOS DO MAR': ['camarão','lagosta','polvo','lula','mariscos','frutos do mar'],
    'BEBIDAS': ['cerveja','chopp','vinho','dose','drink','caipirinha','gin','whisky'],
    'BEBIDAS SEM ALCOOL': ['suco','água','refrigerante','coca','guaraná','limonada'],
    'SOBREMESAS': ['sobremesa','pudim','mousse','torta','sorvete','doce'],
    'ENTRADAS/PETISCOS': ['bolinho','pastel','isca','entrada','petisco','croquete'],
    'PRATOS EXECUTIVOS': ['executiv','prato do dia'],
    'GUARNIÇÕES': ['guarnição','acompanha','farofa','arroz','feijão','batata'],
    'SALADAS': ['salada'],
    'SOPAS': ['sopa','caldo'],
    'SUCOS': ['suco'],
    'VINHOS': ['vinho'],
    'DRINKS': ['drink','caipirinha','mojito'],
  };
  for (const [grp, kws] of Object.entries(KEYWORDS)) {
    if (kws.some(k => n.includes(k))) return grp;
  }
  return 'OUTROS';
}

async function fetchAll(table, limit=10000) {
  if (window.DEV_MODE) return (window.MOCK_DATA && window.MOCK_DATA[table]) || [];
  const r = await fetch(`/api/${table}?limit=${limit}`, { headers: window.authHeaders ? window.authHeaders() : {} });
  if (r.status === 401) { if (window.onAuthExpired) window.onAuthExpired(); return []; }
  return r.json();
}

const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function currentMonthYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function currentMonthLabel() {
  const d = new Date();
  return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}
function selectCurrentMonth(tab, value) {
  const sel = document.getElementById(`sel-${tab}`);
  if (sel && [...sel.options].some(o => o.value === value)) sel.value = value;
}

function fmtBRL(v) { return v != null ? 'R$ ' + Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; }
function fmtBRLh(v) { return `<span class="hide-val">${fmtBRL(v)}</span>`; }
function fmtNum(v) { return v != null ? Number(v).toLocaleString('pt-BR') : '—'; }
function fmtPct(v) { return v != null ? Number(v).toFixed(1)+'%' : '—'; }

function showTab(tab) {
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',['turno','grupos','horario','atendente','produtos','ranking','comandas'][i]===tab));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById(`sec-${tab}`).classList.add('active');
}

function populatePeriods(tab, data, col='periodo') {
  const sel = document.getElementById(`sel-${tab}`);
  const cur = sel.value;
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const periods = col==='data'
    ? [...new Set(data.map(d=>d.data?.slice(0,7)))].filter(Boolean).sort().reverse()
    : [...new Set(data.map(d=>d[col]).filter(Boolean))].sort((a,b)=>{
        const [ma,ya]=a.split('/'); const [mb,yb]=b.split('/');
        return (Number(yb)-Number(ya))||(MESES.indexOf(mb)-MESES.indexOf(ma));
      });
  sel.innerHTML = '<option value="">Todos os meses</option>'+periods.map(p=>`<option value="${p}"${p===cur?' selected':''}>${p}</option>`).join('');
}

function sortTable(tab, col) {
  SORT[tab].dir = SORT[tab].col===col ? SORT[tab].dir*-1 : -1;
  SORT[tab].col = col;
  render(tab);
}

function getSorted(tab, rows) {
  const {col,dir} = SORT[tab];
  return [...rows].sort((a,b)=>{
    const va=a[col], vb=b[col];
    if (va==null) return 1; if (vb==null) return -1;
    if (typeof va==='string') return dir*va.localeCompare(vb,'pt');
    return dir*(Number(va)-Number(vb));
  });
}

function updateSortIcons(tab) {
  document.querySelectorAll(`#sec-${tab} thead th`).forEach(th=>{
    const col=th.dataset.col; if(!col) return;
    th.classList.toggle('sorted',col===SORT[tab].col);
    const icon=th.querySelector('.sort-icon');
    if(icon) icon.textContent=col===SORT[tab].col?(SORT[tab].dir===1?' ↑':' ↓'):' ↕';
  });
}

// ===== TURNO =====
function filterTurnoType(t,btn) {
  FILTER_TURNO_TYPE=t;
  document.querySelectorAll('#filter-turno .filter-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on'); renderTurno();
}
function renderTurno() {
  const p=document.getElementById('sel-turno').value;
  let rows=DATA.turno.filter(d=>{
    const mp=p?d.data?.slice(0,7)===p:true;
    const mt=FILTER_TURNO_TYPE?d.turno===FILTER_TURNO_TYPE:true;
    return mp&&mt;
  });
  const sorted=getSorted('turno',rows); updateSortIcons('turno');
  const totFat=rows.reduce((s,d)=>s+(Number(d.faturado)||0),0);
  const totCmd=rows.reduce((s,d)=>s+(Number(d.comandas)||0),0);
  const totPes=rows.reduce((s,d)=>s+(Number(d.pessoas)||0),0);
  const tkMed=totCmd>0?totFat/totCmd:0;
  document.getElementById('kpi-turno').innerHTML=`
    <div class="kpi"><div class="kpi-l">Faturamento Total</div><div class="kpi-v"><span class='hide-val'>${fmtBRL(totFat)}</span></div><div class="kpi-s">${rows.length} turnos</div></div>
    <div class="kpi"><div class="kpi-l">Total Comandas</div><div class="kpi-v">${fmtNum(totCmd)}</div><div class="kpi-s">no período</div></div>
    <div class="kpi"><div class="kpi-l">Total Pessoas</div><div class="kpi-v">${fmtNum(totPes)}</div><div class="kpi-s">no período</div></div>
    <div class="kpi gold"><div class="kpi-l">Ticket Médio</div><div class="kpi-v gold"><span class='hide-val'>${fmtBRL(tkMed)}</span></div><div class="kpi-s">por comanda</div></div>`;
  const tags={almoco:'tag-turno-almoco',jantar:'tag-turno-jantar',cafe:'tag-turno-cafe'};
  document.getElementById('body-turno').innerHTML=sorted.map(d=>`<tr>
    <td>${d.data||'—'}</td><td>${d.semana||'—'}</td>
    <td><span class="tag ${tags[d.turno]||''}">${d.turno||'—'}</span></td>
    <td>${d.usuario||'—'}</td>
    <td style="font-weight:500">${fmtBRL(d.faturado)}</td>
    <td>${fmtBRL(d.custo)}</td><td>${fmtBRL(d.servico)}</td>
    <td>${fmtNum(d.comandas)}</td><td>${fmtNum(d.pessoas)}</td><td>${fmtBRL(d.ticket_medio)}</td>
  </tr>`).join('');
  document.getElementById('badge-turno').textContent=`${rows.length} registros`;
  document.getElementById('footer-turno').innerHTML=`<span>${rows.length} turnos</span><span>Faturamento: <span class='hide-val'>${fmtBRL(totFat)}</span></span><span>Comandas: ${fmtNum(totCmd)}</span><span>Pessoas: ${fmtNum(totPes)}</span><span>Ticket: <span class='hide-val'>${fmtBRL(tkMed)}</span></span>`;
}

// ===== GRUPOS =====
function renderGrupos() {
  const p=document.getElementById('sel-grupos').value;
  let rows=p?DATA.grupos.filter(d=>d.periodo===p):DATA.grupos;
  let agg={};
  rows.forEach(d=>{
    if(!agg[d.nome]) agg[d.nome]={nome:d.nome,qtd:0,faturado:0,custo:0,margem_val:0};
    agg[d.nome].qtd+=Number(d.qtd)||0; agg[d.nome].faturado+=Number(d.faturado)||0;
    agg[d.nome].custo+=Number(d.custo)||0; agg[d.nome].margem_val+=Number(d.margem_val)||0;
  });
  let aggRows=Object.values(agg).map(d=>({...d,margem_pct:d.faturado>0?d.margem_val/d.faturado*100:0}));
  const sorted=getSorted('grupos',aggRows); updateSortIcons('grupos');
  const maxFat=Math.max(...aggRows.map(d=>d.faturado));
  const maxQtd=Math.max(...aggRows.map(d=>d.qtd));
  document.getElementById('chart-grupos-fat').innerHTML=sorted.slice(0,10).map(d=>`
    <div class="bar-row"><div class="bar-label" title="${d.nome}">${d.nome}</div>
    <div class="bar-track"><div class="bar-inner" style="width:${(d.faturado/maxFat*100).toFixed(1)}%"></div></div>
    <div class="bar-val">${fmtBRL(d.faturado)}</div></div>`).join('');
  document.getElementById('chart-grupos-qtd').innerHTML=sorted.slice(0,10).map(d=>`
    <div class="bar-row"><div class="bar-label" title="${d.nome}">${d.nome}</div>
    <div class="bar-track"><div class="bar-inner" style="width:${(d.qtd/maxQtd*100).toFixed(1)}%"></div></div>
    <div class="bar-val">${fmtNum(d.qtd)}</div></div>`).join('');
  document.getElementById('body-grupos').innerHTML=sorted.map(d=>`<tr>
    <td>${d.nome}</td><td>${fmtNum(d.qtd)}</td>
    <td style="font-weight:500">${fmtBRL(d.faturado)}</td>
    <td>${fmtBRL(d.custo)}</td><td>${fmtBRL(d.margem_val)}</td><td>${fmtPct(d.margem_pct)}</td>
  </tr>`).join('');
  const totFat=aggRows.reduce((s,d)=>s+d.faturado,0);
  document.getElementById('badge-grupos').textContent=`${aggRows.length} grupos`;
  document.getElementById('footer-grupos').innerHTML=`<span>${aggRows.length} grupos</span><span>Faturamento total: <span class='hide-val'>${fmtBRL(totFat)}</span></span>`;
}

// ===== HORÁRIO =====
function renderHorario() {
  const p=document.getElementById('sel-horario').value;
  let rows=p?DATA.horario.filter(d=>d.periodo===p):DATA.horario;
  let agg={};
  rows.forEach(d=>{const h=Number(d.hora);if(!agg[h])agg[h]={hora:h,faturado:0};agg[h].faturado+=Number(d.faturado)||0;});
  const aggRows=Object.values(agg).sort((a,b)=>a.hora-b.hora);
  const maxFat=Math.max(...aggRows.map(d=>d.faturado));
  document.getElementById('chart-horario').innerHTML=aggRows.map(d=>`
    <div class="bar-row"><div class="bar-label">${String(d.hora).padStart(2,'0')}:00</div>
    <div class="bar-track"><div class="bar-inner" style="width:${maxFat>0?(d.faturado/maxFat*100).toFixed(1):0}%"></div></div>
    <div class="bar-val">${fmtBRL(d.faturado)}</div></div>`).join('');
  document.getElementById('badge-horario').textContent=`${aggRows.length} horários`;
}

// ===== ATENDENTE =====
function renderAtendente() {
  const p=document.getElementById('sel-atendente').value;
  let rows=p?DATA.atendente.filter(d=>d.periodo===p):DATA.atendente;
  let agg={};
  rows.forEach(d=>{
    if(!agg[d.nome])agg[d.nome]={nome:d.nome,r_total:0,comandas:0,produtos:0,r_taxa:0,_cnt:0};
    agg[d.nome].r_total+=Number(d.r_total)||0; agg[d.nome].comandas+=Number(d.comandas)||0;
    agg[d.nome].produtos+=Number(d.produtos)||0; agg[d.nome].r_taxa+=Number(d.r_taxa)||0; agg[d.nome]._cnt++;
  });
  let aggRows=Object.values(agg).map(d=>({...d,ticket_medio:d.comandas>0?d.r_total/d.comandas:0}));
  const sorted=getSorted('atendente',aggRows); updateSortIcons('atendente');
  document.getElementById('body-atendente').innerHTML=sorted.map(d=>`<tr>
    <td>${d.nome}</td><td style="font-weight:500">${fmtBRL(d.r_total)}</td>
    <td>${fmtNum(d.comandas)}</td><td>${fmtNum(d.produtos)}</td>
    <td>${fmtBRL(d.ticket_medio)}</td><td>—</td><td>${fmtBRL(d.r_taxa)}</td>
  </tr>`).join('');
  const totFat=aggRows.reduce((s,d)=>s+d.r_total,0);
  document.getElementById('badge-atendente').textContent=`${aggRows.length} atendentes`;
  document.getElementById('footer-atendente').innerHTML=`<span>${aggRows.length} atendentes</span><span>Total: ${fmtBRL(totFat)}</span>`;
}

// ===== PRODUTOS =====
function renderProdutos() {
  const p=document.getElementById('sel-produtos').value;
  const search=document.getElementById('search-produtos').value.toLowerCase();
  let rows=p?DATA.produtos.filter(d=>d.periodo===p):DATA.produtos;
  let agg={};
  rows.forEach(d=>{
    if(!agg[d.nome])agg[d.nome]={nome:d.nome,qtd:0,faturado:0,custo:0,margem:0};
    agg[d.nome].qtd+=Number(d.qtd)||0; agg[d.nome].faturado+=Number(d.faturado)||0;
    agg[d.nome].custo+=Number(d.custo)||0; agg[d.nome].margem+=Number(d.margem)||0;
  });
  const totFat=Object.values(agg).reduce((s,d)=>s+d.faturado,0);
  let aggRows=Object.values(agg).map(d=>({...d,fat_pct:totFat>0?d.faturado/totFat*100:0}));
  if(search) aggRows=aggRows.filter(d=>d.nome.toLowerCase().includes(search));
  const sorted=getSorted('produtos',aggRows); updateSortIcons('produtos');
  const maxFat=Math.max(...sorted.map(d=>d.faturado));
  document.getElementById('body-produtos').innerHTML=sorted.map((d,i)=>`<tr class="${i<3?'highlight-gold':''}">
    <td style="text-align:center"><span class="rank-num ${i<3?'top3':''}">${i+1}</span></td>
    <td>${d.nome}</td><td>${fmtNum(d.qtd)}</td>
    <td style="font-weight:500">${fmtBRL(d.faturado)}</td><td>${fmtBRL(d.margem)}</td>
    <td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill ${i<3?'gold':''}" style="width:${maxFat>0?(d.faturado/maxFat*100).toFixed(1):0}%"></div></div><span class="pct-val">${fmtPct(d.fat_pct)}</span></div></td>
  </tr>`).join('');
  document.getElementById('badge-produtos').textContent=`${sorted.length} de ${aggRows.length} produtos`;
  document.getElementById('footer-produtos').innerHTML=`<span>${sorted.length} produtos</span><span>Faturamento: ${fmtBRL(totFat)}</span>`;
}


// ===== COMPARAR PERÍODOS =====
function daysBetween(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return Math.round((b - a) / 86400000) + 1;
}

function cmpLabel(de, ate, turno) {
  const t = turno ? ` · ${{'almoco':'Almoço','jantar':'Jantar','cafe':'Café'}[turno]}` : '';
  return de === ate ? `${de}${t}` : `${de} → ${ate}${t}`;
}

function cmpValidate() {
  const aD=document.getElementById('cmp-a-de').value;
  const aA=document.getElementById('cmp-a-ate').value;
  const bD=document.getElementById('cmp-b-de').value;
  const bA=document.getElementById('cmp-b-ate').value;
  const btn=document.getElementById('cmp-btn');
  const aviso=document.getElementById('cmp-aviso');

  const infoA=document.getElementById('cmp-a-info');
  const infoB=document.getElementById('cmp-b-info');

  if(aD && aA) {
    const dias = daysBetween(aD, aA);
    infoA.textContent = dias===1 ? '1 dia selecionado' : `${dias} dias selecionados`;
  }
  if(bD && bA) {
    const dias = daysBetween(bD, bA);
    infoB.textContent = dias===1 ? '1 dia selecionado' : `${dias} dias selecionados`;
  }

  if(!aD||!aA||!bD||!bA) { btn.style.opacity='.4'; btn.style.pointerEvents='none'; aviso.style.display='none'; return; }

  const diasA = daysBetween(aD,aA);
  const diasB = daysBetween(bD,bA);

  if(diasA !== diasB) {
    aviso.style.display='block';
    aviso.textContent = `⚠️ Os períodos têm quantidades de dias diferentes — Período A tem ${diasA} dia(s) e Período B tem ${diasB} dia(s). Ajuste para que ambos tenham o mesmo número de dias.`;
    btn.style.opacity='.4'; btn.style.pointerEvents='none';
    return;
  }

  aviso.style.display='none';
  btn.style.opacity='1'; btn.style.pointerEvents='auto';
}

function cmpGetData(de, ate, turno) {
  const rows = DATA.turno.filter(d => {
    const ok_data = d.data >= de && d.data <= ate;
    const ok_turno = turno ? d.turno === turno : true;
    return ok_data && ok_turno;
  });
  const fat  = rows.reduce((s,d)=>s+(Number(d.faturado)||0),0);
  const cmd  = rows.reduce((s,d)=>s+(Number(d.comandas)||0),0);
  const pess = rows.reduce((s,d)=>s+(Number(d.pessoas)||0),0);
  const tk   = cmd>0 ? fat/cmd : 0;

  // Por turno
  const byTurno={};
  rows.forEach(d=>{
    const t=d.turno||'outros';
    if(!byTurno[t]) byTurno[t]={fat:0,cmd:0};
    byTurno[t].fat+=Number(d.faturado)||0;
    byTurno[t].cmd+=Number(d.comandas)||0;
  });

  // Top 5 produtos — via ca_produtos filtrando pelos meses do período
  const MESES_TOP5=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  function ymToperiodo(ym) {
    const [y,m]=ym.split('-');
    return MESES_TOP5[parseInt(m)-1]+'/'+y.slice(2);
  }
  const mesesNoPeriodo = [...new Set(rows.map(d=>d.data?.slice(0,7)).filter(Boolean))].map(ymToperiodo);
  let aggP={};
  DATA.produtos.filter(d=>mesesNoPeriodo.includes(d.periodo)).forEach(d=>{
    if(!aggP[d.nome]) aggP[d.nome]={nome:d.nome,fat:0,qtd:0};
    aggP[d.nome].fat+=Number(d.faturado)||0;
    aggP[d.nome].qtd+=Number(d.qtd)||0;
  });
  const top5=Object.values(aggP).sort((a,b)=>b.fat-a.fat).slice(0,5);

  // Tabela diária
  const byDate={};
  rows.forEach(d=>{
    if(!byDate[d.data]) byDate[d.data]={data:d.data,fat:0,cmd:0,pess:0};
    byDate[d.data].fat+=Number(d.faturado)||0;
    byDate[d.data].cmd+=Number(d.comandas)||0;
    byDate[d.data].pess+=Number(d.pessoas)||0;
  });
  const dias=Object.values(byDate).sort((a,b)=>a.data.localeCompare(b.data));

  return {fat,cmd,pess,tk,byTurno,top5,dias};
}

function cmpRenderKpis(id, data, color) {
  const border = color==='gold' ? 'var(--gold)' : 'var(--dg)';
  const rpp = data.pess>0 ? data.fat/data.pess : 0;
  const ppc = data.cmd>0  ? data.pess/data.cmd : 0;
  document.getElementById(id).innerHTML=`
    <div class="kpi" style="border-top-color:${border}">
      <div class="kpi-l">Faturamento</div>
      <div class="kpi-v" style="font-size:17px"><span class="hide-val">${fmtBRL(data.fat)}</span></div>
    </div>
    <div class="kpi" style="border-top-color:${border}">
      <div class="kpi-l">Ticket Médio</div>
      <div class="kpi-v" style="font-size:17px"><span class="hide-val">${fmtBRL(data.tk)}</span></div>
    </div>
    <div class="kpi" style="border-top-color:${border}">
      <div class="kpi-l">Comandas</div>
      <div class="kpi-v" style="font-size:17px">${fmtNum(data.cmd)}</div>
    </div>
    <div class="kpi" style="border-top-color:${border}">
      <div class="kpi-l">Pessoas</div>
      <div class="kpi-v" style="font-size:17px">${fmtNum(data.pess)}</div>
    </div>
    <div class="kpi" style="border-top-color:${border};grid-column:span 1">
      <div class="kpi-l">R$ / Pessoa</div>
      <div class="kpi-v" style="font-size:17px"><span class="hide-val">${fmtBRL(rpp)}</span></div>
    </div>
    <div class="kpi" style="border-top-color:${border};grid-column:span 1">
      <div class="kpi-l">Pessoas / Cmd</div>
      <div class="kpi-v" style="font-size:17px">${ppc.toFixed(1)}</div>
    </div>`;
}

function cmpRenderTop5(id, top5, color) {
  const max = top5[0]?.fat||1;
  const accent = color==='gold' ? 'var(--gold)' : 'var(--dg)';
  document.getElementById(id).innerHTML = top5.map((p,i)=>`
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <div style="font-size:12px;font-weight:500;color:var(--ink);display:flex;gap:6px;align-items:center">
          <span style="font-size:10px;color:var(--ink3)">${i+1}</span>${p.nome}
        </div>
        <div class="hide-val" style="font-size:11px;color:var(--ink3);white-space:nowrap;margin-left:8px">${fmtBRL(p.fat)}</div>
      </div>
      <div style="height:5px;background:var(--b1);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${(p.fat/max*100).toFixed(1)}%;background:${accent};border-radius:3px"></div>
      </div>
    </div>`).join('');
}

function cmpRenderTurnos(id, byTurno) {
  const LABELS={'almoco':'Almoço','jantar':'Jantar','cafe':'Café'};
  const COLORS={'almoco':'#1E40AF','jantar':'#5B21B6','cafe':'#92400E'};
  const totFat=Object.values(byTurno).reduce((s,d)=>s+d.fat,0);
  document.getElementById(id).innerHTML=Object.entries(byTurno)
    .sort(([,a],[,b])=>b.fat-a.fat)
    .map(([t,d])=>`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:500;color:var(--ink);width:60px">${LABELS[t]||t}</div>
      <div style="flex:1;height:6px;background:var(--b1);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${totFat>0?(d.fat/totFat*100).toFixed(1):0}%;background:${COLORS[t]||'var(--dg)'};border-radius:3px"></div>
      </div>
      <div class="hide-val" style="font-size:11px;color:var(--ink3);white-space:nowrap">${fmtBRL(d.fat)} · ${fmtNum(d.cmd)} cmd</div>
    </div>`).join('');
}

function cmpRenderTabela(id, dias) {
  let html=`<thead><tr>
    <th style="text-align:left">Data</th>
    <th>Faturamento</th><th>Comandas</th><th>Pessoas</th><th>Ticket</th>
  </tr></thead><tbody>`;
  dias.forEach(d=>{
    const tk=d.cmd>0?d.fat/d.cmd:0;
    html+=`<tr>
      <td>${d.data}</td>
      <td><span class="hide-val">${fmtBRL(d.fat)}</span></td>
      <td>${fmtNum(d.cmd)}</td>
      <td>${fmtNum(d.pess)}</td>
      <td><span class="hide-val">${fmtBRL(tk)}</span></td>
    </tr>`;
  });
  html+=`</tbody>`;
  document.getElementById(id).innerHTML=html;
}

function cmpRenderDelta(dA, dB) {
  const metrics=[
    {label:'Faturamento', a:dA.fat,  b:dB.fat,  fmt:fmtBRL, money:true},
    {label:'Comandas',    a:dA.cmd,  b:dB.cmd,  fmt:fmtNum,  money:false},
    {label:'Pessoas',     a:dA.pess, b:dB.pess, fmt:fmtNum,  money:false},
    {label:'Ticket Médio',a:dA.tk,   b:dB.tk,   fmt:fmtBRL,  money:true},
    {label:'R$ / Pessoa', a:dA.pess>0?dA.fat/dA.pess:0, b:dB.pess>0?dB.fat/dB.pess:0, fmt:fmtBRL, money:true},
  ];
  document.getElementById('cmp-delta-row').innerHTML=metrics.map(m=>{
    const delta = m.a>0 ? (m.b-m.a)/m.a*100 : 0;
    const isUp  = delta > 0.05;
    const isDn  = delta < -0.05;
    const arrow = isUp ? '↑' : isDn ? '↓' : '→';
    const color = isUp ? '#059669' : isDn ? '#DC2626' : 'var(--ink3)';
    const bg    = isUp ? '#D1FAE5' : isDn ? '#FCE8E6' : 'var(--b1)';
    const sign  = isUp ? '+' : '';
    return `<div class="delta-card" style="border-top:3px solid ${color}">
      <div style="font-size:10px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${m.label}</div>
      <div style="font-size:22px;font-family:'Playfair Display',serif;font-weight:700;color:${color}">${arrow} ${sign}${delta.toFixed(1)}%</div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:6px;border-top:1px solid var(--b1)">
        <div style="font-size:10px;color:var(--ink3)">A: <span class="hide-val">${m.fmt(m.a)}</span></div>
        <div style="font-size:10px;color:var(--ink3)">B: <span class="hide-val">${m.fmt(m.b)}</span></div>
      </div>
    </div>`;
  }).join('');
}

function renderComparar() {
  const aD=document.getElementById('cmp-a-de').value;
  const aA=document.getElementById('cmp-a-ate').value;
  const bD=document.getElementById('cmp-b-de').value;
  const bA=document.getElementById('cmp-b-ate').value;
  const aTurno=document.getElementById('cmp-a-turno').value;
  const bTurno=document.getElementById('cmp-b-turno').value;

  const dA = cmpGetData(aD, aA, aTurno);
  const dB = cmpGetData(bD, bA, bTurno);

  const TLABELS={'almoco':'Almoço','jantar':'Jantar','cafe':'Café','':`Todos`};

  document.getElementById('cmp-a-header').textContent = cmpLabel(aD,aA,aTurno);
  document.getElementById('cmp-b-header').textContent = cmpLabel(bD,bA,bTurno);

  cmpRenderKpis('cmp-a-kpis', dA, 'green');
  cmpRenderKpis('cmp-b-kpis', dB, 'gold');
  cmpRenderTurnos('cmp-a-turnos', dA.byTurno);
  cmpRenderTurnos('cmp-b-turnos', dB.byTurno);
  cmpRenderAtendentes('cmp-a-atendentes', aD, aA, aTurno);
  cmpRenderAtendentes('cmp-b-atendentes', bD, bA, bTurno);
  cmpRenderTabela('cmp-a-tbl', dA.dias);
  cmpRenderTabela('cmp-b-tbl', dB.dias);
  cmpRenderDelta(dA, dB);

  document.getElementById('cmp-result').style.display='block';
  document.getElementById('cmp-result').scrollIntoView({behavior:'smooth',block:'start'});
}

function cmpRenderAtendentes(id, de, ate, turno) {
  const rows = DATA.turno.filter(d=>{
    return d.data>=de && d.data<=ate && (turno?d.turno===turno:true);
  });
  const byUser={};
  rows.forEach(d=>{
    const u=d.usuario||'—';
    if(!byUser[u]) byUser[u]={nome:u,fat:0,cmd:0};
    byUser[u].fat+=Number(d.faturado)||0;
    byUser[u].cmd+=Number(d.comandas)||0;
  });
  const sorted=Object.values(byUser).sort((a,b)=>b.fat-a.fat);
  const maxFat=sorted[0]?.fat||1;
  document.getElementById(id).innerHTML=sorted.map(d=>`
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <div style="font-size:12px;font-weight:500;color:var(--ink)">${d.nome}</div>
        <div style="font-size:11px;color:var(--ink3)">
          <span class="hide-val">${fmtBRL(d.fat)}</span> · ${fmtNum(d.cmd)} cmd
        </div>
      </div>
      <div style="height:5px;background:var(--b1);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${(d.fat/maxFat*100).toFixed(1)}%;background:var(--dg);border-radius:3px"></div>
      </div>
    </div>`).join('');
}

// ===== RANKING DETALHADO =====
function buildRankingData(periodo) {
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  let rows = periodo ? DATA.produtos.filter(d=>d.periodo===periodo) : DATA.produtos;

  // Agregar por produto
  let agg={};
  rows.forEach(d=>{
    if(!agg[d.nome]) agg[d.nome]={nome:d.nome,qtd:0,faturado:0,custo:0,margem:0,custo_pct:0,_cnt:0};
    agg[d.nome].qtd+=Number(d.qtd)||0;
    agg[d.nome].faturado+=Number(d.faturado)||0;
    agg[d.nome].custo+=Number(d.custo)||0;
    agg[d.nome].margem+=Number(d.margem)||0;
    agg[d.nome]._cnt++;
  });

  // Calcular tendência: comparar último mês disponível com o anterior
  const periodos=[...new Set(DATA.produtos.map(d=>d.periodo).filter(Boolean))].sort((a,b)=>{
    const [ma,ya]=a.split('/'); const [mb,yb]=b.split('/');
    return (Number(ya)-Number(yb))||(MESES.indexOf(ma)-MESES.indexOf(mb));
  });
  const lastP  = periodos[periodos.length-1];
  const prevP  = periodos[periodos.length-2];
  const lastMap={}, prevMap={};
  DATA.produtos.filter(d=>d.periodo===lastP).forEach(d=>{lastMap[d.nome]=(lastMap[d.nome]||0)+Number(d.faturado||0);});
  DATA.produtos.filter(d=>d.periodo===prevP).forEach(d=>{prevMap[d.nome]=(prevMap[d.nome]||0)+Number(d.faturado||0);});

  const totFat=Object.values(agg).reduce((s,d)=>s+d.faturado,0);

  return Object.values(agg).map(d=>{
    const tk = d.qtd>0?d.faturado/d.qtd:0;
    const cpct = d.faturado>0?d.custo/d.faturado*100:0;
    const fpct = totFat>0?d.faturado/totFat*100:0;
    const lv=lastMap[d.nome]||0, pv=prevMap[d.nome]||0;
    const trend = pv===0?0:((lv-pv)/pv*100);
    return {...d, ticket_medio:tk, custo_pct:cpct, fat_pct:fpct, trend, grupo:inferGrupo(d.nome,[]), tam:extractTam(d.nome)};
  });
}

function renderRanking() {
  const periodo = document.getElementById('sel-ranking').value;
  const grupo   = document.getElementById('sel-ranking-grupo').value;
  const tam     = document.getElementById('sel-ranking-tam').value;
  const search  = document.getElementById('search-ranking').value.toLowerCase();

  let rows = buildRankingData(periodo);

  // Filtros
  if(grupo) rows=rows.filter(d=>d.grupo===grupo);
  if(tam)   rows=rows.filter(d=>d.tam===tam);
  if(search) rows=rows.filter(d=>d.nome.toLowerCase().includes(search));

  const sorted=getSorted('ranking',rows).map((d,i)=>({...d,rank:i+1}));
  updateSortIcons('ranking');

  const totFat=rows.reduce((s,d)=>s+d.faturado,0);
  const totQtd=rows.reduce((s,d)=>s+d.qtd,0);
  const top3pct=sorted.slice(0,3).reduce((s,d)=>s+d.fat_pct,0);
  const tkMed=totQtd>0?totFat/totQtd:0;

  document.getElementById('kpi-ranking').innerHTML=`
    <div class="kpi"><div class="kpi-l">Faturamento</div><div class="kpi-v">${fmtBRL(totFat)}</div><div class="kpi-s">${rows.length} produtos</div></div>
    <div class="kpi"><div class="kpi-l">Unidades Vendidas</div><div class="kpi-v">${fmtNum(totQtd)}</div><div class="kpi-s">no período</div></div>
    <div class="kpi gold"><div class="kpi-l">Top 3 concentram</div><div class="kpi-v gold">${fmtPct(top3pct)}</div><div class="kpi-s">do faturamento</div></div>
    <div class="kpi"><div class="kpi-l">Ticket Médio</div><div class="kpi-v">${fmtBRL(tkMed)}</div><div class="kpi-s">por unidade</div></div>`;

  const maxFat=Math.max(...sorted.map(d=>d.faturado),1);
  const tamClass={
    '4P':'tam-4p','3P':'tam-3p','2P':'tam-2p','Ind.':'tam-ind','Exec.':'tam-ind','—':'tam-out'
  };
  const tamLabel={'4P':'4 Pessoas','3P':'3 Pessoas','2P':'2 Pessoas','Ind.':'Individual','Exec.':'Executivo','—':'Entrada'};

  document.getElementById('body-ranking').innerHTML=sorted.map(d=>{
    const isTop3=d.rank<=3;
    const trendHtml = d.trend>5?`<span class="trend-up">↑ ${d.trend.toFixed(0)}%</span>`
      : d.trend<-5?`<span class="trend-dn">↓ ${Math.abs(d.trend).toFixed(0)}%</span>`
      : `<span class="trend-eq">→ estável</span>`;
    return `<tr class="${isTop3?'highlight-gold':''}">
      <td style="text-align:center"><span class="rank-num ${isTop3?'top3':''}">${d.rank}</span></td>
      <td>${d.nome}</td>
      <td style="text-align:center;font-size:11px;color:var(--ink3)">${d.grupo}</td>
      <td style="text-align:center"><span class="tam-badge ${tamClass[d.tam]||'tam-out'}">${tamLabel[d.tam]||d.tam}</span></td>
      <td>${fmtNum(d.qtd)}</td>
      <td style="font-weight:500;color:var(--ink)">${fmtBRL(d.faturado)}</td>
      <td>R$ ${d.ticket_medio.toFixed(2)}</td>
      <td>${fmtBRL(d.margem)}</td>
      <td>${fmtPct(d.custo_pct)}</td>
      <td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill ${isTop3?'gold':''}" style="width:${(d.faturado/maxFat*100).toFixed(1)}%"></div></div><span class="pct-val">${fmtPct(d.fat_pct)}</span></div></td>
      <td>${trendHtml}</td>
    </tr>`;
  }).join('');

  document.getElementById('badge-ranking').textContent=`${sorted.length} de ${rows.length} produtos`;
  document.getElementById('footer-ranking').innerHTML=`<span>${sorted.length} produtos</span><span>Faturamento: ${fmtBRL(totFat)}</span><span>Qtd: ${fmtNum(totQtd)}</span><span>Top 3: ${fmtPct(top3pct)}</span><span>Ticket: ${fmtBRL(tkMed)}</span>`;
}

function populateRankingFilters() {
  // Grupos
  const grupos=[...new Set(DATA.produtos.map(d=>inferGrupo(d.nome,[])))].sort();
  document.getElementById('sel-ranking-grupo').innerHTML='<option value="">Todos os grupos</option>'+grupos.map(g=>`<option value="${g}">${g}</option>`).join('');
  // Tamanhos
  const tams=[...new Set(DATA.produtos.map(d=>extractTam(d.nome)))].sort();
  document.getElementById('sel-ranking-tam').innerHTML='<option value="">Todos os tamanhos</option>'+tams.map(t=>`<option value="${t}">${t}</option>`).join('');
}




// ===== NOTAS =====
let NOTAS = [];

async function loadNotas() {
  if (window.DEV_MODE) { NOTAS = (window.MOCK_DATA && window.MOCK_DATA.ca_notas) || []; return; }
  try {
    const r = await fetch(`/api/ca_notas`, { headers: window.authHeaders ? window.authHeaders() : {} });
    if (r.status === 401) { if (window.onAuthExpired) window.onAuthExpired(); NOTAS = []; return; }
    NOTAS = await r.json();
    if(!Array.isArray(NOTAS)) NOTAS = [];
  } catch(e) { NOTAS = []; }
}

function getNotas(contexto, periodo) {
  return NOTAS.filter(n => n.contexto === contexto && (n.periodo === periodo || n.periodo === 'geral') && n.ativo);
}

function renderNotasCards(notas) {
  if(!notas || notas.length === 0) return '';
  const icons = {destaque:'✨', alerta:'⚠️', aviso:'📌', observacao:'💬'};
  return `<div class="notas-wrap">
    ${notas.map(n=>`<div class="nota-card ${n.tag}">
      <span class="nota-icon">${icons[n.tag]||'💬'}</span>
      <div><div class="nota-periodo">${n.periodo}</div><div class="nota-texto">${n.texto}</div></div>
    </div>`).join('')}
  </div>`;
}

function renderNotasCeo() {
  // Notas gerais CEO
  const notasGerais = getNotas('ceo','geral');
  const elGeral = document.getElementById('notas-ceo-geral');
  if(elGeral) elGeral.innerHTML = renderNotasCards(notasGerais);

  // Notas por mês no gráfico CEO (tabela)
  // Inseridas dinamicamente ao renderizar a tabela
}

function renderNotasDiaSemana() {
  const notas = getNotas('diasemana','geral');
  const el = document.getElementById('notas-diasemana');
  if(el) el.innerHTML = renderNotasCards(notas);
}

function renderNotasAtendente() {
  const notas = getNotas('atendente','geral');
  const el = document.getElementById('notas-atendente');
  if(el) el.innerHTML = renderNotasCards(notas);
}

// ===== SUB-ABAS CEO =====
function showSubTab(tab, btn) {
  document.querySelectorAll('#sec-ceo .subtab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  ['evo-mensal','evo-semanal','evo-diasemana','evo-diaria'].forEach(id=>{
    const el = document.getElementById('sub-'+id);
    if(el) el.classList.remove('active');
  });
  const el = document.getElementById('sub-'+tab);
  if(el) el.classList.add('active');
}

let diariaChartInst=null, semanalChartInst=null, diasemanaChartInst=null;
let diariaYoyActive=false;

const DIAS_ORDER = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const DIAS_FULL  = {'Seg':'Segunda','Ter':'Terça','Qua':'Quarta','Qui':'Quinta','Sex':'Sexta','Sáb':'Sábado','Dom':'Domingo'};

function getWeekOfMonth(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return Math.ceil(d.getDate() / 7);
}

function populateSubPeriods() {
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const periods = [...new Set(DATA.turno.map(d=>d.data?.slice(0,7)).filter(Boolean))].sort().reverse();
  const opts = '<option value="">Todos os meses</option>' + periods.map(p=>{
    const [y,m]=p.split('-');
    return `<option value="${p}">${MESES[parseInt(m)-1]}/${y.slice(2)}</option>`;
  }).join('');
  ['sel-diaria','sel-semanal','sel-diasemana'].forEach(id=>{
    document.getElementById(id).innerHTML = opts;
  });
}

// ── DIÁRIA ──
function renderDiaria() {
  const periodo = document.getElementById('sel-diaria').value;
  let rows = periodo ? DATA.turno.filter(d=>d.data?.slice(0,7)===periodo) : DATA.turno;

  // Agregar por data
  const byDate={};
  rows.forEach(d=>{
    if(!byDate[d.data]) byDate[d.data]={data:d.data,fat:0};
    byDate[d.data].fat += Number(d.faturado)||0;
  });
  const sorted = Object.values(byDate).sort((a,b)=>a.data.localeCompare(b.data));
  const labels = sorted.map(d=>d.data.slice(5)); // MM-DD
  const data   = sorted.map(d=>d.fat);

  // YoY — buscar mesmo período 12 meses antes
  let yoyData = null;
  if(diariaYoyActive && periodo) {
    const [y,m] = periodo.split('-');
    const prevPeriodo = `${Number(y)-1}-${m}`;
    const prevRows = DATA.turno.filter(d=>d.data?.slice(0,7)===prevPeriodo);
    const prevByDate={};
    prevRows.forEach(d=>{
      const dayKey = d.data.slice(5);
      if(!prevByDate[dayKey]) prevByDate[dayKey]=0;
      prevByDate[dayKey] += Number(d.faturado)||0;
    });
    yoyData = labels.map(l=>prevByDate[l]||null);
  }

  if(diariaChartInst) diariaChartInst.destroy();
  const datasets = [{
    label:'Faturamento',
    data, backgroundColor:data.map(v=>v>0?'#1B4332CC':'transparent'),
    borderRadius:3, borderSkipped:false
  }];
  if(yoyData) datasets.push({
    type:'line', label:'Ano anterior',
    data:yoyData, borderColor:'#C0392B', backgroundColor:'#C9A84C22',
    fill:false, tension:.3, pointRadius:2, borderWidth:2, pointBackgroundColor:'#C0392B'
  });

  diariaChartInst = new Chart(document.getElementById('diariaChart'), {
    type:'bar', data:{labels, datasets},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:!!yoyData},
        tooltip:{callbacks:{label:ctx=>'R$ '+Number(ctx.raw||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}}
      },
      scales:{
        x:{ticks:{font:{size:9,family:'DM Sans'},maxRotation:45,autoSkip:true,maxTicksLimit:20},grid:{display:false}},
        y:{ticks:{font:{size:9,family:'DM Sans'},callback:v=>'R$'+Math.round(v/1000)+'k'},grid:{color:'rgba(0,0,0,0.04)'}}
      }
    }
  });

  // Cards YoY
  if(diariaYoyActive && periodo && yoyData) {
    const totAtual = data.reduce((s,v)=>s+(v||0),0);
    const totAnt   = yoyData.reduce((s,v)=>s+(v||0),0);
    const delta    = totAnt>0?(totAtual-totAnt)/totAnt*100:0;
    const col=delta>=0?'#1B7A3E':'#C0392B';
    const bg=delta>=0?'#D8F3DC':'#FCE8E6';
    document.getElementById('diaria-yoyCards').innerHTML=`
      <div style="background:${bg};border-radius:8px;padding:10px 16px;min-width:130px">
        <div style="font-size:10px;color:#7A7A72;font-weight:500;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Variação vs ano ant.</div>
        <div style="font-size:22px;font-weight:700;color:${col};font-family:'Playfair Display',serif">${delta>=0?'+':''}${delta.toFixed(1)}%</div>
        <div style="font-size:11px;color:var(--ink3);margin-top:4px">R$ ${totAtual.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0})} vs R$ ${totAnt.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
      </div>`;
    document.getElementById('diaria-yoyCards').style.display='flex';
  } else {
    document.getElementById('diaria-yoyCards').style.display='none';
  }
}

function toggleDiariaYoY() {
  diariaYoyActive=!diariaYoyActive;
  const btn=document.getElementById('diaria-yoyBtn');
  const leg=document.getElementById('diaria-yoyLegend');
  if(diariaYoyActive){
    btn.style.background='#C0392B'; btn.style.color='#fff'; btn.style.borderColor='#C0392B';
    leg.style.display='flex';
  } else {
    btn.style.background='transparent'; btn.style.color='var(--ink3)'; btn.style.borderColor='var(--b2)';
    leg.style.display='none';
    document.getElementById('diaria-yoyCards').style.display='none';
  }
  renderDiaria();
}

// ── SEMANAL ──
function renderSemanal() {
  const periodo = document.getElementById('sel-semanal').value;
  let rows = periodo ? DATA.turno.filter(d=>d.data?.slice(0,7)===periodo) : DATA.turno;

  // Agregar por semana do mês
  const bySemana={1:{fat:0,cmd:0,_cnt:0},2:{fat:0,cmd:0,_cnt:0},3:{fat:0,cmd:0,_cnt:0},4:{fat:0,cmd:0,_cnt:0}};
  const byDaySemana={};
  rows.forEach(d=>{
    const s=getWeekOfMonth(d.data);
    const k=Math.min(s,4);
    if(!bySemana[k]) bySemana[k]={fat:0,cmd:0,_cnt:0};
    bySemana[k].fat+=Number(d.faturado)||0;
    bySemana[k].cmd+=Number(d.comandas)||0;
    const ds=d.data;
    if(!byDaySemana[ds]) byDaySemana[ds]=0;
    byDaySemana[ds]+=Number(d.faturado)||0;
  });

  // Contar dias únicos por semana para média
  const diasPorSemana={1:new Set(),2:new Set(),3:new Set(),4:new Set()};
  rows.forEach(d=>{ const k=Math.min(getWeekOfMonth(d.data),4); diasPorSemana[k].add(d.data); });

  const semanas=['1ª Semana','2ª Semana','3ª Semana','4ª Semana'];
  const medias=semanas.map((_,i)=>{
    const k=i+1;
    const dias=diasPorSemana[k].size;
    return dias>0?bySemana[k].fat/dias:0;
  });
  const totais=semanas.map((_,i)=>bySemana[i+1].fat);
  const maxM=Math.max(...medias,1);

  if(semanalChartInst) semanalChartInst.destroy();
  semanalChartInst=new Chart(document.getElementById('semanalChart'),{
    type:'bar',
    data:{labels:semanas, datasets:[
      {label:'Média diária (R$)', data:medias, backgroundColor:['#1B4332CC','#2D6A4FCC','#52B788CC','#C9A84CCC'], borderRadius:6},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'Média: R$ '+Number(ctx.raw).toLocaleString('pt-BR',{minimumFractionDigits:2})}}},
      scales:{
        x:{ticks:{font:{size:11,family:'DM Sans'}},grid:{display:false}},
        y:{ticks:{font:{size:9,family:'DM Sans'},callback:v=>'R$'+Math.round(v/1000)+'k'},grid:{color:'rgba(0,0,0,0.04)'}}
      }
    }
  });

  // Tabela
  let html=`<thead><tr>
    <th style="text-align:left">Semana</th>
    <th>Total Faturado</th><th>Dias</th><th>Média/Dia</th>
  </tr></thead><tbody>`;
  semanas.forEach((s,i)=>{
    const k=i+1;
    const dias=diasPorSemana[k].size;
    const tot=bySemana[k].fat;
    const med=dias>0?tot/dias:0;
    html+=`<tr>
      <td>${s}</td>
      <td><span class="hide-val">R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></td>
      <td>${dias}</td>
      <td><span class="hide-val">R$ ${med.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></td>
    </tr>`;
  });
  html+=`</tbody>`;
  document.getElementById('semanal-tbl').innerHTML=html;
}

// ── DIA DA SEMANA ──
function renderDiaSemana() {
  const periodo = document.getElementById('sel-diasemana').value;
  let rows = periodo ? DATA.turno.filter(d=>d.data?.slice(0,7)===periodo) : DATA.turno;

  // Agregar por dia da semana
  const byDia={};
  DIAS_ORDER.forEach(d=>{ byDia[d]={fat:0,cmd:0,pess:0,_dias:new Set()}; });
  rows.forEach(d=>{
    const dia=d.semana;
    if(!byDia[dia]) return;
    byDia[dia].fat+=Number(d.faturado)||0;
    byDia[dia].cmd+=Number(d.comandas)||0;
    byDia[dia].pess+=Number(d.pessoas)||0;
    byDia[dia]._dias.add(d.data);
  });

  const medias=DIAS_ORDER.map(d=>{
    const dias=byDia[d]?._dias.size||1;
    return byDia[d]?byDia[d].fat/dias:0;
  });
  const maxM=Math.max(...medias,1);
  const PALETTE=['#1B7A3E','#145C2E','#40916C','#4CAF7D','#74C69D','#C0392B','#9A7530'];

  if(diasemanaChartInst) diasemanaChartInst.destroy();
  diasemanaChartInst=new Chart(document.getElementById('diasemanaChart'),{
    type:'bar',
    data:{labels:DIAS_ORDER.map(d=>DIAS_FULL[d]||d), datasets:[{
      data:medias, backgroundColor:PALETTE, borderRadius:6, borderSkipped:false
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'Média: R$ '+Number(ctx.raw).toLocaleString('pt-BR',{minimumFractionDigits:2})}}},
      scales:{
        x:{ticks:{font:{size:11,family:'DM Sans'}},grid:{display:false}},
        y:{ticks:{font:{size:9,family:'DM Sans'},callback:v=>'R$'+Math.round(v/1000)+'k'},grid:{color:'rgba(0,0,0,0.04)'}}
      }
    }
  });

  // Detalhe por turno × dia
  const byDiaTurno={};
  rows.forEach(d=>{
    const dia=d.semana; const t=d.turno;
    if(!dia||!t) return;
    if(!byDiaTurno[dia]) byDiaTurno[dia]={};
    if(!byDiaTurno[dia][t]) byDiaTurno[dia][t]={fat:0,_dias:new Set()};
    byDiaTurno[dia][t].fat+=Number(d.faturado)||0;
    byDiaTurno[dia][t]._dias.add(d.data);
  });

  const turnos=['almoco','jantar','cafe'];
  const turnoLabel={'almoco':'Almoço','jantar':'Jantar','cafe':'Café'};
  const turnoColor={'almoco':'#1B7A3E','jantar':'#5B21B6','cafe':'#92400E'};

  document.getElementById('diasemana-detalhe').innerHTML=DIAS_ORDER.map(dia=>{
    const row=byDiaTurno[dia]||{};
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:600;color:var(--ink);width:60px">${DIAS_FULL[dia]||dia}</div>
      <div style="flex:1;display:flex;gap:4px">
        ${turnos.map(t=>{
          const d=row[t]; if(!d) return '';
          const med=d._dias.size>0?d.fat/d._dias.size:0;
          return `<div style="background:${turnoColor[t]}18;border:1px solid ${turnoColor[t]}44;border-radius:6px;padding:3px 8px;font-size:10px;color:${turnoColor[t]};font-weight:500">
            ${turnoLabel[t]}: <span class="hide-val">R$${Math.round(med/1000)}k</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  // Ranking de dias
  const rankDias=DIAS_ORDER.map(d=>({dia:d,media:byDia[d]?byDia[d].fat/(byDia[d]._dias.size||1):0}))
    .sort((a,b)=>b.media-a.media);
  const maxR=rankDias[0]?.media||1;
  document.getElementById('diasemana-ranking').innerHTML=rankDias.map((d,i)=>`
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <div style="font-size:12px;font-weight:500;color:var(--ink);display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;color:var(--ink3);min-width:14px">${i+1}</span>${DIAS_FULL[d.dia]||d.dia}
        </div>
        <div class="hide-val" style="font-size:11px;color:var(--ink3)">R$ ${d.media.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0})}/dia</div>
      </div>
      <div style="height:6px;background:rgba(26,26,24,.07);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${(d.media/maxR*100).toFixed(1)}%;background:${i===0?'#C0392B':'#1B7A3E'};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`).join('');
}

function renderEvolucao() {
  populateSubPeriods();
  renderDiaria();
  renderSemanal();
  renderDiaSemana();
}

// ===== CEO =====
let CEO_D = [];
let ceoMainChartInst = null, ceoTkChartInst = null, ceoCpChartInst = null, ceoDonutInst = null;
let ceoCurKey = 'fat';
let ceoYoyActive = false;

const CEO_COLORS = { dg:'#1B7A3E', mg:'#145C2E', lg:'#4CAF7D', gold:'#C0392B', gray:'#A0A09A' };

function buildCeoData() {
  // Agregar ca_turno por mês
  const byMonth = {};
  DATA.turno.forEach(d => {
    const ym = d.data?.slice(0,7); if(!ym) return;
    if(!byMonth[ym]) byMonth[ym] = {fat:0,cmd:0,pess:0,_cnt:0};
    byMonth[ym].fat  += Number(d.faturado)||0;
    byMonth[ym].cmd  += Number(d.comandas)||0;
    byMonth[ym].pess += Number(d.pessoas)||0;
    byMonth[ym]._cnt++;
  });
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  CEO_D = Object.entries(byMonth)
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([ym,v]) => {
      const [y,mm] = ym.split('-');
      const m = MESES[parseInt(mm)-1]+'/'+y.slice(2);
      const tk = v.cmd>0 ? v.fat/v.cmd : 0;
      const isCurrentMonth = ym === new Date().toISOString().slice(0,7);
      const isPeak = m.startsWith('Dez');
      return { m, ym, fat:v.fat, cmd:v.cmd, pess:v.pess, tk, peak:isPeak, parcial:isCurrentMonth };
    });
}

function ceoBgFn() {
  return CEO_D.map(d => d.peak ? '#C0392B' : d.parcial ? CEO_COLORS.lg+'99' : CEO_COLORS.dg+'CC');
}

function ceoConfigs() {
  return {
    fat:  { data:CEO_D.map(d=>d.fat),  title:'Faturamento mensal — salão (R$)',       yFmt:v=>'R$'+Math.round(v/1000)+'k', ttFmt:v=>'R$ '+v.toLocaleString('pt-BR') },
    cmd:  { data:CEO_D.map(d=>d.cmd),  title:'Comandas mensais — salão',               yFmt:v=>v.toLocaleString('pt-BR'),   ttFmt:v=>v.toLocaleString('pt-BR')+' cmd' },
    tk:   { data:CEO_D.map(d=>d.tk),   title:'Ticket médio por comanda — salão (R$)',  yFmt:v=>'R$'+v.toFixed(0),           ttFmt:v=>'R$ '+v.toFixed(2) },
    pess: { data:CEO_D.map(d=>d.pess), title:'Pessoas no salão por mês',               yFmt:v=>v.toLocaleString('pt-BR'),   ttFmt:v=>v.toLocaleString('pt-BR')+' pess' },
  };
}

function initCeoCharts() {
  const labels = CEO_D.map(d=>d.m);
  const cfgs = ceoConfigs();

  if(ceoMainChartInst) ceoMainChartInst.destroy();
  ceoMainChartInst = new Chart(document.getElementById('ceoMainChart'), {
    type:'bar',
    data:{ labels, datasets:[
      { data:cfgs.fat.data, backgroundColor:ceoBgFn(), borderRadius:4, borderSkipped:false, yAxisID:'y' },
      { type:'line', data:Array(CEO_D.length).fill(null), borderColor:'#C0392B', backgroundColor:'#C039291A',
        fill:false, tension:.35, pointRadius:5, pointBackgroundColor:'#C0392B',
        pointBorderColor:'#fff', pointBorderWidth:2, borderWidth:2, yAxisID:'y2', hidden:true }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{
          if(ctx.datasetIndex===0) return cfgs[ceoCurKey].ttFmt(ctx.raw);
          if(ctx.raw===null) return null;
          return (ctx.raw>=0?'+':'')+ctx.raw.toFixed(1)+'% vs ano ant.';
        }}}
      },
      scales:{
        x:{ticks:{font:{size:10,family:'DM Sans'},maxRotation:45,autoSkip:false},grid:{display:false}},
        y:{ticks:{font:{size:10,family:'DM Sans'},callback:cfgs.fat.yFmt},grid:{color:'rgba(0,0,0,0.04)'}},
        y2:{position:'right',display:false,ticks:{font:{size:9,family:'DM Sans'},callback:v=>(v>=0?'+':'')+v.toFixed(0)+'%',color:'#C0392B'},grid:{drawOnChartArea:false}}
      }
    }
  });

  if(ceoTkChartInst) ceoTkChartInst.destroy();
  ceoTkChartInst = new Chart(document.getElementById('ceoTkChart'), {
    type:'line',
    data:{ labels, datasets:[{
      data:CEO_D.map(d=>d.tk), borderColor:'#C0392B', backgroundColor:'#C0392B'+'18',
      fill:true, tension:.35, pointRadius:CEO_D.map(d=>d.peak?7:3),
      pointBackgroundColor:CEO_D.map(d=>d.peak?'#C0392B':CEO_COLORS.dg),
      pointBorderColor:'#fff', pointBorderWidth:2
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'R$ '+ctx.raw.toFixed(2)}}},
      scales:{
        x:{ticks:{font:{size:9,family:'DM Sans'},maxRotation:45,autoSkip:false},grid:{display:false}},
        y:{ticks:{font:{size:9,family:'DM Sans'},callback:v=>'R$'+v.toFixed(0)},grid:{color:'rgba(0,0,0,0.04)'}}
      }
    }
  });

  if(ceoCpChartInst) ceoCpChartInst.destroy();
  ceoCpChartInst = new Chart(document.getElementById('ceoCpChart'), {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Comandas', data:CEO_D.map(d=>d.cmd),  backgroundColor:CEO_COLORS.dg+'CC', borderRadius:3 },
      { label:'Pessoas',  data:CEO_D.map(d=>d.pess), backgroundColor:CEO_COLORS.lg+'88', borderRadius:3 },
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{font:{size:9,family:'DM Sans'},maxRotation:45,autoSkip:false},grid:{display:false}},
        y:{ticks:{font:{size:9,family:'DM Sans'}},grid:{color:'rgba(0,0,0,0.04)'}}
      }
    }
  });
}

function ceoswitchMetric(key, btn) {
  document.querySelectorAll('#sec-ceo .ceo-mtab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  ceoCurKey = key;
  const cfgs = ceoConfigs();
  document.getElementById('ceo-mainTitle').textContent = cfgs[key].title;
  ceoMainChartInst.data.datasets[0].data = cfgs[key].data;
  ceoMainChartInst.data.datasets[0].backgroundColor = ceoBgFn();
  ceoMainChartInst.options.scales.y.ticks.callback = cfgs[key].yFmt;
  if(ceoYoyActive){ ceoToggleYoY(); ceoToggleYoY(); }
  ceoMainChartInst.update('active');
}

function ceoBuildYoY(key) {
  const data = ceoConfigs()[key].data;
  const result = Array(CEO_D.length).fill(null);
  for(let i=12;i<CEO_D.length;i++){
    const curr=data[i], prev=data[i-12];
    if(curr!=null&&prev!=null&&prev!==0) result[i]=(curr-prev)/prev*100;
  }
  return result;
}

function ceoToggleYoY() {
  ceoYoyActive = !ceoYoyActive;
  const btn=document.getElementById('ceo-yoyBtn');
  const leg=document.getElementById('ceo-yoyLegend');
  const cards=document.getElementById('ceo-yoyCards');
  if(ceoYoyActive){
    btn.style.background='#C0392B'; btn.style.color='#fff'; btn.style.borderColor='#C0392B';
    leg.style.display='flex';
    ceoMainChartInst.data.datasets[1].data=ceoBuildYoY(ceoCurKey);
    ceoMainChartInst.data.datasets[1].hidden=false;
    ceoMainChartInst.options.scales.y2.display=true;
    const yoyData=ceoBuildYoY(ceoCurKey);
    cards.style.display='flex';
    cards.innerHTML=CEO_D.slice(12).map((d,i)=>{
      const v=yoyData[12+i]; if(v===null) return '';
      const col=v>=0?'#1B7A3E':'#C0392B'; const bg=v>=0?'#D8F3DC':'#FCE8E6';
      return `<div style="background:${bg};border-radius:8px;padding:10px 16px;min-width:110px">
        <div style="font-size:10px;color:#7A7A72;font-weight:500;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${d.m}${d.parcial?' *':''}</div>
        <div style="font-size:20px;font-weight:700;color:${col};font-family:'Playfair Display',serif">${v>=0?'+':''}${v.toFixed(1)}%</div>
        <div style="font-size:10px;color:${col};margin-top:2px">vs ${CEO_D[i].m}</div>
      </div>`;
    }).join('');
  } else {
    btn.style.background='transparent'; btn.style.color='var(--ink3)'; btn.style.borderColor='var(--b2)';
    leg.style.display='none';
    ceoMainChartInst.data.datasets[1].hidden=true;
    ceoMainChartInst.options.scales.y2.display=false;
    cards.style.display='none'; cards.innerHTML='';
  }
  ceoMainChartInst.update('active');
}

function renderCeoKpis() {
  const clean = CEO_D.filter(d=>!d.parcial);
  const totFat=clean.reduce((s,d)=>s+d.fat,0);
  const totCmd=clean.reduce((s,d)=>s+d.cmd,0);
  const totPes=clean.reduce((s,d)=>s+d.pess,0);
  const n=clean.length;
  const tkMed=totCmd>0?totFat/totCmd:0;
  const tkFirst=clean[0]?.tk||0, tkLast=clean[clean.length-1]?.tk||0;
  const tkGrowth=tkFirst>0?(tkLast-tkFirst)/tkFirst*100:0;
  document.getElementById('ceo-kpis').innerHTML=`
    <div class="ceo-kpi"><div class="ceo-kpi-l">Ticket médio / comanda</div><div class="ceo-kpi-v"><span class='hide-val'>${fmtBRL(tkMed)}</span></div><div class="ceo-kpi-s">${n} meses completos · salão</div></div>
    <div class="ceo-kpi green"><div class="ceo-kpi-l">Comandas / mês</div><div class="ceo-kpi-v green">${fmtNum(Math.round(totCmd/n))}</div><div class="ceo-kpi-s">média meses completos</div></div>
    <div class="ceo-kpi"><div class="ceo-kpi-l">Pessoas / mês</div><div class="ceo-kpi-v">${fmtNum(Math.round(totPes/n))}</div><div class="ceo-kpi-s">${(totPes/totCmd).toFixed(1)} pessoas por comanda</div></div>
    <div class="ceo-kpi gold"><div class="ceo-kpi-l">Crescimento ticket</div><div class="ceo-kpi-v gold">${tkGrowth>=0?'+':''}${tkGrowth.toFixed(1)}%</div><div class="ceo-kpi-s">${fmtBRL(tkFirst)} → ${fmtBRL(tkLast)}</div></div>`;
}

function renderCeoTurnos() {
  const byTurno = {};
  DATA.turno.forEach(d=>{
    const t=d.turno||'outros';
    if(!byTurno[t])byTurno[t]={fat:0,cmd:0,pess:0};
    byTurno[t].fat+=Number(d.faturado)||0;
    byTurno[t].cmd+=Number(d.comandas)||0;
    byTurno[t].pess+=Number(d.pessoas)||0;
  });
  const totFat=Object.values(byTurno).reduce((s,d)=>s+d.fat,0);
  const turnoMap={almoco:'Almoço',jantar:'Jantar',cafe:'Café / outros'};
  const turnoClass={almoco:'almoco',jantar:'jantar',cafe:'cafe'};
  document.getElementById('ceo-turno-grid').innerHTML=['almoco','jantar','cafe'].map(t=>{
    const d=byTurno[t]||{fat:0,cmd:0,pess:0};
    const pct=totFat>0?d.fat/totFat*100:0;
    const tk=d.cmd>0?d.fat/d.cmd:0;
    const ppc=d.cmd>0?d.pess/d.cmd:0;
    const rpp=d.pess>0?d.fat/d.pess:0;
    const fatFmt=d.fat>=1000000?'R$ '+(d.fat/1000000).toFixed(2)+'M':'R$ '+(d.fat/1000).toFixed(0)+'k';
    return `<div class="turno-card ${turnoClass[t]}">
      <div class="turno-name">${turnoMap[t]}</div>
      <div class="turno-fat">${fatFmt}</div>
      <div class="turno-pct">${pct.toFixed(1)}% do faturamento · ${fmtNum(d.cmd)} cmd</div>
      <div class="turno-stat-row">
        <div><div class="tstat-l">Tk / comanda</div><div class="tstat-v">${fmtBRL(tk)}</div></div>
        <div><div class="tstat-l">P / comanda</div><div class="tstat-v">${ppc.toFixed(1)}</div></div>
        <div><div class="tstat-l">R$ / pessoa</div><div class="tstat-v">${fmtBRL(rpp)}</div></div>
      </div>
    </div>`;
  }).join('');
}

function renderCeoTable() {
  let html=`<thead><tr>
    <th style="text-align:left">Mês</th><th>Faturado</th><th>Comandas</th><th>Pessoas</th>
    <th>Tk / Cmd</th><th>R$ / Pessoa</th><th>P / Cmd</th>
  </tr></thead><tbody>`;
  CEO_D.forEach(d=>{
    const pp=d.pess>0?fmtBRL(d.fat/d.pess):'—';
    const pc=d.pess>0&&d.cmd>0?(d.pess/d.cmd).toFixed(1):'—';
    const cls=d.peak?'peak':d.parcial?'parcial':'';
    const bp=d.parcial?'<span class="ceo-badge parcial">parcial</span>':'';
    html+=`<tr class="${cls}">
      <td>${d.m}${bp}</td>
      <td>${fmtBRL(d.fat)}</td><td>${fmtNum(d.cmd)}</td><td>${fmtNum(d.pess)}</td>
      <td>${fmtBRL(d.tk)}</td><td>${pp}</td><td>${pc}</td>
    </tr>`;
  });
  const clean=CEO_D.filter(d=>!d.parcial);
  const sF=clean.reduce((s,d)=>s+d.fat,0),sC=clean.reduce((s,d)=>s+d.cmd,0),sP=clean.reduce((s,d)=>s+d.pess,0),n=clean.length;
  html+=`<tr class="avg-row">
    <td>Média (${n} meses)</td>
    <td>${fmtBRL(sF/n)}</td><td>${fmtNum(Math.round(sC/n))}</td><td>${fmtNum(Math.round(sP/n))}</td>
    <td>${fmtBRL(sF/sC)}</td><td>${fmtBRL(sF/sP)}</td><td>${(sP/sC).toFixed(1)}</td>
  </tr></tbody>`;
  document.getElementById('ceo-tbl').innerHTML=html;
}

function renderCeoRanking() {
  // Agregar ca_produtos — top 10
  let agg={};
  DATA.produtos.forEach(d=>{
    if(!agg[d.nome])agg[d.nome]={nome:d.nome,fat:0,qtd:0};
    agg[d.nome].fat+=Number(d.faturado)||0;
    agg[d.nome].qtd+=Number(d.qtd)||0;
  });
  const top10=Object.values(agg).sort((a,b)=>b.fat-a.fat).slice(0,10);
  const maxFat=top10[0]?.fat||1;
  document.getElementById('ceo-rankingBars').innerHTML=top10.map((p,i)=>{
    const barPct=(p.fat/maxFat*100).toFixed(1);
    const tk=p.qtd>0?p.fat/p.qtd:0;
    const accent=i<3?'#C0392B':CEO_COLORS.dg;
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
        <div style="font-size:12px;font-weight:500;color:var(--ink);display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;color:var(--ink3);min-width:14px">${i+1}</span>${p.nome}
        </div>
        <div style="font-size:11px;color:var(--ink3);white-space:nowrap;margin-left:8px">${fmtBRL(p.fat)} · ${fmtNum(p.qtd)} un.</div>
      </div>
      <div style="height:6px;background:rgba(26,26,24,.07);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${barPct}%;background:${accent};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`;
  }).join('');
}

function renderCeoDonut() {
  let agg={};
  DATA.grupos.forEach(d=>{
    if(!agg[d.nome])agg[d.nome]=0;
    agg[d.nome]+=Number(d.faturado)||0;
  });
  const sorted=Object.entries(agg).sort(([,a],[,b])=>b-a).slice(0,10);
  const totFat=sorted.reduce((s,[,v])=>s+v,0);
  const PALETTE=['#1B7A3E','#145C2E','#4CAF7D','#C0392B','#9A7530','#74C69D','#40916C','#D8F3DC','#B7E4C7','#95D5B2'];
  const labels=sorted.map(([n])=>n);
  const data=sorted.map(([,v])=>v);
  document.getElementById('ceo-donut-total').innerHTML=`<span class='hide-val'>${fmtBRL(totFat)}</span>`;
  document.getElementById('ceo-gruposLegend').innerHTML=sorted.map(([n,v],i)=>`
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0">
      <span style="width:8px;height:8px;border-radius:50%;background:${PALETTE[i]};flex-shrink:0"></span>
      <span style="color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n}</span>
      <span style="color:var(--ink3);margin-left:auto;white-space:nowrap">${(v/totFat*100).toFixed(1)}%</span>
    </div>`).join('');
  if(ceoDonutInst) ceoDonutInst.destroy();
  ceoDonutInst=new Chart(document.getElementById('ceoDonutChart'),{
    type:'doughnut',
    data:{labels,datasets:[{data,backgroundColor:PALETTE,borderWidth:2,borderColor:'#FAFAF8'}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${fmtBRL(ctx.raw)} (${(ctx.raw/totFat*100).toFixed(1)}%)`}}}
    }
  });
}

function renderCeo() {
  buildCeoData();
  renderCeoKpis();
  initCeoCharts();
  renderCeoTurnos();
  renderCeoTable();
  renderCeoRanking();
  renderCeoDonut();
  renderEvolucao();
}

// ===== COMANDAS =====
function renderComandas() {
  const p=document.getElementById('sel-comandas').value;
  let rows=p?DATA.comandas.filter(d=>d.periodo===p):DATA.comandas;
  let agg={};
  rows.forEach(d=>{
    if(!agg[d.nome])agg[d.nome]={nome:d.nome,qtd_pedidos:0,total:0};
    agg[d.nome].qtd_pedidos+=Number(d.qtd_pedidos)||0;
    agg[d.nome].total+=Number(d.total)||0;
  });
  const totFat=Object.values(agg).reduce((s,d)=>s+d.total,0);
  const totQtd=Object.values(agg).reduce((s,d)=>s+d.qtd_pedidos,0);
  let aggRows=Object.values(agg).map(d=>({...d,ticket_medio:d.qtd_pedidos>0?d.total/d.qtd_pedidos:0,participacao:totFat>0?d.total/totFat:0}));
  const sorted=getSorted('comandas',aggRows); updateSortIcons('comandas');
  const maxFat=Math.max(...aggRows.map(d=>d.total),1);
  const maxQtd=Math.max(...aggRows.map(d=>d.qtd_pedidos),1);
  document.getElementById('chart-comandas-fat').innerHTML=sorted.map(d=>`
    <div class="bar-row"><div class="bar-label">${d.nome}</div>
    <div class="bar-track"><div class="bar-inner" style="width:${(d.total/maxFat*100).toFixed(1)}%"></div></div>
    <div class="bar-val">${fmtBRL(d.total)}</div></div>`).join('');
  document.getElementById('chart-comandas-qtd').innerHTML=sorted.map(d=>`
    <div class="bar-row"><div class="bar-label">${d.nome}</div>
    <div class="bar-track"><div class="bar-inner" style="width:${(d.qtd_pedidos/maxQtd*100).toFixed(1)}%"></div></div>
    <div class="bar-val">${fmtNum(d.qtd_pedidos)}</div></div>`).join('');
  document.getElementById('body-comandas').innerHTML=sorted.map(d=>`<tr>
    <td>${d.nome}</td><td>${fmtNum(d.qtd_pedidos)}</td>
    <td style="font-weight:500">${fmtBRL(d.total)}</td>
    <td>${fmtBRL(d.ticket_medio)}</td><td>${fmtPct(d.participacao*100)}</td>
  </tr>`).join('');
  document.getElementById('badge-comandas').textContent=`${aggRows.length} canais`;
  document.getElementById('footer-comandas').innerHTML=`<span>${aggRows.length} canais</span><span>Total: <span class='hide-val'>${fmtBRL(totFat)}</span></span><span>Pedidos: ${fmtNum(totQtd)}</span>`;
}

function render(tab) {
  if(tab==='turno')    renderTurno();
  if(tab==='grupos')   renderGrupos();
  if(tab==='horario')  renderHorario();
  if(tab==='atendente')renderAtendente();
  if(tab==='produtos') renderProdutos();
  if(tab==='ranking')  renderRanking();
  if(tab==='ceo')      renderCeo();
  if(tab==='comparar')  { /* renderizado on-demand */ }
  if(tab==='comandas') renderComandas();
}

async function loadAll() {
  document.getElementById('hdrPeriodo').textContent='Atualizando...';
  await loadNotas();
  const [turno,grupos,horario,atendente,produtos,comandas]=await Promise.all([
    fetchAll('ca_turno'),fetchAll('ca_grupos'),fetchAll('ca_horario'),
    fetchAll('ca_atendente'),fetchAll('ca_produtos'),fetchAll('ca_comandas'),
  ]);
  DATA={turno,grupos,horario,atendente,produtos,comandas};

  populatePeriods('turno',DATA.turno,'data');
  populatePeriods('grupos',DATA.grupos);
  populatePeriods('horario',DATA.horario);
  populatePeriods('atendente',DATA.atendente);
  populatePeriods('produtos',DATA.produtos);
  populatePeriods('ranking',DATA.produtos);
  populatePeriods('comandas',DATA.comandas);
  populateRankingFilters();

  // Filtros de mês já abrem no mês corrente (se já existir dado pra ele).
  const curYM = currentMonthYM();
  const curLabel = currentMonthLabel();
  selectCurrentMonth('turno', curYM);
  selectCurrentMonth('grupos', curLabel);
  selectCurrentMonth('horario', curLabel);
  selectCurrentMonth('atendente', curLabel);
  selectCurrentMonth('produtos', curLabel);
  selectCurrentMonth('ranking', curLabel);
  selectCurrentMonth('comandas', curLabel);

  // Faturamento do topo = mês corrente até hoje, vindo de ca_comandas (não
  // ca_turno — esse só mede o Salão, e mede diferente do relatório "Tipos de
  // Comandas"). "Salão" é a linha "Mesa"; "Delivery" é a soma de tudo o mais,
  // com os nomes reais dos canais (iFood, Balcão, etc.) mostrados dinamicamente
  // — um canal novo aparece sozinho, sem precisar mexer no código.
  const comandasMes = DATA.comandas.filter(d => d.periodo === curLabel);
  const hoje = new Date();
  document.getElementById('hdrPeriodo').textContent=`${MESES_ABREV[hoje.getMonth()]} 1–${hoje.getDate()} · Fonte: iComanda`;

  if (comandasMes.length === 0) {
    document.getElementById('hdrBadge').innerHTML=`Faturamento (mês): sem dados ainda`;
    document.getElementById('hdrComandasBadge').innerHTML=`Aguardando import do mês`;
  } else {
    const totFatMes = comandasMes.reduce((s,d)=>s+(Number(d.total)||0),0);
    const salaoRows = comandasMes.filter(d => (d.nome||'').trim().toLowerCase()==='mesa');
    const deliveryRows = comandasMes.filter(d => (d.nome||'').trim().toLowerCase()!=='mesa');
    const salaoTotal = salaoRows.reduce((s,d)=>s+(Number(d.total)||0),0);
    const deliveryTotal = deliveryRows.reduce((s,d)=>s+(Number(d.total)||0),0);
    const canais = deliveryRows.map(d=>d.nome).join(', ');
    document.getElementById('hdrBadge').innerHTML=`Faturamento (mês): <span class='hide-val'>${fmtBRL(totFatMes)}</span>`;
    document.getElementById('hdrComandasBadge').innerHTML = deliveryRows.length
      ? `Salão: ${fmtBRLh(salaoTotal)} · Delivery: ${fmtBRLh(deliveryTotal)} (${canais})`
      : `Salão: ${fmtBRLh(salaoTotal)} · Delivery: sem dados ainda`;
  }

  renderTurno(); renderGrupos(); renderHorario();
  renderAtendente(); renderProdutos(); renderRanking(); renderCeo(); renderComandas();
  renderNotasCeo(); renderNotasDiaSemana(); renderNotasAtendente();
}

// loadAll() é chamado pelo auth.js, depois que o login (ou o modo desenvolvedor) é confirmado.

// ===== OCULTAR VALORES =====
let valuesHidden = false;
function toggleValues() {
  valuesHidden = !valuesHidden;
  document.body.classList.toggle('values-hidden', valuesHidden);
  document.getElementById('hideBtn').textContent = valuesHidden ? '👁 Mostrar valores' : '👁 Ocultar valores';
}
