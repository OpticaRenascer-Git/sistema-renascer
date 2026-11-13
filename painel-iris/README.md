# Painel Exame de Vista (Íris)

Histórico e auditoria dos atendimentos da Íris (agente de WhatsApp da Óptica Renascer).
Fica separado do Sistema Renascer: usa o **Supabase da Íris** e tem login próprio.

- Página: `index.html` e `app.js`, sem etapa de build (como o Sistema Renascer).
- Publicação: GitHub Pages, no endereço `/painel-iris/` do site do repositório.
- A chave em `app.js` é a pública (publishable). Ela sozinha não abre dado nenhum.

## Segurança
- Login com senha **e** código de verificação no celular (2 etapas). Sem as 2 etapas, o banco não entrega nada.
- Dois perfis, guardados em `app_metadata.papel` (só o servidor altera): `administrador` e `visualizador`.
- As tabelas não são lidas direto: o painel só usa funções do banco (`painel_*`) que conferem o perfil a cada chamada.
- CPF sempre mascarado. O CPF completo só aparece para administrador, some depois de 30 s e fica registrado na auditoria.
- Esqueci a senha: link por e-mail (resposta igual exista ou não o e-mail, 1 pedido por minuto) e, ao abrir o link, o painel pede o código do celular antes de deixar trocar a senha. Ao salvar, os acessos em outros aparelhos são encerrados.
- Celular perdido: um administrador usa "Zerar código" na página Usuários. Se o único administrador perder o celular, zere o fator dele no Supabase (Authentication › Users).
- Sessão guardada só na aba (sessionStorage) e encerrada após 20 minutos parado.
- Política de segurança de conteúdo (CSP) limita a página ao próprio site, ao Supabase da Íris e ao CDN do supabase-js.

## Arquivos
| Arquivo | O que é |
|---|---|
| `sql/00_fechar_memory.sql` | Fecha a tabela `memory` (conversas) para a chave pública. Hoje ela está aberta |
| `sql/01_fase1_registro.sql` | Cria `atendimentos`, `atendimento_mensagens`, `atendimento_eventos` e as funções do painel e do n8n |
| `sql/03_gravacao.sql` | `painel_log` (os fluxos gravam cada mensagem), gatilho de eventos de status e corte da conversa anterior |
| `sql/02_indicadores.sql` | Função `painel_indicadores` (só números agregados, sem dado pessoal) |
| `supabase/functions/painel-usuarios` | Função do servidor para o administrador convidar, mudar perfil e bloquear usuários |

## Para colocar no ar (com aprovação do proprietário)
1. Rodar `sql/00_fechar_memory.sql` e `sql/01_fase1_registro.sql` no Supabase da Íris.
2. Publicar a função `painel-usuarios` com `PAINEL_ORIGEM` e `PAINEL_REDIRECT` apontando para o endereço do painel.
3. No Supabase (Authentication): desligar o cadastro aberto (só convite), ligar MFA TOTP e colocar o endereço do painel em Redirect URLs.
4. Convidar o proprietário e dar a ele o perfil `administrador` (uma vez, pelo SQL).
5. Gravação ligada em 13/11/2026: nós "Painel ·" nos fluxos da Íris e da clínica chamam `painel_log` (erros não param o fluxo).
