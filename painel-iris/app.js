// Painel da Íris · histórico e auditoria dos atendimentos (Óptica Renascer)
// Banco: Supabase da Íris. A chave abaixo é a chave PÚBLICA (publishable): ela sozinha não abre dado nenhum.
// Quem protege os dados: login com código de verificação (2 etapas) + funções do banco que conferem o perfil.
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
  status: 'Status mudou', transferido: 'Passado para a equipe', confirmacao_enviada: 'Confirmação enviada',
  beneficio_enviado: 'Benefício enviado', lembrete_enviado: 'Lembrete enviado', cpf_visto: 'CPF completo visto',
  usuario_convidado: 'Usuário convidado', usuario_perfil: 'Perfil de usuário alterado',
  usuario_bloqueado: 'Usuário bloqueado', usuario_liberado: 'Usuário liberado'
};

const S = { criarSenha: VEIO_DE_LINK, session: null, papel: null, nome: '', mfa: null, erro: '', ok: '', cache: {} };
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
  const email = $('l-email').value.trim();
  if (!email) { S.erro = 'Digite o seu e-mail para receber o link.'; return rota(); }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  S.erro = ''; S.ok = 'Se o e-mail estiver cadastrado, chega um link para criar uma nova senha.'; rota();
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
  const { error } = await sb.auth.updateUser({ password: s1 });
  if (error) { S.erro = error.message; return rota(); }
  S.criarSenha = false; S.erro = ''; S.ok = 'Senha criada.'; location.hash = '#/'; rota();
}

/* ---------------- Rotas ---------------- */
function rota() {
  const who = $('who'), main = $('main');
  const precisaSenha = S.criarSenha;
  if (!S.session) { who.innerHTML = ''; main.innerHTML = vLogin(); return; }
  who.innerHTML = `<span>${esc(S.nome)}${S.papel ? ` · ${isAdm() ? 'Administrador' : 'Visualizador'}` : ''}</span><button class="btn small" data-act="sair">Sair</button>`;
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
  location.hash = '#/';
}
const crumbs = (...partes) => `<nav class="crumbs" aria-label="Caminho"><a href="#/">Início</a>${partes.map(p => ` › ${p}`).join('')}</nav>`;
const avisos = () => (S.erro ? `<div class="msg bad" role="alert">${esc(S.erro)}</div>` : '') + (S.ok ? `<div class="msg ok" role="status">${esc(S.ok)}</div>` : '');
const falha = e => { S.erro = /sem acesso|só administrador/.test(e?.message || '') ? 'Você não tem acesso a esta parte.' : 'Não consegui carregar: ' + (e?.message || 'erro'); };

function vLogin() {
  return `<div class="login"><div class="panel"><h2>Entrar</h2><p class="hint">Acesso só para a equipe autorizada da Óptica Renascer.</p>${avisos()}
    <label>E-mail<input id="l-email" type="email" autocomplete="username" inputmode="email"></label>
    <label>Senha<input id="l-senha" type="password" autocomplete="current-password"></label>
    <button class="btn primary" data-act="entrar">Entrar</button>
    <button class="btn small" data-act="esqueci">Esqueci a senha</button></div></div>`;
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
    <p class="hint">Abra o aplicativo de autenticação e digite os 6 números do Painel da Íris.</p>
    <label>Código de 6 números<input id="m-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
    <button class="btn primary" data-act="mfa-confirmar">Entrar</button></div></div>`;
}
function vSenha() {
  return `<div class="login"><div class="panel"><h2>Criar a sua senha</h2>${avisos()}
    <label>Nova senha (mínimo 10 caracteres)<input id="p-senha" type="password" autocomplete="new-password"></label>
    <label>Repita a senha<input id="p-senha2" type="password" autocomplete="new-password"></label>
    <button class="btn primary" data-act="nova-senha">Salvar senha</button></div></div>`;
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
    ${card('#/', 'grafico', 'Indicadores', 'Em breve', '', true)}
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
    <div class="legend">${Object.entries(ORIGEM).map(([k, t]) => `<span><i style="background:var(--c-${k})"></i>${t}</span>`).join('')}</div></div>
    ${vLinha(m.data, e.data, fi)}</section>
  <aside class="ficha panel" aria-label="Ficha">${vFicha(fi)}</aside></div>`;
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
  <dl class="kv">
    ${linha('WhatsApp', `<span class="nw">${fone(fi.telefone)}</span>`)}
    ${linha('Nome no WhatsApp', esc(fi.nome_whatsapp))}
    ${fi.tem_cpf ? `<dt>CPF</dt><dd><span class="mono" id="cpf">${esc(fi.cpf)}</span>${isAdm() ? ' <button class="btn small" data-act="ver-cpf">Mostrar</button>' : ''}</dd>` : '<dt>CPF</dt><dd class="hint">não informado</dd>'}
    ${linha('Nascimento', esc(dataBR(fi.data_nascimento)))}
    ${linha('E-mail', esc(fi.email))}
    ${linha('Consulta', fi.data_exame ? esc(dataBR(fi.data_exame) + (fi.horario_exame ? ' às ' + horaBR(fi.horario_exame) : '')) : '')}
    ${linha('Clínica', esc(fi.clinica))}
    ${linha('Protocolo', esc(fi.protocolo))}
    ${linha('Autorizou envio', fi.autorizou_compartilhamento == null ? '' : fi.autorizou_compartilhamento ? 'Sim' : 'Não')}
    ${linha('Confirmada em', esc(quando(fi.confirmada_em)))}
    ${linha('Realizada em', esc(quando(fi.realizada_em)))}
    ${linha('Primeiro contato', esc(quando(fi.criado_em)))}
    ${linha('Última mudança', esc(quando(fi.atualizado_em)))}
  </dl>
  ${outras.length ? `<div><h3>Mesmo WhatsApp</h3><div class="rows">${outras.map(p => `<a class="rowlink" style="grid-template-columns:1fr" href="#/atendimento/${encodeURIComponent(p.pessoa_id)}"><b>${esc(p.nome || 'Sem nome')}</b></a>`).join('')}</div></div>` : ''}
  ${(fi.atendimentos || []).length ? `<div><h3>Atendimentos</h3><dl class="kv">${fi.atendimentos.map(a => `<dt>${esc(dataBR(a.aberto_em))}</dt><dd>${a.fechado_em ? esc(a.resultado || 'fechado') : '<span class="chip warn">aberto</span>'}</dd>`).join('')}</dl></div>` : ''}
  <div><h3>Ações</h3><p class="hint">Responder, devolver para a Íris e reenviar a confirmação chegam na próxima etapa.</p></div>`;
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
    <td>${u.id === meuId ? '' : `<button class="btn small" data-act="bloquear" data-id="${esc(u.id)}" data-b="${u.bloqueado ? '0' : '1'}">${u.bloqueado ? 'Liberar' : 'Bloquear'}</button>${u.bloqueado ? ' <span class="chip bad">bloqueado</span>' : ''}`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum usuário.</td></tr>'}
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

/* ---------------- Eventos da página ---------------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
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
  if (e.target.id === 'm-codigo') confirmarCodigo();
});

iniciar();
