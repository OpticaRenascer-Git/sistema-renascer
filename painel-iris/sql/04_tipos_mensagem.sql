-- Painel Exame de Vista (Íris) · Tipos de mensagem
-- A lista antiga só aceitava texto/áudio/imagem/vídeo/documento/outro, então as mensagens
-- para a clínica ("para a clínica"), os avisos à loja e o lembrete do exame eram descartados.
-- Agora aceita esses tipos também. Nada é apagado.
alter table public.atendimento_mensagens drop constraint if exists atendimento_mensagens_tipo_check;
alter table public.atendimento_mensagens add constraint atendimento_mensagens_tipo_check
  check (tipo = any (array['texto','audio','imagem','video','documento','outro',
                           'para a clínica','aviso à loja','lembrete','lembrete não enviado']));
