// Upload de export do iComanda direto pelo dashboard — mesma lógica do
// import-pipeline/index.js (CLI local), rodando aqui como Function.
// Dois passos, igual ao fluxo manual: "preview" só analisa e mostra o que
// seria gravado (nada é escrito); "turno-only"/"monthly" grava de verdade.
import { processWorkbook, MESES_ABREV } from '../_lib/xlsxImport.js';

async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

async function sbFetch(env, table, { method = 'GET', query = {}, body, headers = {} } = {}) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res;
}

// ca_turno tem 'caixa' como identificador único — upsert por on_conflict é
// seguro rodar toda semana, atualiza o que já existe e insere o resto.
async function upsertTurno(env, data) {
  if (!data.length) return;
  await sbFetch(env, 'ca_turno', {
    method: 'POST',
    query: { on_conflict: 'caixa' },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: data
  });
}

// Sem constraint UNIQUE nas tabelas agregadas por período — apaga e reinsere
// só os períodos presentes no arquivo, não toca no resto do histórico.
async function replaceForPeriods(env, table, data) {
  if (!data.length) return;
  const periodos = [...new Set(data.map(d => d.periodo).filter(Boolean))];
  if (periodos.length > 0) {
    await sbFetch(env, table, { method: 'DELETE', query: { periodo: `in.(${periodos.join(',')})` } });
  }
  await sbFetch(env, table, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: data });
}

function fmtBRL(v) {
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function previousLabelOf(label) {
  const [mes, ano] = label.split('/');
  let mi = MESES_ABREV.indexOf(mes) - 1;
  let anoNum = 2000 + parseInt(ano, 10);
  if (mi < 0) { mi = 11; anoNum -= 1; }
  return `${MESES_ABREV[mi]}/${String(anoNum).slice(2)}`;
}

async function generateNotas(env, periodoAtual) {
  const prevPeriodo = previousLabelOf(periodoAtual);
  const notas = [];

  const comandasAtualRes = await sbFetch(env, 'ca_comandas', { query: { select: 'total', periodo: `eq.${periodoAtual}` } });
  const comandasPrevRes = await sbFetch(env, 'ca_comandas', { query: { select: 'total', periodo: `eq.${prevPeriodo}` } });
  const comandasAtual = await comandasAtualRes.json();
  const comandasPrev = await comandasPrevRes.json();
  const totalAtual = comandasAtual.reduce((s, d) => s + (Number(d.total) || 0), 0);
  const totalPrev = comandasPrev.reduce((s, d) => s + (Number(d.total) || 0), 0);
  if (totalAtual > 0 && totalPrev > 0) {
    const delta = (totalAtual - totalPrev) / totalPrev * 100;
    notas.push({
      contexto: 'ceo', periodo: periodoAtual,
      tag: delta >= 0 ? 'destaque' : 'alerta',
      texto: `${delta >= 0 ? 'Crescimento' : 'Queda'} de ${Math.abs(delta).toFixed(1)}% em relação a ${prevPeriodo}. Faturamento ${fmtBRL(totalAtual)}.`,
      origem: 'auto', ativo: true
    });
  }

  const atendentesRes = await sbFetch(env, 'ca_atendente', { query: { select: 'nome,r_total,comandas', periodo: `eq.${periodoAtual}` } });
  const atendentesMes = await atendentesRes.json();
  if (atendentesMes.length > 0) {
    const top = [...atendentesMes].sort((a, b) => (Number(b.r_total) || 0) - (Number(a.r_total) || 0))[0];
    notas.push({
      contexto: 'atendente', periodo: periodoAtual, tag: 'destaque',
      texto: `${top.nome} lidera em faturamento no mês — ${fmtBRL(top.r_total)} em ${top.comandas} comandas.`,
      origem: 'auto', ativo: true
    });
  }

  const produtosRes = await sbFetch(env, 'ca_produtos', { query: { select: 'nome,faturado,qtd', periodo: `eq.${periodoAtual}` } });
  const produtosMes = await produtosRes.json();
  if (produtosMes.length > 0) {
    const top = [...produtosMes].sort((a, b) => (Number(b.faturado) || 0) - (Number(a.faturado) || 0))[0];
    notas.push({
      contexto: 'produtos', periodo: periodoAtual, tag: 'destaque',
      texto: `${top.nome} foi o produto mais vendido do mês — ${fmtBRL(top.faturado)} faturados em ${top.qtd} unidades.`,
      origem: 'auto', ativo: true
    });
  }

  if (notas.length === 0) return;

  await sbFetch(env, 'ca_notas', { method: 'DELETE', query: { periodo: `eq.${periodoAtual}`, origem: 'eq.auto' } });
  await sbFetch(env, 'ca_notas', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: notas });
}

async function logImport(env, { arquivo, modo, periodos, contagens, sucesso, erro }) {
  try {
    await sbFetch(env, 'ca_import_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { arquivo, modo, periodos, contagens, sucesso, erro: erro || null }
    });
  } catch (e) {
    // se o log falhar não deve derrubar a resposta — o import em si já rodou
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!(await verifyUser(request, env))) {
    return new Response(JSON.stringify({ error: 'Não autenticado' }), {
      status: 401, headers: { 'content-type': 'application/json' }
    });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Requisição inválida (esperado multipart/form-data)' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const file = form.get('file');
  const mode = form.get('mode'); // 'preview' | 'turno-only' | 'monthly'

  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }
  if (!['preview', 'turno-only', 'monthly'].includes(mode)) {
    return new Response(JSON.stringify({ error: 'Modo inválido' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = processWorkbook(buffer);
  } catch (e) {
    return new Response(JSON.stringify({ error: `Não consegui ler o arquivo: ${e.message}` }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const { turno, grupos, horario, atendente, produtos, comandas, periodos, contagens, sheetNames } = parsed;

  if (mode === 'preview') {
    const sample = (rows) => rows.slice(0, 3);
    return new Response(JSON.stringify({
      sheetNames, contagens, periodos,
      amostra: {
        ca_turno: sample(turno), ca_grupos: sample(grupos), ca_horario: sample(horario),
        ca_atendente: sample(atendente), ca_produtos: sample(produtos), ca_comandas: sample(comandas)
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  try {
    await upsertTurno(env, turno);
    await replaceForPeriods(env, 'ca_comandas', comandas);

    let notasGeradas = false;
    if (mode === 'monthly') {
      await replaceForPeriods(env, 'ca_grupos', grupos);
      await replaceForPeriods(env, 'ca_horario', horario);
      await replaceForPeriods(env, 'ca_atendente', atendente);
      await replaceForPeriods(env, 'ca_produtos', produtos);
      if (periodos.length === 1) {
        await generateNotas(env, periodos[0]);
        notasGeradas = true;
      }
    }

    await logImport(env, { arquivo: file.name, modo: mode, periodos, contagens, sucesso: true });

    return new Response(JSON.stringify({ ok: true, contagens, periodos, notasGeradas }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    await logImport(env, { arquivo: file.name, modo: mode, periodos, contagens, sucesso: false, erro: e.message });
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405, headers: { 'content-type': 'application/json', allow: 'POST' }
    });
  }
  return onRequestPost(context);
}
