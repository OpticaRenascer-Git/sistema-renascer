-- Painel da Íris · 00 · Fecha a tabela "memory" (conversas da Íris) para a chave pública.
-- Hoje ela está SEM RLS: qualquer pessoa com a chave pública do projeto consegue ler as conversas.
-- O n8n grava pela credencial Postgres (dona da tabela), que não é afetada pelo RLS.
-- Reverter: alter table public.memory disable row level security;
-- APLICAR SÓ COM A APROVAÇÃO DO PROPRIETÁRIO.

alter table public.memory enable row level security;
revoke all on table public.memory from anon, authenticated;
