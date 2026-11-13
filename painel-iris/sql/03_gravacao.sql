-- Painel Exame de Vista (Íris) · Gravação das conversas e dos eventos
-- 1) painel_log: os fluxos do n8n chamam com um JSON e a função descobre de qual cliente é a mensagem.
-- 2) Gatilho: toda mudança de status do agendamento ou passagem para a equipe vira um evento com data e hora.
-- 3) painel_mensagens: a "conversa anterior" (tabela memory) mostra só o que veio antes da gravação, sem repetir.
-- Nada aqui envia mensagem nem altera o atendimento. Qualquer erro é ignorado para nunca travar o fluxo.

create or replace function public.painel_log(p jsonb) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  hint   text := btrim(coalesce(p ->> 'pessoa', ''));
  para   text := coalesce(nullif(p ->> 'para', ''), 'cliente');
  origem text := case when p ->> 'origem' in ('cliente','iris','clinica','equipe','sistema') then p ->> 'origem' else 'sistema' end;
  direcao text := case when p ->> 'direcao' = 'entrada' then 'entrada' else 'saida' end;
  tipo   text := left(coalesce(nullif(p ->> 'tipo', ''), 'texto'), 30);
  txt    text := coalesce(p ->> 'texto', '');
  dig    text;
  v      text;
begin
  if btrim(txt) = '' then return null; end if;
  -- 1. A pessoa informada pelo fluxo (ex.: 5562999990000 ou 5562999990000-2)
  if hint <> '' then select c.id into v from public.cliente_optica_exames c where c.id = hint; end if;
  -- 2. Conversa com a clínica: o cliente que a clínica está atendendo agora (mesma regra do fluxo da clínica)
  if v is null and para = 'clinica' then
    select c.id into v from public.cliente_optica_exames c
    where c.status_agendamento in ('aguardando_horarios', 'aguardando_confirmacao') and c."Status" is distinct from 'Transferido'
    order by c.updated_at asc limit 1;
  end if;
  -- 3. Pelo número do WhatsApp: a pessoa daquele número com a conversa mais recente
  if v is null then
    dig := regexp_replace(case when hint <> '' then split_part(hint, '-', 1) when para = 'cliente' then coalesce(p ->> 'numero', '') else '' end, '\D', '', 'g');
    if length(dig) >= 10 then
      select c.id into v from public.cliente_optica_exames c
      where c.id = dig or c.id like dig || '-%' order by c.updated_at desc nulls last limit 1;
    end if;
  end if;
  if v is null then return null; end if;
  return public.painel_registrar_mensagem(v, split_part(v, '-', 1), origem, direcao, txt, tipo, nullif(p ->> 'wa_id', ''));
exception when others then
  return null;
end $$;

revoke all on function public.painel_log(jsonb) from public, anon, authenticated;

-- Eventos automáticos
create or replace function public.painel_trg_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.status_agendamento is distinct from old.status_agendamento and new.status_agendamento is not null then
      perform public.painel_registrar_evento(new.id, 'status', new.status_agendamento,
        jsonb_build_object('status', old.status_agendamento), jsonb_build_object('status', new.status_agendamento), 'sistema',
        case new.status_agendamento when 'cancelado' then 'cancelado' when 'consulta_passada' then 'consulta_passada' else null end);
    end if;
    if coalesce(new."Status", '') is distinct from coalesce(old."Status", '') then
      perform public.painel_registrar_evento(new.id,
        case when new."Status" = 'Transferido' then 'transferido' else 'devolvido_iris' end,
        null, null, null, 'sistema', null);
    end if;
  exception when others then
    null; -- o registro nunca impede a atualização do cadastro
  end;
  return new;
end $$;

revoke all on function public.painel_trg_status() from public, anon, authenticated;
drop trigger if exists painel_status on public.cliente_optica_exames;
create trigger painel_status after update on public.cliente_optica_exames
  for each row execute function public.painel_trg_status();

-- Conversa anterior: só as linhas da memória gravadas antes de ligar o registro.
do $do$
declare corte bigint;
begin
  select coalesce(max(id), 0) into corte from public.memory;
  execute format($f$
create or replace function public.painel_mensagens(p_pessoa text)
returns table (fonte text, origem text, tipo text, texto text, criado_em timestamptz, ordem bigint)
language plpgsql stable security definer set search_path = '' as $b$
begin
  perform public.painel_exigir(false);
  return query
  select 'anterior'::text,
         case mm.message ->> 'type' when 'human' then 'cliente' when 'ai' then 'iris' else 'sistema' end,
         'texto'::text, public.painel_mascarar(mm.message ->> 'content'), null::timestamptz, mm.id::bigint
  from public.memory mm
  where mm.session_id = split_part(p_pessoa, '-', 1)
    and mm.id <= %s
    and mm.message ->> 'type' in ('human', 'ai')
    and coalesce(mm.message ->> 'content', '') <> ''
  union all
  select 'registro'::text, m.origem, m.tipo, public.painel_mascarar(m.texto), m.criado_em, m.id
  from public.atendimento_mensagens m
  where m.pessoa_id = p_pessoa
  order by 1, 5 nulls first, 6;
end $b$;
$f$, corte);
end $do$;
