// Proxy Supabase REST calls server-side so the client never sees the key.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are Cloudflare Pages secrets (set via
// `wrangler pages secret put`), not present anywhere in the deployed client bundle.

const ALLOWED_TABLES = new Set([
  'ca_turno', 'ca_grupos', 'ca_horario', 'ca_atendente',
  'ca_produtos', 'ca_comandas', 'ca_notas', 'ca_import_log', 'ca_resumo_caixa'
]);

const MAX_LIMIT = 10000;

// Confirma que o token enviado pelo navegador é uma sessão válida do Supabase Auth.
// Sem isso, a tela de login não protegeria nada — qualquer um poderia chamar
// /api/<tabela> direto, sem passar pelo login.
async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length);

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  return res.ok;
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const table = params.table;

  if (!ALLOWED_TABLES.has(table)) {
    return new Response(JSON.stringify({ error: 'Tabela não permitida' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  }

  if (!(await verifyUser(request, env))) {
    return new Response(JSON.stringify({ error: 'Não autenticado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }

  let query;
  if (table === 'ca_notas') {
    query = 'select=*&ativo=eq.true&limit=100';
  } else if (table === 'ca_import_log') {
    query = 'select=*&order=created_at.desc&limit=30';
  } else {
    const url = new URL(request.url);
    const requested = parseInt(url.searchParams.get('limit'), 10);
    const limit = Number.isFinite(requested) ? Math.min(requested, MAX_LIMIT) : MAX_LIMIT;
    query = `select=*&limit=${limit}`;
  }

  const upstream = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, max-age=15'
    }
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'GET' }
    });
  }
  return onRequestGet(context);
}
