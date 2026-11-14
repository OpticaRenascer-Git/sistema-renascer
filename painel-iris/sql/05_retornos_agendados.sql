-- Fora do horário da clínica: a Íris anota quem quer marcar ou remarcar exame
-- e volta a falar com a pessoa na próxima abertura (workflow "Retorno na abertura da clínica").
create table if not exists public.retornos_agendados (
  id bigint generated always as identity primary key,
  telefone text not null,
  motivo text not null check (motivo in ('marcar', 'remarcar')),
  pedido_em timestamptz not null default now(),
  retornar_em timestamptz not null,
  enviado_em timestamptz,
  cancelado_em timestamptz
);
create unique index if not exists retornos_agendados_um_pendente
  on public.retornos_agendados (telefone) where enviado_em is null and cancelado_em is null;
alter table public.retornos_agendados enable row level security;
revoke all on public.retornos_agendados from anon, authenticated;

-- Retorno das 7h sem resposta: 1 lembrete 2h depois; 1h após o lembrete sem resposta, encerra.
alter table public.retornos_agendados
  add column if not exists lembrete_em timestamptz,
  add column if not exists finalizado_em timestamptz,
  add column if not exists resultado text;
