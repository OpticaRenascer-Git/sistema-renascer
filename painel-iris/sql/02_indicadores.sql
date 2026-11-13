-- Painel Exame de Vista (Íris) · Indicadores
-- Só números agregados: nenhum nome, telefone ou CPF sai desta função.
-- Visualizador e administrador podem ver (login em 2 etapas obrigatório).
create or replace function public.painel_indicadores(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  dias int := least(greatest(coalesce(p_dias, 30), 1), 365);
  ini timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' - make_interval(days => dias - 1);
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  perform public.painel_exigir(false);
  with c as (
    select c.*,
      case
        when c.status_agendamento in ('confirmado','consulta_marcada','marcado') then 'marcada'
        when c.status_agendamento in ('aguardando_horarios','horarios_enviados','aguardando_confirmacao','fila_agendar','fila_horarios','remarcando') then 'andamento'
        when c.status_agendamento in ('cancelado') then 'cancelada'
        when c.status_agendamento in ('sem_vaga') then 'sem_vaga'
        when c.status_agendamento in ('consulta_passada') then 'passada'
        else 'novo' end as grupo
    from public.cliente_optica_exames c
    where coalesce(c.created_at, c.updated_at) >= ini
  ),
  todos as (select count(*) n from public.cliente_optica_exames),
  m as (
    select x.* from public.atendimento_mensagens x where x.criado_em >= ini
  )
  select jsonb_build_object(
    'dias', dias,
    'desde', (ini at time zone 'America/Sao_Paulo')::date,
    'clientes_total', (select n from todos),
    'clientes_periodo', (select count(*) from c),
    'marcadas', (select count(*) from c where grupo = 'marcada' or exame_realizado_em is not null),
    'realizadas', (select count(*) from c where exame_realizado_em is not null),
    'andamento', (select count(*) from c where grupo = 'andamento'),
    'sem_vaga', (select count(*) from c where grupo = 'sem_vaga'),
    'canceladas', (select count(*) from c where grupo = 'cancelada'),
    'com_equipe', (select count(*) from c where coalesce("Status", '') = 'Transferido'),
    'autorizaram', (select count(*) from c where autorizou_compartilhamento is true),
    'proximas', (select count(*) from public.cliente_optica_exames
                 where data_exame >= hoje and status_agendamento in ('confirmado','consulta_marcada','marcado')),
    'por_grupo', coalesce((select jsonb_object_agg(grupo, n) from (select grupo, count(*) n from c group by 1) g), '{}'),
    'por_origem', coalesce((select jsonb_object_agg(o, n) from (
        select coalesce(nullif(trim(origem_cadastro), ''), 'Não informado') o, count(*) n from c group by 1) g), '{}'),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d) from (
        select (coalesce(created_at, updated_at) at time zone 'America/Sao_Paulo')::date d, count(*) n from c group by 1) g), '[]'),
    'msgs_total', (select count(*) from m),
    'msgs_por_origem', coalesce((select jsonb_object_agg(origem, n) from (select origem, count(*) n from m group by 1) g), '{}'),
    'msgs_por_hora', coalesce((select jsonb_object_agg(h, n) from (
        select extract(hour from criado_em at time zone 'America/Sao_Paulo')::int h, count(*) n
        from m where origem = 'cliente' group by 1) g), '{}'),
    'consultas_por_dia_semana', coalesce((select jsonb_object_agg(w, n) from (
        select extract(isodow from data_exame)::int w, count(*) n from c
        where data_exame is not null and (grupo = 'marcada' or exame_realizado_em is not null) group by 1) g), '{}')
  ) into r;
  return r;
end $$;

revoke all on function public.painel_indicadores(int) from public, anon, authenticated;
grant execute on function public.painel_indicadores(int) to authenticated;
