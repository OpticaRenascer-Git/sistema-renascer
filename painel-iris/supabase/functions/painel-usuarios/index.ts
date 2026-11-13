// Painel da Íris · Edge Function "painel-usuarios"
// Só um ADMINISTRADOR com login em 2 etapas (aal2) pode usar.
// Ações: listar, convidar, mudar_papel, bloquear.
// O perfil fica em app_metadata.papel, que só o servidor consegue alterar.
// Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (automáticas no Supabase)
//            PAINEL_ORIGEM (endereço do site do painel, ex.: https://usuario.github.io)
//            PAINEL_REDIRECT (página para onde o convite leva, ex.: https://usuario.github.io/sistema-renascer/painel-iris/)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGEM = Deno.env.get('PAINEL_ORIGEM') ?? '';
const REDIRECT = Deno.env.get('PAINEL_REDIRECT') ?? undefined;
const PAPEIS = ['administrador', 'visualizador'];

const cors = (req: Request) => {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGEM && o === ORIGEM ? o : ORIGEM || 'null',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

const claims = (jwt: string) => {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { erro: 'método não permitido' }, 405);
  if (ORIGEM && req.headers.get('origin') !== ORIGEM) return json(req, { erro: 'origem não permitida' }, 403);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { erro: 'sem login' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Confere o login no servidor (não confia só no token decodificado).
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json(req, { erro: 'login inválido' }, 401);
  const c = claims(token);
  if (c.aal !== 'aal2') return json(req, { erro: 'falta o código de verificação' }, 403);
  if (u.user.app_metadata?.papel !== 'administrador') return json(req, { erro: 'só administrador' }, 403);
  if (u.user.banned_until && new Date(u.user.banned_until) > new Date()) return json(req, { erro: 'usuário bloqueado' }, 403);
  const eu_email = u.user.email ?? '?';

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json(req, { erro: 'pedido inválido' }, 400); }
  const acao = String(b.acao ?? '');

  const registrar = (tipo: string, detalhe: string) =>
    admin.from('atendimento_eventos').insert({ tipo, detalhe, quem: eu_email, quem_id: u.user.id });

  if (acao === 'listar') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return json(req, { erro: error.message }, 500);
    const lista = data.users.map((x) => ({
      id: x.id, email: x.email, nome: (x.user_metadata?.nome as string) ?? '',
      papel: (x.app_metadata?.papel as string) ?? null,
      bloqueado: !!x.banned_until && new Date(x.banned_until) > new Date(),
      ultimo_acesso: x.last_sign_in_at, convidado_em: x.invited_at, confirmado: !!x.email_confirmed_at,
    }));
    return json(req, { usuarios: lista });
  }

  if (acao === 'convidar') {
    const email = String(b.email ?? '').trim().toLowerCase();
    const nome = String(b.nome ?? '').trim().slice(0, 80);
    const papel = String(b.papel ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { erro: 'e-mail inválido' }, 400);
    if (!PAPEIS.includes(papel)) return json(req, { erro: 'perfil inválido' }, 400);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo: REDIRECT });
    if (error) return json(req, { erro: error.message }, 400);
    const { error: e2 } = await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { papel } });
    if (e2) return json(req, { erro: e2.message }, 500);
    await registrar('usuario_convidado', `${email} como ${papel}`);
    return json(req, { ok: true });
  }

  const id = String(b.id ?? '');
  if (!id) return json(req, { erro: 'usuário não informado' }, 400);
  if (id === u.user.id) return json(req, { erro: 'você não pode mudar o seu próprio acesso' }, 400);
  const { data: alvo, error: ea } = await admin.auth.admin.getUserById(id);
  if (ea || !alvo?.user) return json(req, { erro: 'usuário não encontrado' }, 404);

  if (acao === 'mudar_papel') {
    const papel = String(b.papel ?? '');
    if (!PAPEIS.includes(papel)) return json(req, { erro: 'perfil inválido' }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { app_metadata: { papel } });
    if (error) return json(req, { erro: error.message }, 500);
    // O banco lê o perfil direto do cadastro do usuário: a mudança vale na hora.
    await registrar('usuario_perfil', `${alvo.user.email}: ${alvo.user.app_metadata?.papel ?? 'sem perfil'} → ${papel}`);
    return json(req, { ok: true });
  }

  if (acao === 'bloquear') {
    const bloquear = b.bloquear === true;
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: bloquear ? '876000h' : 'none' });
    if (error) return json(req, { erro: error.message }, 500);
    await registrar(bloquear ? 'usuario_bloqueado' : 'usuario_liberado', String(alvo.user.email));
    return json(req, { ok: true });
  }

  return json(req, { erro: 'ação desconhecida' }, 400);
});
