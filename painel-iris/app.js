// Painel Exame de Vista (Íris) · histórico e auditoria dos atendimentos (Óptica Renascer)
// Banco: Supabase da Íris. A chave abaixo é a chave PÚBLICA (publishable): ela sozinha não abre dado nenhum.
// Quem protege os dados: login com código de verificação (2 etapas) + funções do banco que conferem o perfil.
// O painel saiu do GitHub Pages: quem abrir o endereço antigo vai para o endereço novo.
const ENDERECO_NOVO = 'https://painel-exame-de-vista.vercel.app/';
if (location.hostname.endsWith('github.io')) { location.replace(ENDERECO_NOVO); throw new Error('O painel mudou de endereço.'); }
const SUPABASE_URL = 'https://sxjtelptvwtbytythycc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G6EfiB9oi5LiMrjTT6FeHw_amjZhdvi';
const INATIVIDADE_MIN = 20; // sai sozinho depois de 20 minutos parado

// Link de convite ou de nova senha: guardado antes de o Supabase limpar o endereço.
const VEIO_DE_LINK = /type=(invite|recovery)/.test(location.hash + location.search);
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Sao_Paulo';
const fData = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fDia = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long' });
const quando = iso => { if (!iso) return ''; const d = new Date(iso); return `${fData.format(d)} ${fHora.format(d)}`; };
const dataBR = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const horaBR = t => t ? String(t).slice(0, 5).replace(':', 'h') : '';
const fone = v => { const d = String(v || '').replace(/\D/g, '').replace(/^55/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : esc(v); };

const STATUS = {
  pendente: ['Novo', 'muted'], aguardando_horarios: ['Pedindo horários à clínica', 'warn'], fila_horarios: ['Na fila da clínica', 'warn'],
  fila_agendar: ['Na fila da clínica', 'warn'], horarios_enviados: ['Opções enviadas ao cliente', 'warn'],
  aguardando_confirmacao: ['Aguardando confirmação da clínica', 'warn'], confirmado: ['Consulta marcada', 'ok'],
  consulta_marcada: ['Consulta marcada', 'ok'], marcado: ['Consulta marcada', 'ok'], remarcando: ['Remarcando', 'warn'],
  cancelado: ['Cancelado', 'bad'], sem_vaga: ['Clínica sem vaga', 'bad'], consulta_passada: ['Consulta já passou', 'muted']
};
const statusChip = (s, transferido) => {
  const [t, c] = STATUS[s] || [s ? s.replace(/_/g, ' ') : 'Sem status', 'muted'];
  return `<span class="chip ${c}">${esc(t)}</span>` + (transferido ? ' <span class="chip brand">Com a equipe</span>' : '');
};
const ORIGEM = { cliente: 'Cliente', iris: 'Íris', clinica: 'Clínica', equipe: 'Equipe da loja', sistema: 'Sistema' };
const EVENTO = {
  status: 'Status mudou', transferido: 'Passado para a equipe', devolvido_iris: 'Voltou para a Íris', confirmacao_enviada: 'Confirmação enviada',
  beneficio_enviado: 'Benefício enviado', lembrete_enviado: 'Lembrete enviado', cpf_visto: 'CPF completo visto',
  usuario_convidado: 'Usuário convidado', usuario_perfil: 'Perfil de usuário alterado',
  usuario_bloqueado: 'Usuário bloqueado', usuario_liberado: 'Usuário liberado',
  usuario_codigo_zerado: 'Código do celular zerado'
};

// Dados da clínica: os mesmos da mensagem de confirmação que a Íris envia ao cliente.
const CLINICA = { nome: 'Clínica Saúde', endereco: 'Praça do Santuário, nº 356, ao lado do Banco Itaú, Centro, Trindade-GO', valor: 'R$ 100,00, pagos diretamente na clínica no momento da consulta' };
const fSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long' });
const diaSemana = iso => { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return fSemana.format(d); };

const S = { tela: '', esperaAte: 0, criarSenha: VEIO_DE_LINK, session: null, papel: null, nome: '', mfa: null, erro: '', ok: '', cache: {} };
const isAdm = () => S.papel === 'administrador';

/* ---------------- Sessão, login e código de verificação ---------------- */
async function iniciar() {
  const { data } = await sb.auth.getSession();
  await aoMudarSessao(data.session);
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'TOKEN_REFRESHED') { S.session = session; return; }
    if (ev === 'PASSWORD_RECOVERY') S.criarSenha = true;
    if ((session?.access_token || null) !== (S.session?.access_token || null)) aoMudarSessao(session);
  });
  window.addEventListener('hashchange', rota);
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(e => document.addEventListener(e, mexeu, { passive: true }));
  setInterval(checaInatividade, 30000);
}
let ultimoMovimento = Date.now();
const mexeu = () => { ultimoMovimento = Date.now(); };
async function checaInatividade() {
  if (S.session && Date.now() - ultimoMovimento > INATIVIDADE_MIN * 60000) { S.erro = 'Você saiu por inatividade.'; await sb.auth.signOut(); }
}

async function aoMudarSessao(session) {
  S.session = session || null; S.papel = null; S.mfa = null; S.cache = {};
  if (S.session) {
    const u = S.session.user;
    S.nome = u.user_metadata?.nome || u.email;
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') {
      const { data: f } = await sb.auth.mfa.listFactors();
      const totp = (f?.totp || []).find(x => x.status === 'verified');
      S.mfa = totp ? { etapa: 'codigo', factorId: totp.id } : { etapa: 'cadastrar' };
    } else {
      S.papel = u.app_metadata?.papel || null;
    }
  }
  rota();
}

async function entrar() {
  const email = $('l-email').value.trim(), senha = $('l-senha').value;
  S.erro = ''; S.ok = '';
  if (!email || !senha) { S.erro = 'Preencha o e-mail e a senha.'; return rota(); }
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) { S.erro = 'E-mail ou senha não conferem.'; rota(); }
}
async function esqueci() {
  const email = ($('r-email').value || '').trim().toLowerCase();
  S.ok = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.erro = 'Digite o seu e-mail completo.'; return rota(); }
  if (Date.now() < S.esperaAte) { S.erro = 'Aguarde um minuto antes de pedir outro link.'; return rota(); }
  S.esperaAte = Date.now() + 60000;
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  // A resposta é sempre a mesma: não revela se o e-mail tem cadastro.
  S.erro = ''; S.ok = 'Pronto. Se este e-mail tiver acesso ao painel, chega em alguns minutos um link para criar uma nova senha. Olhe também no spam.'; rota();
}
async function cadastrarCodigo() {
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Painel da Íris' });
  if (error) { S.erro = 'Não consegui gerar o código: ' + error.message; return rota(); }
  S.mfa = { etapa: 'confirmar', factorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret }; rota();
}
async function confirmarCodigo() {
  const code = ($('m-codigo').value || '').replace(/\D/g, '');
  if (code.length !== 6) { S.erro = 'O código tem 6 números.'; return rota(); }
  const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: S.mfa.factorId });
  if (e1) { S.erro = e1.message; return rota(); }
  const { error } = await sb.auth.mfa.verify({ factorId: S.mfa.factorId, challengeId: ch.id, code });
  if (error) { S.erro = 'Código errado ou vencido. Tente o próximo.'; return rota(); }
  S.erro = ''; // a sessão nova (2 etapas) chega pelo onAuthStateChange
}
async function novaSenha() {
  const s1 = $('p-senha').value, s2 = $('p-senha2').value;
  if (s1.length < 10) { S.erro = 'Use pelo menos 10 caracteres.'; return rota(); }
  if (s1 !== s2) { S.erro = 'As duas senhas não são iguais.'; return rota(); }
  if (!/[A-Za-z]/.test(s1) || !/\d/.test(s1)) { S.erro = 'Use letras e números na senha.'; return rota(); }
  const { error } = await sb.auth.updateUser({ password: s1 });
  if (error) { S.erro = /same|different/i.test(error.message) ? 'A nova senha precisa ser diferente da anterior.' : error.message; return rota(); }
  await sb.auth.signOut({ scope: 'others' }); // encerra o acesso em outros aparelhos
  const eraConta = !S.criarSenha;
  S.criarSenha = false; S.erro = ''; S.ok = 'Senha salva. Se havia acesso aberto em outro aparelho, ele foi encerrado.';
  if (eraConta) return pConta();
  location.hash = '#/'; rota();
}

/* ---------------- Rotas ---------------- */
function rota() {
  const who = $('who'), main = $('main');
  const precisaSenha = S.criarSenha;
  if (!S.session) { who.innerHTML = ''; main.innerHTML = S.tela === 'esqueci' ? vEsqueci() : vLogin(); return; }
  who.innerHTML = `<a class="btn small" href="#/conta" title="Minha conta e senha">${esc(S.nome)}${S.papel ? ` · ${isAdm() ? 'Administrador' : 'Visualizador'}` : ''}</a><button class="btn small" data-act="sair">Sair</button>`;
  if (S.mfa) { main.innerHTML = vMfa(); return; }
  if (precisaSenha) { main.innerHTML = vSenha(); return; }
  if (!S.papel) { main.innerHTML = `<div class="login"><div class="panel"><h2>Sem acesso</h2><p class="hint">O seu usuário ainda não tem perfil no painel. Peça ao administrador.</p></div></div>`; return; }
  const [, pag, arg] = (location.hash.replace(/^#\/?/, '').split('?')[0].match(/^([^/]*)\/?(.*)$/) || []);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (!pag) return pInicio();
  if (pag === 'atendimentos') return pLista(q.get('f') || 'todos', q.get('b') || '');
  if (pag === 'atendimento' && arg) return pAtendimento(decodeURIComponent(arg));
  if (pag === 'usuarios' && isAdm()) return pUsuarios();
  if (pag === 'auditoria' && isAdm()) return pAuditoria();
  if (pag === 'indicadores') return pIndicadores(q.get('d') || '30');
  if (pag === 'conta') return pConta();
  location.hash = '#/';
}
// Barra fixa em todas as páginas: Voltar (página anterior) e Início, mais o caminho.
const crumbs = (...partes) => `<div class="navbar"><button class="btn small" data-act="voltar" aria-label="Voltar para a página anterior">← Voltar</button>
  <a class="btn small" href="#/" aria-label="Ir para o início">Início</a>
  <nav class="crumbs" aria-label="Caminho"><a href="#/">Início</a>${partes.map(p => ` › ${p}`).join('')}</nav></div>`;
const avisos = () => (S.erro ? `<div class="msg bad" role="alert">${esc(S.erro)}</div>` : '') + (S.ok ? `<div class="msg ok" role="status">${esc(S.ok)}</div>` : '');
const falha = e => { S.erro = /sem acesso|só administrador/.test(e?.message || '') ? 'Você não tem acesso a esta parte.' : 'Não consegui carregar: ' + (e?.message || 'erro'); };

function vLogin() {
  return `<div class="login"><div class="panel"><h2>Entrar</h2><p class="hint">Acesso só para a equipe autorizada da Óptica Renascer.</p>${avisos()}
    <label>E-mail<input id="l-email" type="email" autocomplete="username" inputmode="email"></label>
    <label>Senha<input id="l-senha" type="password" autocomplete="current-password"></label>
    <button class="btn primary" data-act="entrar">Entrar</button>
    <button class="btn small" data-act="tela-esqueci">Esqueci a senha</button></div></div>`;
}
function vEsqueci() {
  return `<div class="login"><div class="panel"><h2>Esqueci a senha</h2>${avisos()}
    <p class="hint">Digite o e-mail que você usa no painel. Vamos mandar um link para criar uma senha nova.</p>
    <p class="hint">Por segurança, depois de abrir o link o painel pede também o código de 6 números do aplicativo no seu celular. Sem o código, a senha não pode ser trocada.</p>
    <label>E-mail<input id="r-email" type="email" autocomplete="username" inputmode="email"></label>
    <button class="btn primary" data-act="esqueci">Enviar link</button>
    <button class="btn small" data-act="tela-login">← Voltar para entrar</button>
    <p class="hint">Perdeu ou trocou de celular? Peça a um administrador para zerar o seu código na página Usuários.</p></div></div>`;
}
function vMfa() {
  const m = S.mfa;
  if (m.etapa === 'cadastrar') return `<div class="login"><div class="panel"><h2>Proteja o seu acesso</h2>${avisos()}
    <p class="hint">Além da senha, o painel pede um código de 6 números que muda a cada 30 segundos. Instale no celular um aplicativo de autenticação (Google Authenticator ou Microsoft Authenticator) e toque em continuar.</p>
    <button class="btn primary" data-act="mfa-cadastrar">Continuar</button></div></div>`;
  if (m.etapa === 'confirmar') return `<div class="login"><div class="panel"><h2>Leia o código no aplicativo</h2>${avisos()}
    <p class="hint">No aplicativo de autenticação, toque em adicionar e aponte a câmera para o quadro abaixo. Depois digite os 6 números que aparecerem.</p>
    <div class="qr"><img alt="Código para o aplicativo de autenticação" src="${esc(m.qr)}"></div>
    <p class="hint">Sem câmera? Digite esta chave no aplicativo: <span class="mono">${esc(m.segredo)}</span></p>
    <label>Código de 6 números<input id="m-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
    <button class="btn primary" data-act="mfa-confirmar">Confirmar</button></div></div>`;
  return `<div class="login"><div class="panel"><h2>Código de verificação</h2>${avisos()}
    <p class="hint">${S.criarSenha ? 'Para criar a nova senha, primeiro confirme que é você: abra' : 'Abra'} o aplicativo de autenticação e digite os 6 números do painel.</p>
    <label>Código de 6 números<input id="m-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
    <button class="btn primary" data-act="mfa-confirmar">Entrar</button></div></div>`;
}
const formSenha = () => `<p class="hint">Mínimo 10 caracteres, com letras e números. Não use a mesma senha de outros sites.</p>
    <label>Nova senha<input id="p-senha" type="password" autocomplete="new-password"></label>
    <label>Repita a nova senha<input id="p-senha2" type="password" autocomplete="new-password"></label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-act="ver-senha" style="width:auto"> Mostrar a senha</label>
    <button class="btn primary" data-act="nova-senha">Salvar senha</button>`;
function vSenha() {
  return `<div class="login"><div class="panel"><h2>Criar nova senha</h2>${avisos()}${formSenha()}</div></div>`;
}
function pConta() {
  const u = S.session.user;
  $('main').innerHTML = `${crumbs('Minha conta')}${avisos()}<div class="login" style="margin-top:0"><div class="panel"><h2>Minha conta</h2>
    <dl class="kv"><dt>Nome</dt><dd>${esc(u.user_metadata?.nome || '')}</dd><dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Perfil</dt><dd>${isAdm() ? 'Administrador' : 'Visualizador'}</dd></dl>
    <h3>Trocar a senha</h3>${formSenha()}</div></div>`;
  S.erro = ''; S.ok = '';
}

/* ---------------- Início: botões ---------------- */
const ICON = {
  lista: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  relogio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>',
  pessoas: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.7.8 2.9 2.5 3.5 5.2"/></svg>',
  escudo: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/></svg>',
  grafico: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>'
};
async function pInicio() {
  const main = $('main');
  main.innerHTML = `${crumbs()}<p class="spin">Carregando...</p>`;
  const conta = async f => { const { data, error } = await sb.rpc('painel_atendimentos', { p_busca: '', p_filtro: f, p_limite: 500 }); return error ? '' : data.length; };
  const [esp, marc, eq] = await Promise.all([conta('esperando'), conta('marcadas'), conta('equipe')]);
  const card = (href, ic, titulo, txt, n, off) => `<a class="card${off ? ' off' : ''}" href="${href}">${ICON[ic]}${n !== '' && n != null ? `<span class="n">${n}</span>` : ''}<b>${titulo}</b><span>${txt}</span></a>`;
  main.innerHTML = `${crumbs()}${avisos()}<h1>Olá, ${esc(String(S.nome).split(/[ @]/)[0])}</h1><p class="hint" style="margin:6px 0 16px">Escolha o que quer ver.</p>
  <div class="menu">
    ${card('#/atendimentos', 'lista', 'Atendimentos', 'Todas as conversas, com busca por nome ou telefone')}
    ${card('#/atendimentos?f=esperando', 'relogio', 'Em andamento', 'Esperando a clínica ou a resposta do cliente', esp)}
    ${card('#/atendimentos?f=marcadas', 'ok', 'Consultas marcadas', 'Confirmadas pela clínica', marc)}
    ${card('#/atendimentos?f=equipe', 'chat', 'Com a equipe', 'Passados da Íris para a loja', eq)}
    ${isAdm() ? card('#/usuarios', 'pessoas', 'Usuários', 'Cadastrar, mudar perfil e bloquear') : ''}
    ${isAdm() ? card('#/auditoria', 'escudo', 'Auditoria', 'Quem fez o quê no painel') : ''}
    ${card('#/indicadores', 'grafico', 'Indicadores', 'Gráficos de atendimentos, consultas e origem dos clientes')}
  </div>`;
  S.erro = ''; S.ok = '';
}

/* ---------------- Lista de atendimentos ---------------- */
let buscaTimer;
async function pLista(filtro, busca) {
  const main = $('main');
  const F = [['todos', 'Todos'], ['esperando', 'Em andamento'], ['marcadas', 'Marcadas'], ['equipe', 'Com a equipe']];
  const link = (f, b) => `#/atendimentos?f=${f}${b ? '&b=' + encodeURIComponent(b) : ''}`;
  main.innerHTML = `${crumbs('Atendimentos')}<div class="panel"><div class="inline"><label>Buscar por nome ou telefone<input id="busca" type="search" value="${esc(busca)}" autocomplete="off"></label></div>
    <div class="filters" role="tablist">${F.map(([k, t]) => `<a role="tab" aria-selected="${k === filtro}" class="${k === filtro ? 'on' : ''}" href="${link(k, busca)}">${t}</a>`).join('')}</div>
    <div id="lista"><p class="spin">Carregando...</p></div></div>`;
  const inp = $('busca');
  inp.addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(() => { history.replaceState(null, '', link(filtro, inp.value.trim())); carregaLista(filtro, inp.value.trim()); }, 300); });
  if (busca) { inp.focus(); inp.setSelectionRange(busca.length, busca.length); }
  carregaLista(filtro, busca);
}
async function carregaLista(filtro, busca) {
  const { data, error } = await sb.rpc('painel_atendimentos', { p_busca: busca, p_filtro: filtro, p_limite: 300 });
  const el = $('lista'); if (!el) return;
  if (error) { falha(error); el.innerHTML = avisos(); S.erro = ''; return; }
  if (!data.length) { el.innerHTML = '<p class="empty">Nenhum atendimento encontrado.</p>'; return; }
  el.innerHTML = `<div class="rows">${data.map(r => `<a class="rowlink" href="#/atendimento/${encodeURIComponent(r.pessoa_id)}">
      <div><b>${esc(r.nome)}</b><small>${fone(r.telefone)}${r.pessoa_id.includes('-') ? ' · outra pessoa do mesmo WhatsApp' : ''}${r.data_exame ? ' · consulta ' + dataBR(r.data_exame) + (r.horario_exame ? ' às ' + horaBR(r.horario_exame) : '') : ''}</small></div>
      <div class="last">${r.ultima_msg ? `<b>${esc(ORIGEM[r.ultima_origem] || '')}:</b> ${esc(r.ultima_msg)}` : ''}<small>${esc(quando(r.ultima_msg_em || r.atualizado_em))}</small></div>
      <div>${statusChip(r.status_agendamento, r.transferido)}</div></a>`).join('')}</div>`;
}

/* ---------------- Um atendimento: linha do tempo + ficha ---------------- */
async function pAtendimento(id) {
  const main = $('main');
  main.innerHTML = `${crumbs('<a href="#/atendimentos">Atendimentos</a>', 'Atendimento')}<p class="spin">Carregando...</p>`;
  const [f, m, e] = await Promise.all([
    sb.rpc('painel_ficha', { p_pessoa: id }), sb.rpc('painel_mensagens', { p_pessoa: id }), sb.rpc('painel_eventos', { p_pessoa: id })
  ]);
  const err = f.error || m.error || e.error;
  if (err) { falha(err); main.innerHTML = crumbs('Atendimento') + avisos(); S.erro = ''; return; }
  const fi = f.data;
  if (!fi) { main.innerHTML = crumbs('Atendimento') + '<p class="empty">Atendimento não encontrado.</p>'; return; }
  S.cache.ficha = fi;
  main.innerHTML = `${crumbs('<a href="#/atendimentos">Atendimentos</a>', esc(fi.nome || 'Atendimento'))}
  <div class="split"><section class="panel" aria-label="Conversa"><div class="head" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h2>Conversa</h2>
    <div class="legend" id="legenda"></div></div>
    <p class="hint" style="margin:0">Toque num nome acima para ir até as mensagens dele. Cada toque leva para a próxima.</p>
    ${vLinha(m.data, e.data, fi)}</section>
  <aside class="ficha panel" aria-label="Ficha">${vFicha(fi)}</aside></div>`;
  S.pulo = {};
  const leg = $('legenda');
  leg.innerHTML = Object.entries(ORIGEM).map(([k, t]) => {
    const n = document.querySelectorAll(`.timeline .bub.${k}`).length;
    return `<button data-act="pular" data-o="${k}"${n ? '' : ' disabled'} aria-label="Ir para as mensagens de ${t} (${n})"><i style="background:var(--c-${k});border:1px solid var(--line)"></i>${t}<em>${n}</em></button>`;
  }).join('');
}
// Vai até a próxima mensagem daquela origem (cliente, Íris, clínica, equipe ou sistema).
function pular(o) {
  const lista = [...document.querySelectorAll(`.timeline .bub.${o}`)];
  if (!lista.length) return;
  const i = ((S.pulo[o] ?? -1) + 1) % lista.length; S.pulo[o] = i;
  const el = lista[i];
  const det = el.closest('details'); if (det) det.open = true;
  document.querySelectorAll('.bub.flash').forEach(x => x.classList.remove('flash'));
  el.classList.add('flash');
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  const b = document.querySelector(`[data-act="pular"][data-o="${o}"] em`); if (b) b.textContent = `${i + 1} de ${lista.length}`;
  setTimeout(() => el.classList.remove('flash'), 2500);
}
function vLinha(msgs, eventos, fi) {
  const ant = msgs.filter(x => x.fonte === 'anterior');
  const itens = [
    ...msgs.filter(x => x.fonte === 'registro').map(x => ({ k: 'm', t: x.criado_em, x })),
    ...eventos.map(x => ({ k: 'e', t: x.criado_em, x }))
  ].sort((a, b) => new Date(a.t) - new Date(b.t));
  let html = '';
  if (ant.length) {
    html += `<details${itens.length ? '' : ' open'}><summary class="hint" style="cursor:pointer">Conversa anterior ao registro (${ant.length} mensagens, sem data e hora)</summary><div class="timeline" style="margin-top:10px">`
      + ant.map(x => bolha(x.origem, x.texto, null)).join('') + '</div></details>';
  }
  if (fi.pergunta_clinica || fi.notas_clinica) {
    html += `<div class="note"><b>Conversa com a clínica (anotada antes do registro)</b>\n${esc([fi.pergunta_clinica, fi.notas_clinica].filter(Boolean).join('\n'))}</div>`;
  }
  if (!itens.length && !ant.length) return html + '<p class="empty">Ainda não há mensagens registradas para esta pessoa.</p>';
  let dia = '';
  html += '<div class="timeline">' + itens.map(it => {
    const d = fDia.format(new Date(it.t)); let pre = '';
    if (d !== dia) { dia = d; pre = `<span class="day">${esc(d)}</span>`; }
    if (it.k === 'm') return pre + bolha(it.x.origem, it.x.texto, it.t, it.x.tipo);
    const det = it.x.tipo === 'status' && STATUS[it.x.detalhe] ? STATUS[it.x.detalhe][0] : it.x.detalhe;
    return pre + bolha('sistema', `${EVENTO[it.x.tipo] || it.x.tipo}${det ? ': ' + det : ''}${it.x.quem && !['iris', 'sistema'].includes(it.x.quem) ? ' (por ' + it.x.quem + ')' : ''}`, it.t);
  }).join('') + '</div>';
  return html;
}
function bolha(origem, texto, t, tipo) {
  const o = ORIGEM[origem] ? origem : 'sistema';
  const extra = tipo && tipo !== 'texto' ? ` <span class="chip muted">${esc(tipo === 'audio' ? 'áudio transcrito' : tipo)}</span>` : '';
  return `<div class="bub ${o}"><div class="h"><b>${ORIGEM[o]}</b>${extra}${t ? `<time datetime="${esc(t)}">${esc(fHora.format(new Date(t)))}</time>` : ''}</div><p>${esc(texto)}</p></div>`;
}
function vFicha(fi) {
  const linha = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  const outras = (fi.pessoas || []).filter(p => p.pessoa_id !== fi.pessoa_id);
  return `<h2>${esc(fi.nome || 'Sem nome')}</h2><div>${statusChip(fi.status_agendamento, fi.transferido)}</div>
  ${vAgenda(fi)}
  <h3>Dados do cliente</h3>
  <dl class="kv">
    ${linha('WhatsApp', `<span class="nw">${fone(fi.telefone)}</span>`)}
    ${linha('Nome no WhatsApp', esc(fi.nome_whatsapp))}
    ${fi.tem_cpf ? `<dt>CPF</dt><dd><span class="mono" id="cpf">${esc(fi.cpf)}</span>${isAdm() ? ' <button class="btn small" data-act="ver-cpf">Mostrar</button>' : ''}</dd>` : '<dt>CPF</dt><dd class="hint">não informado</dd>'}
    ${linha('Nascimento', esc(dataBR(fi.data_nascimento)))}
    ${linha('E-mail', esc(fi.email))}
    ${linha('Autorizou envio', fi.autorizou_compartilhamento == null ? '' : fi.autorizou_compartilhamento ? 'Sim' : 'Não')}
    ${linha('Primeiro contato', esc(quando(fi.criado_em)))}
    ${linha('Última mudança', esc(quando(fi.atualizado_em)))}
  </dl>
  ${outras.length ? `<div><h3>Mesmo WhatsApp</h3><div class="rows">${outras.map(p => `<a class="rowlink" style="grid-template-columns:1fr" href="#/atendimento/${encodeURIComponent(p.pessoa_id)}"><b>${esc(p.nome || 'Sem nome')}</b></a>`).join('')}</div></div>` : ''}
  ${(fi.atendimentos || []).length ? `<div><h3>Atendimentos</h3><dl class="kv">${fi.atendimentos.map(a => `<dt>${esc(dataBR(a.aberto_em))}</dt><dd>${a.fechado_em ? esc(a.resultado || 'fechado') : '<span class="chip warn">aberto</span>'}</dd>`).join('')}</dl></div>` : ''}
  <div><h3>Ações</h3><div class="acoes">
    <button class="btn small" disabled>Responder</button><button class="btn small" disabled>Devolver para a Íris</button><button class="btn small" disabled>Reenviar confirmação</button></div>
    <p class="hint">Estes botões passam a funcionar quando o painel for ligado ao WhatsApp da Íris (próxima etapa, com a sua aprovação).</p></div>`;
}
// Quadro do agendamento: as mesmas informações que o cliente recebe na confirmação.
function vAgenda(fi) {
  if (!fi.data_exame) {
    return `<div class="agenda"><div class="topo-ag"><b>Agendamento</b></div><table><tr><td class="hint">Ainda sem consulta marcada.</td></tr></table></div>`;
  }
  const marcada = ['confirmado', 'consulta_marcada', 'marcado'].includes(fi.status_agendamento);
  const linhas = [
    ['Dia', `${esc(diaSemana(fi.data_exame))}, ${esc(dataBR(fi.data_exame))}`],
    ['Horário', fi.horario_exame ? esc(horaBR(fi.horario_exame)) : '<span class="hint">a definir</span>'],
    ['Local', esc(fi.clinica || CLINICA.nome)],
    ['Endereço', esc(CLINICA.endereco)],
    ['Valor', esc(CLINICA.valor)],
    ['Protocolo', esc(fi.protocolo)],
    ['Confirmada', esc(quando(fi.confirmada_em))],
    ['Realizada', esc(quando(fi.realizada_em))]
  ].filter(([, v]) => v);
  const msg = `Sua consulta foi confirmada.\n🗓️ Data: ${diaSemana(fi.data_exame)}, ${dataBR(fi.data_exame).slice(0, 5)}\n🕐 Horário: ${fi.horario_exame ? String(fi.horario_exame).slice(0, 5) : 'a definir'}\n🏥 Local: ${fi.clinica || CLINICA.nome}\n📍 ${CLINICA.endereco}\n💰 Valor: ${CLINICA.valor}.`;
  return `<div class="agenda"><div class="topo-ag"><b>Agendamento</b>${marcada ? '<span class="chip ok">Confirmado pela clínica</span>' : statusChip(fi.status_agendamento)}</div>
    <table>${linhas.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</table>
    ${marcada ? `<details style="padding:0 12px 10px"><summary class="hint" style="cursor:pointer">Ver a mensagem que o cliente recebeu</summary><div class="bub iris" style="margin-top:8px;max-width:100%"><p>${esc(msg)}</p></div></details>` : ''}</div>`;
}
async function verCpf() {
  const fi = S.cache.ficha; if (!fi) return;
  const { data, error } = await sb.rpc('painel_cpf', { p_pessoa: fi.pessoa_id });
  if (error) { falha(error); return rota(); }
  const d = String(data || '').replace(/\D/g, '');
  $('cpf').textContent = d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (data || '');
  setTimeout(() => { const el = $('cpf'); if (el) el.textContent = fi.cpf; }, 30000);
}

/* ---------------- Usuários (administrador) ---------------- */
async function funcUsuarios(corpo) {
  const { data, error } = await sb.functions.invoke('painel-usuarios', { body: corpo });
  if (error) {
    let msg = error.message; try { msg = (await error.context.json()).erro || msg; } catch (_) { /* resposta sem JSON */ }
    throw new Error(msg);
  }
  return data;
}
async function pUsuarios() {
  const main = $('main');
  main.innerHTML = `${crumbs('Usuários')}<p class="spin">Carregando...</p>`;
  let lista = [];
  try { lista = (await funcUsuarios({ acao: 'listar' })).usuarios || []; } catch (e) { S.erro = 'Não consegui listar: ' + e.message; }
  const meuId = S.session.user.id;
  main.innerHTML = `${crumbs('Usuários')}${avisos()}
  <div class="panel"><h2>Cadastrar usuário</h2><p class="hint">A pessoa recebe um e-mail para criar a senha. No primeiro acesso, o painel pede para ela ativar o código de verificação no celular.</p>
    <div class="inline"><label>Nome<input id="u-nome" autocomplete="off"></label><label>E-mail<input id="u-email" type="email" autocomplete="off"></label>
    <label>Perfil<select id="u-papel"><option value="visualizador">Visualizador (só vê)</option><option value="administrador">Administrador (vê tudo e faz ações)</option></select></label>
    <button class="btn primary" data-act="convidar">Enviar convite</button></div></div>
  <div class="panel" style="margin-top:14px"><h2>Usuários do painel</h2><div class="tw"><table class="t"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Último acesso</th><th></th></tr></thead><tbody>
  ${lista.map(u => `<tr><td>${esc(u.nome)}</td><td>${esc(u.email)}${u.confirmado ? '' : ' <span class="chip warn">convite pendente</span>'}</td>
    <td>${u.id === meuId ? 'Administrador (você)' : `<select data-papel="${esc(u.id)}" aria-label="Perfil de ${esc(u.email)}"><option value="visualizador"${u.papel === 'visualizador' ? ' selected' : ''}>Visualizador</option><option value="administrador"${u.papel === 'administrador' ? ' selected' : ''}>Administrador</option>${u.papel ? '' : '<option selected disabled>Sem perfil</option>'}</select>`}</td>
    <td>${esc(quando(u.ultimo_acesso)) || '<span class="hint">nunca</span>'}</td>
    <td>${u.id === meuId ? '' : `<button class="btn small" data-act="bloquear" data-id="${esc(u.id)}" data-b="${u.bloqueado ? '0' : '1'}">${u.bloqueado ? 'Liberar' : 'Bloquear'}</button>${u.tem_codigo ? ` <button class="btn small" data-act="zerar" data-id="${esc(u.id)}" title="Use quando a pessoa perder ou trocar de celular">Zerar código</button>` : ''}${u.bloqueado ? ' <span class="chip bad">bloqueado</span>' : ''}`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum usuário.</td></tr>'}
  </tbody></table></div></div>`;
  S.erro = ''; S.ok = '';
}
async function acaoUsuario(corpo, ok) {
  try { await funcUsuarios(corpo); S.ok = ok; } catch (e) { S.erro = e.message; }
  pUsuarios();
}

/* ---------------- Auditoria (administrador) ---------------- */
async function pAuditoria() {
  const main = $('main');
  main.innerHTML = `${crumbs('Auditoria')}<p class="spin">Carregando...</p>`;
  const { data, error } = await sb.rpc('painel_auditoria', { p_limite: 300 });
  if (error) { falha(error); main.innerHTML = crumbs('Auditoria') + avisos(); S.erro = ''; return; }
  main.innerHTML = `${crumbs('Auditoria')}<div class="panel"><h2>Ações feitas no painel</h2><p class="hint">Cada CPF mostrado, cada usuário cadastrado e cada envio feito pelo painel fica registrado aqui.</p>
  <div class="tw"><table class="t"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Atendimento</th></tr></thead><tbody>
  ${data.map(r => `<tr><td>${esc(quando(r.criado_em))}</td><td>${esc(r.quem)}</td><td>${esc(EVENTO[r.tipo] || r.tipo)}${r.detalhe ? ': ' + esc(r.detalhe) : ''}</td><td>${r.pessoa_id ? `<a href="#/atendimento/${encodeURIComponent(r.pessoa_id)}">abrir</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nada registrado ainda.</td></tr>'}
  </tbody></table></div></div>`;
}

/* ---------------- Indicadores (painel no estilo dashboard) ---------------- */
const DC = { laranja: '#F58220', amarelo: '#FFC20E', vermelho: '#F5525D', verde: '#2FBF71', azul: '#3BA0E6', roxo: '#9B7FE6', cinza: '#6B7785' };
const GRUPO = { marcada: ['Consulta marcada', DC.verde], andamento: ['Em andamento', DC.amarelo], novo: ['Só conversou', DC.cinza],
  sem_vaga: ['Clínica sem vaga', DC.vermelho], cancelada: ['Cancelada', DC.roxo], passada: ['Consulta já passou', DC.azul] };
const COR_ORIGEM = { cliente: DC.azul, iris: DC.laranja, clinica: DC.verde, equipe: DC.amarelo, sistema: DC.roxo };
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
const nf = n => new Intl.NumberFormat('pt-BR').format(n || 0);
const DICON = {
  pessoas: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.7.8 2.9 2.5 3.5 5.2"/></svg>',
  agenda: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>',
  taxa: '<svg viewBox="0 0 24 24"><path d="M5 19L19 5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>',
  olho: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  relogio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};
// Rosca em SVG com o total no meio
function rosca(itens, total, rotulo) {
  const R = 52, C = 2 * Math.PI * R; let acc = 0;
  const arcos = itens.filter(x => x.n).map(x => { const L = (x.n / (total || 1)) * C; const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${x.c}" stroke-width="20" stroke-dasharray="${L} ${C - L}" stroke-dashoffset="${-acc}" transform="rotate(-90 70 70)"><title>${esc(x.t)}: ${x.n}</title></circle>`; acc += L; return s; }).join('');
  return `<div class="d-rosca"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(rotulo)}"><circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--d-line)" stroke-width="20"/>${arcos}
    <text x="70" y="68" text-anchor="middle" class="d-big">${nf(total)}</text><text x="70" y="86" text-anchor="middle" class="d-small">${esc(rotulo)}</text></svg>
    <ul>${itens.filter(x => x.n).map(x => `<li><i style="background:${x.c}"></i><span>${esc(x.t)}</span><b>${nf(x.n)}</b><em>${pct(x.n, total)}%</em></li>`).join('') || '<li class="d-vazio">Sem dados no período.</li>'}</ul></div>`;
}
// Barras horizontais com valor
function dBarras(lista, cor) {
  const mx = Math.max(1, ...lista.map(x => x[1]));
  return lista.length ? `<div class="d-hbar">${lista.map(([t, n, c]) => `<span>${esc(t)}</span><div><i style="width:${Math.max(2, (n / mx) * 100)}%;background:${c || cor || DC.laranja}"><b>${nf(n)}</b></i></div>`).join('')}</div>` : '<p class="d-vazio">Ainda sem dados.</p>';
}
// Linha do tempo com média e valor em cada ponto
function dLinha(serie) {
  if (!serie.length) return '<p class="d-vazio">Ainda sem dados.</p>';
  const W = window.innerWidth < 640 ? 360 : 640, H = window.innerWidth < 640 ? 260 : 230, pl = 18, pr = 18, pt = 30, pb = 34;
  const mx = Math.max(1, ...serie.map(x => x[1]));
  const media = serie.reduce((s, x) => s + x[1], 0) / serie.length;
  const X = i => serie.length === 1 ? W / 2 : pl + (i * (W - pl - pr)) / (serie.length - 1);
  const Y = v => pt + (1 - v / mx) * (H - pt - pb);
  const pts = serie.map((x, i) => `${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ');
  const area = `${X(0).toFixed(1)},${H - pb} ${pts} ${X(serie.length - 1).toFixed(1)},${H - pb}`;
  const passoRot = Math.ceil(serie.length / 12), passoVal = serie.length > 16 ? Math.ceil(serie.length / 16) : 1;
  return `<svg class="d-linha" viewBox="0 0 ${W} ${H}" role="img" aria-label="Clientes ao longo do tempo">
    <defs><linearGradient id="dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${DC.laranja}" stop-opacity=".35"/><stop offset="1" stop-color="${DC.laranja}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="var(--d-line)"/>
    <polygon points="${area}" fill="url(#dg)"/>
    <line x1="${pl}" x2="${W - pr}" y1="${Y(media)}" y2="${Y(media)}" stroke="${DC.amarelo}" stroke-dasharray="5 5" opacity=".8"/>
    <text x="${W - pr}" y="${Y(media) - 6}" text-anchor="end" class="d-media">Média: ${media.toFixed(1).replace('.', ',')}</text>
    <polyline points="${pts}" fill="none" stroke="${DC.laranja}" stroke-width="2.5" stroke-linejoin="round"/>
    ${serie.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[1])}" r="${serie.length > 40 ? 2 : 4}" fill="var(--d-card)" stroke="${DC.laranja}" stroke-width="2"><title>${esc(x[0])}: ${x[1]}</title></circle>
      ${i % passoVal === 0 ? `<text x="${X(i)}" y="${Y(x[1]) - 9}" text-anchor="middle" class="d-val">${x[1]}</text>` : ''}
      ${i % passoRot === 0 ? `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" class="d-eixo">${esc(x[0])}</text>` : ''}`).join('')}
  </svg>`;
}
// Agrupa os dias: até 31 dias por dia, 90 dias por semana, 1 ano por mês
function serieTempo(porDia, dias) {
  const mapa = Object.fromEntries((porDia || []).map(x => [x.d, x.n]));
  const isoDe = t => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(t);
  const lista = []; for (let i = dias - 1; i >= 0; i--) { const iso = isoDe(new Date(Date.now() - i * 864e5)); lista.push([iso, mapa[iso] || 0]); }
  if (dias <= 31) return lista.map(([iso, n]) => [dataBR(iso).slice(0, 5), n]);
  if (dias <= 120) { const out = []; for (let i = 0; i < lista.length; i += 7) { const g = lista.slice(i, i + 7); out.push([dataBR(g[0][0]).slice(0, 5), g.reduce((s, x) => s + x[1], 0)]); } return out; }
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const porMes = new Map(); lista.forEach(([iso, n]) => { const k = iso.slice(0, 7); porMes.set(k, (porMes.get(k) || 0) + n); });
  return [...porMes].map(([k, n]) => [MES[+k.slice(5, 7) - 1] + '/' + k.slice(2, 4), n]);
}
async function pIndicadores(d) {
  const main = $('main');
  const dias = ['7', '30', '90', '365'].includes(d) ? d : '30';
  main.innerHTML = `${crumbs('Indicadores')}<p class="spin">Carregando...</p>`;
  const { data: k, error } = await sb.rpc('painel_indicadores', { p_dias: Number(dias) });
  if (error) { falha(error); main.innerHTML = crumbs('Indicadores') + avisos(); S.erro = ''; return; }
  const tot = k.clientes_periodo, marc = k.marcadas;
  const kpi = (ic, n, t, sub, cor) => `<div class="d-kpi"><span class="d-ic" style="color:${cor}">${DICON[ic]}</span><div><small>${t}</small><b>${n}</b>${sub ? `<em>${sub}</em>` : ''}</div></div>`;
  const grupos = Object.entries(GRUPO).map(([g, [t, c]]) => ({ t, c, n: k.por_grupo[g] || 0 }));
  const msgs = Object.entries(k.msgs_por_origem || {}).map(([o, n]) => ({ t: ORIGEM[o] || o, c: COR_ORIGEM[o] || DC.cinza, n })).sort((a, b) => b.n - a.n);
  const SEM = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const semana = SEM.map((t, i) => [t, (k.consultas_por_dia_semana || {})[i + 1] || 0]).filter(x => x[1] || SEM.indexOf(x[0]) < 6);
  const origem = Object.entries(k.por_origem || {}).sort((a, b) => b[1] - a[1]).map(([t, n], i) => [t, n, [DC.laranja, DC.azul, DC.verde, DC.roxo, DC.amarelo][i % 5]]);
  const funil = [['Clientes atendidos', tot, DC.azul], ['Consultas marcadas', marc, DC.laranja], ['Exames realizados', k.realizadas, DC.verde]];
  const horas = Array.from({ length: 15 }, (_, i) => i + 7).map(h => [h + 'h', (k.msgs_por_hora || {})[h] || 0]);
  const agora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date());
  main.innerHTML = `${crumbs('Indicadores')}
  <div class="dash">
    <aside class="d-side">
      <h1>Indicadores dos atendimentos</h1>
      <p class="d-sub">Exame de vista · Íris</p>
      <div class="d-filtro"><b>Período</b>
        ${[['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Último ano']].map(([v, t]) => `<a href="#/indicadores?d=${v}" class="${v === dias ? 'on' : ''}" aria-current="${v === dias}">${t}</a>`).join('')}
      </div>
      <dl class="d-mini">
        <dt>Em andamento</dt><dd>${nf(k.andamento)}</dd>
        <dt>Com a equipe</dt><dd>${nf(k.com_equipe)}</dd>
        <dt>Clínica sem vaga</dt><dd>${nf(k.sem_vaga)}</dd>
        <dt>Canceladas</dt><dd>${nf(k.canceladas)}</dd>
        <dt>Desde o início</dt><dd>${nf(k.clientes_total)}</dd>
      </dl>
      <p class="d-sub">Desde ${dataBR(k.desde)} · atualizado às ${agora}</p>
    </aside>
    <div class="d-main">
      <div class="d-kpis">
        ${kpi('pessoas', nf(tot), 'Clientes atendidos', '', DC.azul)}
        ${kpi('agenda', nf(marc), 'Consultas marcadas', '', DC.laranja)}
        ${kpi('taxa', pct(marc, tot) + '%', 'Taxa de agendamento', 'clientes que marcaram', DC.amarelo)}
        ${kpi('olho', nf(k.realizadas), 'Exames realizados', marc ? pct(k.realizadas, marc) + '% das marcadas' : '', DC.verde)}
        ${kpi('relogio', nf(k.proximas), 'Próximas consultas', 'de hoje em diante', DC.roxo)}
      </div>
      <div class="d-grid">
        <section class="d-card d-w2"><h2>Clientes ao longo do tempo</h2>${dLinha(serieTempo(k.por_dia, Number(dias)))}</section>
        <section class="d-card"><h2>Situação dos clientes</h2>${rosca(grupos, tot, 'clientes')}</section>
        <section class="d-card"><h2>Do contato ao exame</h2>${dBarras(funil)}
          <p class="d-nota">${pct(marc, tot)}% marcaram consulta${marc ? ` e ${pct(k.realizadas, marc)}% delas já foram realizadas` : ''}.</p></section>
        <section class="d-card"><h2>Mensagens por origem</h2>${k.msgs_total ? rosca(msgs, k.msgs_total, 'mensagens') : '<p class="d-vazio">Começa a contar quando a gravação das conversas estiver ligada.</p>'}</section>
        <section class="d-card"><h2>De onde vieram</h2>${dBarras(origem)}
          <p class="d-nota">Para separar site, Instagram e anúncios, cada canal precisa de um link de WhatsApp com uma frase própria.</p></section>
        <section class="d-card"><h2>Dia da semana das consultas</h2>${dBarras(semana, DC.laranja)}</section>
        <section class="d-card d-w2"><h2>Horário em que os clientes mais escrevem</h2>${k.msgs_total ? dColunas(horas) : '<p class="d-vazio">Começa a contar quando a gravação das conversas estiver ligada.</p>'}</section>
      </div>
      <p class="d-nota" style="margin-top:10px">Só números aparecem aqui: nenhum nome, telefone ou CPF.</p>
    </div>
  </div>`;
}
function dColunas(lista) {
  const mx = Math.max(1, ...lista.map(x => x[1]));
  return `<div class="d-cols">${lista.map(([t, n]) => `<div><b>${n || ''}</b><i style="height:${n ? Math.max(4, (n / mx) * 100) : 2}%"></i><span>${t}</span></div>`).join('')}</div>`;
}

/* ---------------- Eventos da página ---------------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'voltar') { if (PILHA.length > 1) history.back(); else location.hash = '#/'; return; }
  if (a === 'topo') return window.scrollTo({ top: 0, behavior: 'smooth' });
  if (a === 'pular') return pular(b.dataset.o);
  if (a === 'tela-esqueci') { S.tela = 'esqueci'; S.erro = ''; S.ok = ''; return rota(); }
  if (a === 'tela-login') { S.tela = ''; S.erro = ''; S.ok = ''; return rota(); }
  if (a === 'ver-senha') { ['p-senha', 'p-senha2'].forEach(i => { const el = $(i); if (el) el.type = b.checked ? 'text' : 'password'; }); return; }
  if (a === 'zerar') {
    if (!confirm('Zerar o código do celular desta pessoa? No próximo acesso ela vai cadastrar o código de novo.')) return;
    return acaoUsuario({ acao: 'zerar_codigo', id: b.dataset.id }, 'Código zerado. A pessoa cadastra um novo no próximo acesso.');
  }
  if (a === 'entrar') return entrar();
  if (a === 'esqueci') return esqueci();
  if (a === 'sair') { S.erro = ''; return sb.auth.signOut(); }
  if (a === 'mfa-cadastrar') return cadastrarCodigo();
  if (a === 'mfa-confirmar') return confirmarCodigo();
  if (a === 'nova-senha') return novaSenha();
  if (a === 'ver-cpf') return verCpf();
  if (a === 'convidar') {
    const nome = $('u-nome').value.trim(), email = $('u-email').value.trim(), papel = $('u-papel').value;
    if (!nome || !email) { S.erro = 'Preencha o nome e o e-mail.'; return pUsuarios(); }
    b.disabled = true;
    return acaoUsuario({ acao: 'convidar', nome, email, papel }, `Convite enviado para ${email}.`);
  }
  if (a === 'bloquear') {
    const bloquear = b.dataset.b === '1';
    if (bloquear && !confirm('Bloquear este usuário? Ele perde o acesso na hora.')) return;
    return acaoUsuario({ acao: 'bloquear', id: b.dataset.id, bloquear }, bloquear ? 'Usuário bloqueado.' : 'Usuário liberado.');
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.papel) acaoUsuario({ acao: 'mudar_papel', id: el.dataset.papel, papel: el.value }, 'Perfil alterado.');
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (['l-email', 'l-senha'].includes(e.target.id)) entrar();
  if (e.target.id === 'r-email') esqueci();
  if (e.target.id === 'm-codigo') confirmarCodigo();
});

window.addEventListener('scroll', () => { const t = $('topo'); if (t) t.hidden = !S.session || window.scrollY < 500; }, { passive: true });
// Guarda o caminho feito dentro do painel, para o botão Voltar nunca sair do painel.
const PILHA = [location.hash || '#/'];
window.addEventListener('hashchange', () => {
  const h = location.hash || '#/';
  if (PILHA.length > 1 && PILHA[PILHA.length - 2] === h) PILHA.pop(); else PILHA.push(h);
  window.scrollTo(0, 0);
});

iniciar();
