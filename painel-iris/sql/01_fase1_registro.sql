-- Painel da Íris · 01 · Registro das conversas (Fase 1) e funções de leitura do painel
-- Projeto Supabase da Íris. NÃO altera a tabela cliente_optica_exames: só lê.
-- Cria 3 tabelas novas (autorizadas pelo proprietário em 13/11/2026):
--   atendimentos, atendimento_mensagens, atendimento_eventos
-- Segurança:
--   * As 3 tabelas ficam com RLS ligado e SEM políticas: ninguém lê direto pela API.
--   * O painel só lê por funções (RPC) que conferem o perfil do usuário e o login em 2 etapas (aal2).
--   * O perfil fica em app_metadata.papel ('administrador' | 'visualizador'), que só o servidor altera.
--   * CPF sempre mascarado; o CPF completo só sai pela função painel_cpf, para administrador, e fica registrado.
--   * O n8n grava pelas funções painel_registrar_*, executáveis só pelo papel postgres (credencial do n8n).
-- APLICAR SÓ COM A APROVAÇÃO DO PROPRIETÁRIO.

begin;

-- ---------- Tabelas ----------
create table if not exists public.atendimentos (
  id          uuid primary key default gen_random_uuid(),
  pessoa_id   text not null,                 -- id do cadastro (telefone, ou telefone-2, -3...)
  telefone    text not null,                 -- WhatsApp de quem escreve
  aberto_em   timestamptz not null default now(),
  fechado_em  timestamptz,
  resultado   text check (resultado in ('marcada','cancelada','sem_vaga','transferida','desistiu','realizada','faltou')),
  protocolo   text
);
create index if not exists atendimentos_pessoa_idx on public.atendimentos (pessoa_id, aberto_em desc);
create unique index if not exists atendimentos_um_aberto on public.atendimentos (pessoa_id) where fechado_em is null;

create table if not exists public.atendimento_mensagens (
  id             bigint generated always as identity primary key,
  atendimento_id uuid references public.atendimentos(id) on delete cascade,
  pessoa_id      text,
  telefone       text not null,
  origem         text not null check (origem in ('cliente','iris','clinica','equipe','sistema')),
  direcao        text not null check (direcao in ('entrada','saida')),
  tipo           text not null default 'texto' check (tipo in ('texto','audio','imagem','video','documento','outro')),
  texto          text,                       -- já com CPF mascarado
  wa_message_id  text unique,                -- id da mensagem no WhatsApp (evita duplicar)
  criado_em      timestamptz not null default now()
);
create index if not exists atendimento_mensagens_pessoa_idx on public.atendimento_mensagens (pessoa_id, criado_em);
create index if not exists atendimento_mensagens_atend_idx on public.atendimento_mensagens (atendimento_id, criado_em);

create table if not exists public.atendimento_eventos (
  id             bigint generated always as identity primary key,
  atendimento_id uuid references public.atendimentos(id) on delete cascade,
  pessoa_id      text,
  tipo           text not null,              -- status, transferido, confirmacao_enviada, beneficio_enviado, cpf_visto, usuario_convidado...
  detalhe        text,
  antes          jsonb,
  depois         jsonb,
  quem           text not null default 'sistema', -- 'iris', 'sistema' ou o e-mail do usuário do painel
  quem_id        uuid,
  criado_em      timestamptz not null default now()
);
create index if not exists atendimento_eventos_pessoa_idx on public.atendimento_eventos (pessoa_id, criado_em);
create index if not exists atendimento_eventos_data_idx on public.atendimento_eventos (criado_em desc);

alter table public.atendimentos          enable row level security;
alter table public.atendimento_mensagens enable row level security;
alter table public.atendimento_eventos   enable row level security;
revoke all on public.atendimentos, public.atendimento_mensagens, public.atendimento_eventos from anon, authenticated;

-- ---------- Auxiliares ----------
-- Mascara CPF em qualquer texto (123.456.789-01 ou 12345678901).
create or replace function public.painel_mascarar(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(t, ''), '\m\d{3}\.?\d{3}\.?\d{3}-?\d{2}\M', '***.***.***-**', 'g')
$$;

-- Perfil de quem chama, só com login em 2 etapas. Nulo = sem acesso.
-- O perfil é lido do cadastro do usuário (auth.users), não do token: mudar o perfil ou bloquear vale na hora.
create or replace function public.painel_papel() returns text
language sql stable security definer set search_path = '' as $$
  select u.raw_app_meta_data ->> 'papel'
  from auth.users u
  where u.id = auth.uid()
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and (u.banned_until is null or u.banned_until < now())
    and u.deleted_at is null
    and (u.raw_app_meta_data ->> 'papel') in ('administrador', 'visualizador')
$$;

create or replace function public.painel_exigir(p_admin boolean default false) returns text
language plpgsql stable set search_path = '' as $$
declare v text := public.painel_papel();
begin
  if v is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_admin and v <> 'administrador' then raise exception 'só administrador' using errcode = '42501'; end if;
  return v;
end $$;

-- ---------- Leitura do painel ----------
create or replace function public.painel_atendimentos(p_busca text default '', p_filtro text default 'todos', p_limite int default 200)
returns table (
  pessoa_id text, nome text, telefone text, status_agendamento text, transferido boolean,
  data_exame date, horario_exame time, atualizado_em timestamptz,
  ultima_msg text, ultima_msg_em timestamptz, ultima_origem text
)
language plpgsql stable security definer set search_path = '' as $$
declare b text := lower(trim(coalesce(p_busca, ''))); d text := regexp_replace(coalesce(p_busca, ''), '\D', '', 'g');
begin
  perform public.painel_exigir(false);
  return query
  select c.id, coalesce(nullif(c.nome_completo, ''), nullif(c.nome_exibicao, ''), c."Nome", 'Sem nome'),
         coalesce(nullif(c.telefone, ''), split_part(c.id, '-', 1)),
         c.status_agendamento, coalesce(c."Status", '') = 'Transferido',
         c.data_exame, c.horario_exame, c.updated_at,
         left(public.painel_mascarar(m.texto), 140), m.criado_em, m.origem
  from public.cliente_optica_exames c
  left join lateral (
    select x.texto, x.criado_em, x.origem from public.atendimento_mensagens x
    where x.pessoa_id = c.id order by x.criado_em desc limit 1
  ) m on true
  where (b = '' or lower(coalesce(c.nome_completo, '') || ' ' || coalesce(c.nome_exibicao, '') || ' ' || coalesce(c."Nome", '')) like '%' || b || '%'
                or (d <> '' and c.id like '%' || d || '%'))
    and case p_filtro
          when 'esperando' then c.status_agendamento in ('aguardando_horarios','horarios_enviados','aguardando_confirmacao','fila_agendar','fila_horarios','remarcando')
          when 'marcadas'  then c.status_agendamento in ('confirmado','consulta_marcada','marcado')
          when 'equipe'    then coalesce(c."Status", '') = 'Transferido'
          else true end
  order by coalesce(m.criado_em, c.updated_at) desc nulls last
  limit least(greatest(coalesce(p_limite, 200), 1), 500);
end $$;

create or replace function public.painel_ficha(p_pessoa text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.cliente_optica_exames; dig text;
begin
  perform public.painel_exigir(false);
  select * into r from public.cliente_optica_exames where id = p_pessoa;
  if not found then return null; end if;
  dig := regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g');
  return jsonb_build_object(
    'pessoa_id', r.id,
    'nome', coalesce(nullif(r.nome_completo, ''), nullif(r.nome_exibicao, ''), r."Nome"),
    'nome_whatsapp', r."Nome",
    'telefone', coalesce(nullif(r.telefone, ''), split_part(r.id, '-', 1)),
    'cpf', case when length(dig) = 11 then '***.***.' || substr(dig, 7, 3) || '-' || substr(dig, 10, 2) end,
    'tem_cpf', length(dig) = 11,
    'data_nascimento', r.data_nascimento,
    'email', r.email,
    'clinica', r.clinica,
    'data_exame', r.data_exame,
    'horario_exame', r.horario_exame,
    'status_agendamento', r.status_agendamento,
    'status_atendimento', r.status_atendimento,
    'transferido', coalesce(r."Status", '') = 'Transferido',
    'protocolo', r.protocolo_agendamento,
    'autorizou_compartilhamento', r.autorizou_compartilhamento,
    'confirmada_em', r.appointment_confirmed_at,
    'realizada_em', r.exame_realizado_em,
    'criado_em', r.created_at,
    'atualizado_em', r.updated_at,
    'pergunta_clinica', public.painel_mascarar(r.mensagem_inicial),
    'notas_clinica', public.painel_mascarar(r.observacoes),
    'pessoas', (select coalesce(jsonb_agg(jsonb_build_object('pessoa_id', o.id, 'nome', coalesce(nullif(o.nome_completo, ''), nullif(o.nome_exibicao, ''), o."Nome"))
                                         order by o.id), '[]'::jsonb)
                from public.cliente_optica_exames o where split_part(o.id, '-', 1) = split_part(r.id, '-', 1)),
    'atendimentos', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'aberto_em', a.aberto_em, 'fechado_em', a.fechado_em, 'resultado', a.resultado)
                                               order by a.aberto_em desc), '[]'::jsonb)
                     from public.atendimentos a where a.pessoa_id = r.id)
  );
end $$;

-- CPF completo: só administrador, e cada consulta fica registrada.
create or replace function public.painel_cpf(p_pessoa text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  perform public.painel_exigir(true);
  select cpf into v from public.cliente_optica_exames where id = p_pessoa;
  insert into public.atendimento_eventos (pessoa_id, tipo, detalhe, quem, quem_id)
  values (p_pessoa, 'cpf_visto', 'CPF completo exibido no painel', coalesce(auth.jwt() ->> 'email', '?'), auth.uid());
  return v;
end $$;

-- Linha do tempo: mensagens novas (com data e hora) + conversa anterior da memória da Íris (sem hora).
create or replace function public.painel_mensagens(p_pessoa text)
returns table (fonte text, origem text, tipo text, texto text, criado_em timestamptz, ordem bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.painel_exigir(false);
  return query
  select 'anterior'::text,
         case mm.message ->> 'type' when 'human' then 'cliente' when 'ai' then 'iris' else 'sistema' end,
         'texto'::text, public.painel_mascarar(mm.message ->> 'content'), null::timestamptz, mm.id::bigint
  from public.memory mm
  where mm.session_id = split_part(p_pessoa, '-', 1)
    and mm.message ->> 'type' in ('human', 'ai')
    and coalesce(mm.message ->> 'content', '') <> ''
  union all
  select 'registro'::text, m.origem, m.tipo, public.painel_mascarar(m.texto), m.criado_em, m.id
  from public.atendimento_mensagens m
  where m.pessoa_id = p_pessoa
  order by 1, 5 nulls first, 6;
end $$;

create or replace function public.painel_eventos(p_pessoa text)
returns table (tipo text, detalhe text, quem text, criado_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v text := public.painel_exigir(false);
begin
  return query
  select e.tipo, public.painel_mascarar(e.detalhe), e.quem, e.criado_em
  from public.atendimento_eventos e
  where e.pessoa_id = p_pessoa
    and (v = 'administrador' or e.tipo not in ('cpf_visto'))
  order by e.criado_em;
end $$;

-- Auditoria geral: só administrador.
create or replace function public.painel_auditoria(p_limite int default 200)
returns table (pessoa_id text, tipo text, detalhe text, quem text, criado_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.painel_exigir(true);
  return query
  select e.pessoa_id, e.tipo, public.painel_mascarar(e.detalhe), e.quem, e.criado_em
  from public.atendimento_eventos e
  where e.quem not in ('iris', 'sistema')
  order by e.criado_em desc
  limit least(greatest(coalesce(p_limite, 200), 1), 1000);
end $$;

-- ---------- Gravação (usada pelo n8n) ----------
create or replace function public.painel_atendimento_aberto(p_pessoa text, p_telefone text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.atendimentos where pessoa_id = p_pessoa and fechado_em is null;
  if v is null then
    insert into public.atendimentos (pessoa_id, telefone) values (p_pessoa, p_telefone)
    on conflict (pessoa_id) where fechado_em is null do nothing
    returning id into v;
    if v is null then select id into v from public.atendimentos where pessoa_id = p_pessoa and fechado_em is null; end if;
  end if;
  return v;
end $$;

create or replace function public.painel_registrar_mensagem(
  p_pessoa text, p_telefone text, p_origem text, p_direcao text,
  p_texto text, p_tipo text default 'texto', p_wa_id text default null
) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint; v_pessoa text := coalesce(nullif(p_pessoa, ''), p_telefone);
begin
  insert into public.atendimento_mensagens (atendimento_id, pessoa_id, telefone, origem, direcao, tipo, texto, wa_message_id)
  values (public.painel_atendimento_aberto(v_pessoa, p_telefone), v_pessoa, p_telefone, p_origem, p_direcao,
          coalesce(nullif(p_tipo, ''), 'texto'), public.painel_mascarar(p_texto), nullif(p_wa_id, ''))
  on conflict (wa_message_id) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.painel_registrar_evento(
  p_pessoa text, p_tipo text, p_detalhe text default null,
  p_antes jsonb default null, p_depois jsonb default null,
  p_quem text default 'sistema', p_fechar text default null
) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_at uuid; v_id bigint;
begin
  v_at := public.painel_atendimento_aberto(p_pessoa, split_part(p_pessoa, '-', 1));
  insert into public.atendimento_eventos (atendimento_id, pessoa_id, tipo, detalhe, antes, depois, quem)
  values (v_at, p_pessoa, p_tipo, public.painel_mascarar(p_detalhe), p_antes, p_depois, coalesce(p_quem, 'sistema'))
  returning id into v_id;
  if p_fechar is not null then
    update public.atendimentos set fechado_em = now(), resultado = p_fechar where id = v_at;
  end if;
  return v_id;
end $$;

-- ---------- Permissões das funções ----------
revoke all on function public.painel_mascarar(text), public.painel_papel(), public.painel_exigir(boolean),
  public.painel_atendimentos(text, text, int), public.painel_ficha(text), public.painel_cpf(text),
  public.painel_mensagens(text), public.painel_eventos(text), public.painel_auditoria(int),
  public.painel_atendimento_aberto(text, text),
  public.painel_registrar_mensagem(text, text, text, text, text, text, text),
  public.painel_registrar_evento(text, text, text, jsonb, jsonb, text, text)
from public, anon, authenticated;

grant execute on function public.painel_papel(), public.painel_exigir(boolean), public.painel_mascarar(text),
  public.painel_atendimentos(text, text, int), public.painel_ficha(text), public.painel_cpf(text),
  public.painel_mensagens(text), public.painel_eventos(text), public.painel_auditoria(int)
to authenticated;
-- painel_atendimento_aberto e painel_registrar_*: só o papel postgres (dono), usado pelo n8n.

commit;
