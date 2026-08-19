#!/usr/bin/env node
/* ============================================================
   Cofrinho — Bot de alertas no Telegram
   Puxa gastos do mês (Organizze ao vivo) e dispara relatórios.

   Comandos:
     node telegram-bot.js getchat   -> descobre seu chat_id (mande "oi" pro bot antes)
     node telegram-bot.js test      -> manda uma mensagem de teste
     node telegram-bot.js daily     -> pulso diário (tetos por categoria)
     node telegram-bot.js weekly    -> resumo da semana
     node telegram-bot.js monthly   -> fechamento + planejamento do mês

   .env (cofrinho/Finanças/.env):
     ORGANIZZE_EMAIL=...
     ORGANIZZE_API_TOKEN=...
     TELEGRAM_BOT_TOKEN=...    (do @BotFather)
     TELEGRAM_CHAT_ID=...      (rode "getchat" pra achar)
   ============================================================ */
const fs = require('fs');
const path = require('path');

// ---- env (local primeiro, fallback raiz) ----
const env = {};
for (const ENV of [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../../.env')]) {
  try { for (const l of fs.readFileSync(ENV, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } } catch (e) {}
}
const { ORGANIZZE_EMAIL: EMAIL, ORGANIZZE_API_TOKEN: OTOKEN, TELEGRAM_BOT_TOKEN: TG, TELEGRAM_CHAT_ID: CHAT } = env;

// ---- Organizze ----
const OBASE = 'https://api.organizze.com.br/rest/v2';
const oauth = 'Basic ' + Buffer.from(`${EMAIL}:${OTOKEN}`).toString('base64');
async function oget(url) {
  const r = await fetch(OBASE + url, { headers: { Authorization: oauth, 'User-Agent': `Cofrinho (${EMAIL})`, 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`Organizze ${r.status}: ${t.slice(0, 160)}`); return JSON.parse(t);
}

// ---- Telegram ----
async function tg(method, body) {
  if (!TG) throw new Error('Falta TELEGRAM_BOT_TOKEN no .env');
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function send(text) {
  if (!CHAT) throw new Error('Falta TELEGRAM_CHAT_ID no .env (rode: node telegram-bot.js getchat)');
  const res = await tg('sendMessage', { chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true });
  if (!res.ok) throw new Error('Telegram: ' + JSON.stringify(res));
  return res;
}

const BRL = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ---- Tetos (mesmos do organizze-alertas.js) ----
const CAPS = [
  { key: 'compras', nome: '🛍️ Compras', teto: 600, kws: ['mercadolivre', 'mercado livre', 'mercadol', 'magalu', 'magazine', 'shein', 'amazon', 'aliexpress', 'shopee', 'tiktok shop', 'ebn', 'ebw'] },
  { key: 'ifood', nome: '🍔 iFood/delivery', teto: 400, kws: ['ifood', 'ifd', 'restaurante', 'lanches', 'pizz', 'burger', 'hamburg', 'bakery', 'sushi', 'habanero', 'al basha', 'dubs', 'brosa', 'sulameric', 'nupay'] },
  { key: 'mercado', nome: '🛒 Mercado', teto: 650, kws: ['monte carlo', 'amigao', 'atacad', 'supermerc', 'emporio', 'angelo', 'mercado monte'] },
  { key: 'assinaturas', nome: '💻 Assinaturas', teto: 300, kws: ['netflix', 'spotify', 'openai', 'chatgpt', 'anthropic', 'claude', 'youtubepremium', 'apple.com', 'applecom', 'canva', 'elevenlabs', 'microsoft', 'registrobr', 'twilio', 'google youtube'] },
  { key: 'pet', nome: '🐾 Pet (Paco)', teto: 500, kws: ['pet ', 'veter', 'farmabee', 'drogavet', 'mercado pet', 'pet farma', 'pet max'] },
];
const bucket = d => { d = (d || '').toLowerCase(); for (const c of CAPS) if (c.kws.some(k => d.includes(k))) return c.key; return null; };

async function spendThisMonth() {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const start = `${y}-${String(mo + 1).padStart(2, '0')}-01`, end = now.toISOString().slice(0, 10);
  const txs = await oget(`/transactions?start_date=${start}&end_date=${end}`);
  const spent = Object.fromEntries(CAPS.map(c => [c.key, 0]));
  for (const t of (Array.isArray(txs) ? txs : [])) { const v = -(t.amount_cents || 0) / 100; if (v > 0) { const b = bucket(t.description); if (b) spent[b] += v; } }
  const dias = new Date(y, mo + 1, 0).getDate(), hoje = now.getDate();
  return { spent, dias, hoje, ritmo: hoje / dias, mes: start.slice(0, 7) };
}

// ---- Relatórios ----
// Alerta de desatualização: olha a última sincronização das contas (updated_at)
async function staleness() {
  try {
    const accs = await oget('/accounts');
    const datas = accs.map(a => a.updated_at).filter(Boolean).sort();
    const last = datas[datas.length - 1];
    if (!last) return '';
    const dias = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    if (dias >= 2) return `⚠️ <b>Organizze pode estar desatualizado</b> — última sincronização há ${dias} dias. Confira a conexão bancária / dá um refresh.\n\n`;
  } catch (e) {}
  return '';
}

async function daily() {
  const warn = await staleness();
  const { spent, dias, hoje, ritmo, mes } = await spendThisMonth();
  let linhas = [], estouro = [];
  for (const c of CAPS) {
    const g = spent[c.key], proj = ritmo > 0 ? g / ritmo : g;
    let f = '🟢'; if (g > c.teto) { f = '🔴'; estouro.push(c.nome); } else if (proj > c.teto || g / c.teto >= 0.8) f = '🟡';
    linhas.push(`${f} ${c.nome}: <b>${BRL(g)}</b> / ${BRL(c.teto)}` + (proj > c.teto ? `  → fecha ~${BRL(proj)}` : ''));
  }
  const cab = `🐷 <b>Pulso diário — ${mes}</b> (dia ${hoje}/${dias})\n\n`;
  const rod = estouro.length ? `\n\n🔴 <b>${estouro.length} teto(s) estourado(s).</b> Segura hoje: ${estouro.join(', ')}.` : `\n\n✅ Nenhum teto estourado. Mantém assim.`;
  return warn + cab + linhas.join('\n') + rod;
}

// Metas por categoria (nomes = categorias do Organizze)
const METAS = { 'Compras': 600, 'Alimentação': 400, 'Mercado': 650, 'Assinaturas e serviços': 300, 'Pets': 500 };
const NOISE_IN = /estorno|rendiment|remuner|valor adicionado para pix|fgts|canc parcela|resgate|aplica|banco inter|saldo anterior/i;
const NOISE_OUT = /pagamento de cart|fatura|resgate|aplica|transfer.ncia entre|invest|rdb|cdb/i;

const SELF = /marina scheffer|higor vieira|deb pix chave|pix enviado|pix recebido marina/i;

async function monthFlow() {
  const cats = await oget('/categories'); const cmap = {}; cats.forEach(c => cmap[c.id] = c.name);
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const start = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  const end = `${y}-${String(mo + 1).padStart(2, '0')}-${new Date(y, mo + 1, 0).getDate()}`;
  const txs = await oget(`/transactions?start_date=${start}&end_date=${end}`);
  const rawIn = [], rawOut = [];
  for (const t of txs) {
    const v = (t.amount_cents || 0) / 100, d = t.description || '';
    if (v > 0) { if (!NOISE_IN.test(d)) rawIn.push({ v, d }); }
    else { const val = -v; if (!NOISE_OUT.test(d)) rawOut.push({ val, d, cat: cmap[t.category_id] || 'Sem categoria' }); }
  }
  // casa transferências: entrada com saída de MESMO valor (dinheiro seu circulando) -> remove dos dois lados
  const outUsed = new Array(rawOut.length).fill(false);
  const incomes = [];
  for (const inc of rawIn) {
    const j = rawOut.findIndex((o, i) => !outUsed[i] && Math.abs(o.val - inc.v) < 0.01 && (SELF.test(inc.d) || SELF.test(o.d)));
    if (j >= 0 && SELF.test(inc.d)) { outUsed[j] = true; continue; } // wash: descarta entrada + saída par
    incomes.push([inc.v, inc.d]);
  }
  let entradas = 0, saidas = 0; const porCat = {}; const gastos = [];
  incomes.forEach(([v]) => entradas += v);
  rawOut.forEach((o, i) => { if (!outUsed[i]) { saidas += o.val; porCat[o.cat] = (porCat[o.cat] || 0) + o.val; gastos.push(o); } });
  return { entradas, saidas, porCat, incomes, gastos, dias: new Date(y, mo + 1, 0).getDate(), hoje: now.getDate(), mes: start.slice(0, 7) };
}

// EXTRATO: onde o dinheiro foi de verdade (transação por transação), Pareto até 80%
async function extrato() {
  const { entradas, saidas, incomes, gastos, mes, hoje, dias } = await monthFlow();
  const inTxt = incomes.length
    ? incomes.slice().sort((a, b) => b[0] - a[0]).map(([v, d]) => `  +${BRL(v)} · ${d.slice(0, 30)}`).join('\n')
    : '  (nada registrado ainda)';
  const gs = gastos.slice().sort((a, b) => b.val - a.val);
  let cum = 0, out = '', i = 0;
  for (const g of gs) {
    cum += g.val; const acc = saidas ? cum / saidas * 100 : 0;
    out += `\n${BRL(g.val)} · ${acc.toFixed(0)}% · ${g.d.slice(0, 30)}`;
    i++;
    if (acc >= 80) { out += '  ⬅️ 80%'; break; }
    if (i >= 15) break;
  }
  return `🐷 <b>EXTRATO — ${mes}</b> <i>(dia ${hoje}/${dias})</i>\n\n` +
    `💰 <b>Entradas (${BRL(entradas)}):</b>\n${inTxt}\n\n` +
    `💸 <b>Onde o dinheiro foi (${BRL(saidas)}) — até 80%:</b>${out}\n\n` +
    `<i>Cada linha é um gasto real. O ⬅️ marca onde 80% do mês se concentra.</i>`;
}

async function monthly() {
  const { entradas, saidas, porCat, dias, hoje, mes } = await monthFlow();
  const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const gap = saidas - entradas;

  let metasTxt = '';
  for (const [nome, teto] of Object.entries(METAS)) {
    const real = porCat[nome] || 0;
    const flag = real > teto ? '🔴' : (real / teto >= 0.8 ? '🟡' : '🟢');
    metasTxt += `\n${flag} ${nome}: <b>${BRL(real)}</b> / meta ${BRL(teto)}`;
  }
  let topTxt = '';
  top.forEach(([n, v], i) => topTxt += `\n${i + 1}. ${n}: <b>${BRL(v)}</b>`);

  return (
    `🐷 <b>RESUMO DE AGOSTO</b>\n<i>até dia ${hoje}/${dias} · dados ao vivo do Organizze</i>\n\n` +
    `💰 <b>Entradas:</b> ${BRL(entradas)}\n` +
    `💸 <b>Saídas:</b> ${BRL(saidas)}\n` +
    `${gap > 0 ? '🔻' : '✅'} <b>Parcial:</b> ${gap > 0 ? '−' : '+'}${BRL(Math.abs(gap))}\n` +
    `<i>(saídas incluem os pontuais da reforma; renda do mês ainda entrando)</i>\n\n` +
    `<b>📊 Meta × Realizado (categorias):</b>${metasTxt}\n\n` +
    `<b>🛒 Maiores gastos do mês:</b>${topTxt}\n\n` +
    `<b>🎯 Necessidade de entrada:</b>\nPra cobrir o que já saiu, faltam entrar <b>~${BRL(gap > 0 ? gap : 0)}</b> até o fim do mês (Higor + Upwork + 1 projeto).\n\n` +
    `<b>📅 Projeção setembro:</b>\nMês mais leve — saídas previstas <b>~R$ 16.100</b> (as faturas dos cartões derretem de R$ 12,3k → R$ 9,4k conforme as parcelas acabam).\n\n` +
    `<i>Reserva zerou com a marcenaria — recompor é o próximo alvo. Você está no controle. 🌱</i>`
  );
}

async function main() {
  const cmd = process.argv[2] || 'daily';
  if (cmd === 'getchat') {
    const r = await tg('getUpdates', {});
    const ids = [...new Set((r.result || []).map(u => u.message?.chat?.id).filter(Boolean))];
    if (!ids.length) return console.log('Nenhuma mensagem ainda. Manda um "oi" pro seu bot no Telegram e roda de novo.');
    console.log('✅ Seu(s) chat_id:', ids.join(', '), '\nCola no .env: TELEGRAM_CHAT_ID=' + ids[0]);
    return;
  }
  if (cmd === 'test') { await send('✅ Bot do Cofrinho conectado! A partir de agora seus alertas chegam aqui. 🐷'); return console.log('Enviado.'); }
  if (cmd === 'daily') { const msg = await daily(); await send(msg); return console.log('Pulso diário enviado.'); }
  if (cmd === 'monthly') { const msg = await monthly(); await send(msg); return console.log('Resumo mensal enviado.'); }
  if (cmd === 'extrato') { const msg = await extrato(); await send(msg); return console.log('Extrato enviado.'); }
  console.log('Comando desconhecido:', cmd);
}

// exporta pro ouvinte (telegram-listener.js) reusar; só roda main() se chamado direto
module.exports = { send, tg, oget, daily, monthly, extrato, monthFlow, staleness, BRL };
if (require.main === module) main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
