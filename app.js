// Sistema Renascer · base (login, Painel do dia, Clientes, Administrador)
// Banco: Supabase. A chave abaixo é a chave pública (publishable): quem protege os dados
// são as regras de acesso do banco, não o segredo da chave.
const SUPABASE_URL = 'https://twcmzdqqqzgberkjgdcv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dDhwO4G3hC0P4g81G5YWfA_Wc4eMYw8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const fmtISO = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const toISO = br => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const soDig = s => String(s || '').replace(/\D/g, '');

const S = { user: null, eu: null, tab: 'painel', msg: '', erro: '', busca: '', clientes: [], ficha: null, novo: false, form: {}, errs: {}, equipe: [], empresa: null, salvando: false };
const isAdm = () => S.eu && S.eu.papel === 'administrador';

function cpfOk(v) {
  const d = soDig(v); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += +d[i] * (t + 1 - i); if (((s * 10) % 11) % 10 !== +d[t]) return false; }
  return true;
}
const fmtCPF = d => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const vCPF = v => { const d = soDig(v); return d.length === 11 ? fmtCPF(d) : (v || ''); };
const vCel = v => { const d = soDig(v); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : (v || ''); };

/* ---------------- Sessão ---------------- */
async function iniciar() {
  const { data } = await sb.auth.getSession();
  await aoMudarSessao(data.session);
  sb.auth.onAuthStateChange((_ev, session) => { if ((session?.user?.id || null) !== (S.user?.id || null)) aoMudarSessao(session); });
}
async function aoMudarSessao(session) {
  S.user = session?.user || null; S.eu = null; S.msg = ''; S.erro = '';
  if (S.user) {
    const { data, error } = await sb.from('equipe').select('id,nome,papel,limite_desconto,ativo').eq('id', S.user.id).maybeSingle();
    if (error) S.erro = 'Não consegui ler seu perfil: ' + error.message;
    S.eu = data || null;
    if (S.eu && S.eu.ativo) await carregarTudo();
  }
  render();
}
async function carregarTudo() {
  const [c, e, emp] = await Promise.all([
    sb.from('clientes').select('id,nome,cpf,celular,celular_whatsapp,nascimento,bairro,vendedor_responsavel,aceita_mensagens').eq('ativo', true).order('nome').limit(2000),
    sb.from('equipe').select('id,nome,papel,limite_desconto,ativo').order('nome'),
    sb.from('empresa').select('*').maybeSingle()
  ]);
  if (c.error || e.error || emp.error) S.erro = (c.error || e.error || emp.error).message;
  S.clientes = c.data || []; S.equipe = e.data || []; S.empresa = emp.data || null;
}

/* ---------------- Render ---------------- */
function render() {
  const who = $('who'), tabs = $('tabs'), main = $('main');
  if (!S.user) { who.innerHTML = ''; tabs.hidden = true; main.innerHTML = vLogin(); return; }
  who.innerHTML = `<span>${esc(S.eu?.nome || S.user.email)}${isAdm() ? ' · administrador' : ''}</span><button class="btn ghost" data-a="sair">Sair</button>`;
  if (!S.eu || !S.eu.ativo) { tabs.hidden = true; main.innerHTML = vSemAcesso(); return; }
  const t = [['painel', 'Painel do dia'], ['clientes', 'Clientes']].concat(isAdm() ? [['admin', 'Administrador']] : []);
  tabs.hidden = false;
  tabs.innerHTML = t.map(([k, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('');
  main.innerHTML = (S.erro ? `<div class="msg bad" style="margin-bottom:12px">${esc(S.erro)}</div>` : '') + ({ painel: vPainel, clientes: vClientes, admin: vAdmin }[S.tab] || vPainel)();
}

function vLogin() {
  return `<div class="login"><section class="panel"><div><h2>Entrar</h2><p class="hint">Use o e-mail e a senha cadastrados pelo administrador.</p></div>
    ${S.erro ? `<div class="msg bad">${esc(S.erro)}</div>` : ''}${S.msg ? `<div class="msg ok">${esc(S.msg)}</div>` : ''}
    <label>E-mail<input id="l-email" type="email" autocomplete="username" value="${esc(S.lEmail || '')}"></label>
    <label>Senha<input id="l-senha" type="password" autocomplete="current-password"></label>
    <button class="btn primary" data-a="entrar" ${S.salvando ? 'disabled' : ''}>${S.salvando ? 'Entrando...' : 'Entrar'}</button>
    <button class="btn ghost" data-a="esqueci">Esqueci a senha</button></section></div>`;
}
function vSemAcesso() {
  return `<div class="login"><section class="panel"><h2>Acesso ainda não liberado</h2>
    <p class="hint">Você entrou como ${esc(S.user.email)}, mas ainda não faz parte da equipe no sistema. Peça ao administrador para liberar seu acesso.</p>
    ${S.erro ? `<div class="msg bad">${esc(S.erro)}</div>` : ''}</section></div>`;
}

/* Painel do dia */
function vPainel() {
  const dm = `${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const aniv = S.clientes.filter(c => c.nascimento && c.nascimento.slice(5, 10) === dm);
  const meus = isAdm() ? S.clientes : S.clientes.filter(c => c.vendedor_responsavel === S.eu.id);
  const saud = today.getHours() < 12 ? 'Bom dia' : today.getHours() < 18 ? 'Boa tarde' : 'Boa noite';
  return `<div style="display:flex;flex-direction:column;gap:14px">
    <section class="panel"><div><h2>${saud}, ${esc((S.eu.nome || '').split(' ')[0])}! Hoje é ${today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    <p class="hint">${isAdm() ? 'Visão do administrador.' : 'O que precisa da sua atenção hoje.'}</p></div>${S.msg ? `<div class="msg ok">${esc(S.msg)}</div>` : ''}</section>
    ${isAdm() ? `<section class="panel"><div class="head"><h2>Números da loja</h2><span class="chip brand">Só o administrador vê</span></div>
      <div class="kpis"><div class="kpi"><span>Clientes cadastrados</span><b>${S.clientes.length}</b></div><div class="kpi"><span>Pessoas na equipe</span><b>${S.equipe.filter(e => e.ativo).length}</b></div></div>
      <p class="hint">Vendas, recebimentos e contas entram aqui quando a venda guiada estiver ligada ao banco.</p></section>` : ''}
    <div class="cards">
      <section class="panel"><div class="head"><h3>Aniversariantes de hoje</h3><span class="count">${aniv.length}</span></div>
        ${aniv.map(c => `<div class="item"><div>${esc(c.nome)}<small>${esc(vCel(c.celular) || 'sem celular')}${c.aceita_mensagens && c.celular_whatsapp ? '' : ' · não autorizou mensagens'}</small></div>
          ${c.aceita_mensagens && c.celular_whatsapp ? `<button class="btn" data-copy="${c.id}">Copiar mensagem</button>` : '<span class="chip warn">Ligar</span>'}</div>`).join('') || '<p class="empty">Ninguém faz aniversário hoje.</p>'}</section>
      <section class="panel"><div class="head"><h3>${isAdm() ? 'Clientes da loja' : 'Meus clientes'}</h3><span class="count">${meus.length}</span></div>
        <p class="hint">Promissórias vencendo, óculos para entregar e vendas aguardando pagamento aparecem aqui nas próximas etapas.</p>
        <button class="btn" data-tab="clientes">Abrir clientes</button></section>
    </div></div>`;
}

/* Clientes */
function vClientes() {
  if (S.novo) return vNovo();
  if (S.ficha) return vFicha();
  const q = S.busca.toLowerCase().trim(), qd = soDig(q);
  const lista = S.clientes.filter(c => !q || c.nome.toLowerCase().includes(q) || (qd.length >= 3 && (soDig(c.cpf).includes(qd) || soDig(c.celular).includes(qd)))).slice(0, 100);
  const nomeEq = id => (S.equipe.find(e => e.id === id) || {}).nome || '—';
  return `<section class="panel"><div class="actions"><div><h2>Clientes</h2><p class="hint">Um cadastro só. Busque por nome, CPF ou celular.</p></div><button class="btn primary" data-a="novo">Novo cliente</button></div>
    ${S.msg ? `<div class="msg ok">${esc(S.msg)}</div>` : ''}
    <input id="busca" placeholder="Digite nome, CPF ou celular" value="${esc(S.busca)}" aria-label="Buscar cliente">
    <div class="list">${lista.map(c => `<button class="pick" data-ficha="${c.id}"><span><b>${esc(c.nome)}</b><small>${esc(vCPF(c.cpf) || 'sem CPF')} · ${esc(vCel(c.celular) || 'sem celular')} · vendedor: ${esc(nomeEq(c.vendedor_responsavel))}</small></span></button>`).join('')
      || `<p class="empty">${S.clientes.length ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'} Use "Novo cliente".</p>`}</div></section>`;
}
function fld(id, label, attrs = '') {
  return `<label>${label}<input id="f-${id}" value="${esc(S.form[id] || '')}" ${attrs}>${S.errs[id] ? `<span class="err">${S.errs[id]}</span>` : ''}</label>`;
}
function vNovo() {
  const f = S.form; const vendedores = S.equipe.filter(e => e.ativo);
  return `<section class="panel"><div><h2>Novo cliente</h2><p class="hint">Ao salvar, o cliente já fica disponível para venda. Não existe etapa de liberação.</p></div>
    ${S.erro ? `<div class="msg bad">${esc(S.erro)}</div>` : ''}
    <div class="row">${fld('cpf', 'CPF', 'inputmode="numeric" placeholder="000.000.000-00"')}${fld('nome', 'Nome completo')}${fld('nasc', 'Nascimento', 'inputmode="numeric" placeholder="dd/mm/aaaa"')}</div>
    <div class="row">${fld('cel', 'Celular', 'inputmode="tel" placeholder="(62) 9 0000-0000"')}
      <label class="switch" style="border:0;align-self:end">Este celular é WhatsApp<input type="checkbox" id="f-zap" ${f.zap !== false ? 'checked' : ''}></label>
      ${fld('email', 'E-mail (opcional)', 'type="email"')}</div>
    <div class="row">${fld('cep', 'CEP', 'inputmode="numeric" placeholder="00000-000"')}${fld('end', 'Rua')}${fld('num', 'Número')}${fld('bairro', 'Bairro')}${fld('cidade', 'Cidade')}</div>
    <div class="row"><label>Vendedor responsável<select id="f-vend">${vendedores.map(e => `<option value="${e.id}" ${(f.vend || S.eu.id) === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></label>
      <label class="switch" style="border:0;align-self:end">Aceita receber mensagens da loja (LGPD)<input type="checkbox" id="f-msg" ${f.msg ? 'checked' : ''}></label></div>
    <p class="hint" id="cep-hint">O CEP preenche rua, bairro e cidade sozinho.</p>
    <div class="actions"><button class="btn" data-a="cancelar">Cancelar</button><button class="btn primary" data-a="salvar" ${S.salvando ? 'disabled' : ''}>${S.salvando ? 'Salvando...' : 'Salvar cliente'}</button></div></section>`;
}
function vFicha() {
  const c = S.ficha; const nomeEq = id => (S.equipe.find(e => e.id === id) || {}).nome || '—';
  return `<section class="panel"><div class="actions"><div><h2>${esc(c.nome)}</h2><p class="hint">${esc(vCPF(c.cpf) || 'sem CPF')} · ${esc(vCel(c.celular))}${c.celular_whatsapp ? ' (WhatsApp)' : ''} · ${esc(c.bairro || '')} · vendedor responsável: ${esc(nomeEq(c.vendedor_responsavel))}</p></div>
    <button class="btn" data-a="voltar">Voltar</button></div>
    ${S.msg ? `<div class="msg ok">${esc(S.msg)}</div>` : ''}
    <h3>Receitas</h3>${c.receitas === undefined ? '<p class="spin">Carregando...</p>' : c.receitas.length ? `<div class="tw"><table class="t"><tr><th>Data</th><th>OS</th><th>OD</th><th>OE</th></tr>${c.receitas.map(r => `<tr><td>${fmtISO(r.data_receita)}</td><td class="mono">${r.venda_numero || '—'}</td><td class="mono">${esc([r.od_esferico, r.od_cilindrico, r.od_eixo != null ? '× ' + r.od_eixo : '', r.od_adicao ? 'Ad ' + r.od_adicao : ''].filter(Boolean).join(' '))}</td><td class="mono">${esc([r.oe_esferico, r.oe_cilindrico, r.oe_eixo != null ? '× ' + r.oe_eixo : '', r.oe_adicao ? 'Ad ' + r.oe_adicao : ''].filter(Boolean).join(' '))}</td></tr>`).join('')}</table></div>` : '<p class="empty">Nenhuma receita ainda.</p>'}
    <h3>Compras</h3>${c.vendas === undefined ? '<p class="spin">Carregando...</p>' : c.vendas.length ? `<div class="tw"><table class="t"><tr><th>Data</th><th>OS</th><th>Situação</th><th class="num">Total</th></tr>${c.vendas.map(v => `<tr><td>${fmtISO(v.criado_em)}</td><td class="mono">${v.numero}</td><td>${esc(v.situacao.replace('_', ' '))}</td><td class="num">${brl(v.total)}</td></tr>`).join('')}</table></div>` : '<p class="empty">Nenhuma compra ainda.</p>'}
  </section>`;
}

/* Administrador */
function vAdmin() {
  if (!isAdm()) return '<section class="panel"><p>Área só para o administrador.</p></section>';
  const e = S.empresa || {};
  return `<div style="display:flex;flex-direction:column;gap:14px">
    ${S.msg ? `<div class="msg ok">${esc(S.msg)}</div>` : ''}
    <section class="panel"><h2>Dados da empresa</h2><p class="hint">Saem nas promissórias, vias e termo de garantia.</p>
      <div class="row"><label>Nome fantasia<input id="e-nome_fantasia" value="${esc(e.nome_fantasia)}"></label><label>Razão social<input id="e-razao_social" value="${esc(e.razao_social)}" placeholder="Preencher"></label><label>CNPJ<input id="e-cnpj" value="${esc(e.cnpj)}"></label></div>
      <div class="row"><label>Endereço<input id="e-endereco" value="${esc(e.endereco)}"></label><label>Cidade<input id="e-cidade" value="${esc(e.cidade)}"></label><label>UF<input id="e-uf" value="${esc(e.uf)}" maxlength="2"></label><label>CEP<input id="e-cep" value="${esc(e.cep)}"></label></div>
      <div class="row"><label>Telefone fixo<input id="e-telefone" value="${esc(e.telefone)}"></label><label>WhatsApp<input id="e-whatsapp" value="${esc(e.whatsapp)}"></label></div>
      <div class="actions"><span></span><button class="btn primary" data-a="salvar-empresa">Salvar dados da empresa</button></div></section>
    <section class="panel"><h2>Equipe</h2>
      <div class="tw"><table class="t"><tr><th>Nome</th><th>Perfil</th><th class="num">Limite de desconto</th><th>Situação</th></tr>
      ${S.equipe.map(m => `<tr><td>${esc(m.nome)}</td><td>${m.papel === 'administrador' ? 'Administrador' : 'Vendedor'}</td><td class="num">${m.papel === 'administrador' ? 'sem limite' : `<input type="number" min="0" max="50" value="${Number(m.limite_desconto)}" data-lim="${m.id}" style="width:80px;text-align:right"> %`}</td><td>${m.ativo ? '<span class="chip ok">Ativo</span>' : '<span class="chip bad">Inativo</span>'}</td></tr>`).join('')}</table></div>
      <p class="hint">Para incluir alguém na equipe: a pessoa recebe um usuário com e-mail e senha, e o administrador libera o acesso. Essa tela de convite vem na próxima etapa.</p></section>
  </div>`;
}

/* ---------------- Ações ---------------- */
async function entrar() {
  const email = $('l-email').value.trim(), senha = $('l-senha').value; S.lEmail = email;
  if (!email || !senha) { S.erro = 'Digite e-mail e senha.'; render(); return; }
  S.salvando = true; S.erro = ''; render();
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  S.salvando = false;
  if (error) { S.erro = error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message; render(); }
}
async function esqueci() {
  const email = ($('l-email') || {}).value?.trim();
  if (!email) { S.erro = 'Digite seu e-mail e clique de novo em "Esqueci a senha".'; render(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  S.erro = error ? error.message : ''; S.msg = error ? '' : 'Se esse e-mail estiver cadastrado, chega um link para criar nova senha.'; render();
}
async function abrirFicha(id) {
  const c = { ...S.clientes.find(x => x.id === id) }; S.ficha = c; S.msg = ''; render();
  const [r, v] = await Promise.all([
    sb.from('receitas').select('data_receita,venda_numero,od_esferico,od_cilindrico,od_eixo,od_adicao,oe_esferico,oe_cilindrico,oe_eixo,oe_adicao').eq('cliente_id', id).order('data_receita', { ascending: false }),
    sb.from('vendas').select('numero,criado_em,situacao,total').eq('cliente_id', id).order('criado_em', { ascending: false })
  ]);
  if (S.ficha && S.ficha.id === id) { S.ficha.receitas = r.data || []; S.ficha.vendas = v.data || []; if (r.error || v.error) S.erro = (r.error || v.error).message; render(); }
}
async function salvarCliente() {
  const f = S.form, errs = {}; const cpf = soDig(f.cpf);
  if (cpf && !cpfOk(cpf)) errs.cpf = 'CPF inválido';
  else if (cpf && S.clientes.some(c => soDig(c.cpf) === cpf)) errs.cpf = 'Este CPF já está cadastrado';
  if (!(f.nome || '').trim().includes(' ')) errs.nome = 'Digite nome e sobrenome';
  if (soDig(f.cel).length < 10) errs.cel = 'Celular incompleto';
  if (f.nasc && !toISO(f.nasc)) errs.nasc = 'Use dd/mm/aaaa';
  S.errs = errs; if (Object.keys(errs).length) { render(); return; }
  S.salvando = true; S.erro = ''; render();
  const linha = { cpf: cpf ? fmtCPF(cpf) : null, nome: f.nome.trim(), nascimento: toISO(f.nasc), celular: f.cel, celular_whatsapp: f.zap !== false, email: f.email || null,
    cep: f.cep || null, endereco: f.end || null, numero: f.num || null, bairro: f.bairro || null, cidade: f.cidade || null, uf: f.uf || null,
    vendedor_responsavel: f.vend || S.eu.id, aceita_mensagens: !!f.msg };
  const { data, error } = await sb.from('clientes').insert(linha).select('id,nome,cpf,celular,celular_whatsapp,nascimento,bairro,vendedor_responsavel,aceita_mensagens').single();
  S.salvando = false;
  if (error) { S.erro = error.code === '23505' ? 'Este CPF já está cadastrado.' : 'Não salvou: ' + error.message; render(); return; }
  await sb.from('historico').insert({ acao: 'Cliente cadastrado', detalhe: data.nome });
  S.clientes.push(data); S.clientes.sort((a, b) => a.nome.localeCompare(b.nome)); S.novo = false; S.form = {};
  S.msg = 'Cliente salvo e já disponível para venda.'; abrirFicha(data.id);
}
async function buscarCEP(cep) {
  const d = soDig(cep); if (d.length !== 8) return;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`); const j = await r.json();
    if (j.erro) { $('cep-hint').textContent = 'CEP não encontrado. Preencha o endereço à mão.'; return; }
    Object.assign(S.form, { end: j.logradouro, bairro: j.bairro, cidade: j.localidade, uf: j.uf });
    ['end', 'bairro', 'cidade'].forEach(k => { const i = $('f-' + k); if (i) i.value = S.form[k] || ''; });
    $('cep-hint').textContent = 'Endereço preenchido pelo CEP.';
  } catch (_) { $('cep-hint').textContent = 'Não consegui consultar o CEP agora. Preencha à mão.'; }
}
async function salvarEmpresa() {
  const campos = ['nome_fantasia', 'razao_social', 'cnpj', 'endereco', 'cidade', 'uf', 'cep', 'telefone', 'whatsapp'];
  const upd = {}; campos.forEach(k => upd[k] = $('e-' + k).value.trim() || null); upd.atualizado_em = new Date().toISOString();
  const { error } = await sb.from('empresa').update(upd).eq('id', 1);
  if (error) { S.erro = 'Não salvou: ' + error.message; } else { S.empresa = { ...S.empresa, ...upd }; S.msg = 'Dados da empresa salvos.'; S.erro = ''; await sb.from('historico').insert({ acao: 'Dados da empresa alterados' }); }
  render();
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.tab) { S.tab = d.tab; S.ficha = null; S.novo = false; S.msg = ''; S.erro = ''; render(); return; }
  if (d.ficha) { abrirFicha(+d.ficha); return; }
  if (d.copy) { const c = S.clientes.find(x => x.id === +d.copy); const t = `Olá, ${c.nome.split(' ')[0]}! A Óptica Renascer deseja um feliz aniversário. Passe na loja para ganhar seu mimo.`; try { await navigator.clipboard.writeText(t); S.msg = 'Mensagem copiada. Cole no WhatsApp do cliente.'; } catch (_) { S.msg = t; } render(); return; }
  switch (d.a) {
    case 'entrar': return entrar();
    case 'esqueci': return esqueci();
    case 'sair': await sb.auth.signOut(); return;
    case 'novo': S.novo = true; S.form = { zap: true, vend: S.eu.id }; S.errs = {}; S.msg = ''; S.erro = ''; render(); return;
    case 'cancelar': S.novo = false; S.erro = ''; render(); return;
    case 'voltar': S.ficha = null; S.msg = ''; render(); return;
    case 'salvar': return salvarCliente();
    case 'salvar-empresa': return salvarEmpresa();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'l-senha' || e.target.id === 'l-email')) entrar(); });
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'busca') { S.busca = el.value; const pos = el.selectionStart; render(); const n = $('busca'); n.focus(); n.setSelectionRange(pos, pos); return; }
  if (el.id && el.id.startsWith('f-')) { const k = el.id.slice(2); S.form[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'cep') buscarCEP(el.value); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'f-zap' || el.id === 'f-msg' || el.id === 'f-vend') S.form[el.id.slice(2)] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.lim) {
    const v = Math.max(0, Math.min(50, +el.value || 0));
    const { error } = await sb.from('equipe').update({ limite_desconto: v }).eq('id', el.dataset.lim);
    if (error) S.erro = 'Não salvou: ' + error.message; else { const m = S.equipe.find(x => x.id === el.dataset.lim); m.limite_desconto = v; S.msg = `Limite de desconto de ${m.nome}: ${v}%.`; await sb.from('historico').insert({ acao: 'Limite de desconto alterado', detalhe: `${m.nome}: ${v}%` }); }
    render();
  }
});

iniciar();
