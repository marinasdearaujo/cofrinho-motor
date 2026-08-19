#!/usr/bin/env node
/* ============================================================
   Organizze auto-sync — Cofrinho
   Puxa contas, cartões, faturas e transações (12m) da API do Organizze,
   que por sua vez sincroniza Nubank/Itaú (seus + do Higor) via Open Finance.

   Auth: HTTP Basic (email + API token). Gere o token em:
   Organizze web -> Configurações -> Ferramentas para desenvolvedores -> API.

   .env:
     ORGANIZZE_EMAIL=voce@email.com
     ORGANIZZE_API_TOKEN=xxxx

   Uso:
     node organizze-sync.js auth     -> testa credenciais
     node organizze-sync.js sync     -> organizze-raw.json + organizze-resumo.md
   ============================================================ */
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.organizze.com.br/rest/v2';
const DIR = __dirname;
// .env local (cofrinho/Finanças/.env) tem prioridade; fallback pro .env da raiz.
const ENV_CANDIDATES = [path.resolve(DIR, '.env'), path.resolve(DIR, '../../.env')];
const RAW_FILE = path.join(DIR, 'organizze-raw.json');
const RESUMO_FILE = path.join(DIR, 'organizze-resumo.md');

function loadEnv() {
  const out = {};
  for (const ENV of ENV_CANDIDATES) {
    try {
      for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    } catch (e) {}
  }
  return out;
}
const env = loadEnv();
const EMAIL = env.ORGANIZZE_EMAIL, TOKEN = env.ORGANIZZE_API_TOKEN;

function authHeader() {
  if (!EMAIL || !TOKEN) throw new Error('Faltam ORGANIZZE_EMAIL / ORGANIZZE_API_TOKEN no .env');
  return 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
}
async function get(url) {
  const res = await fetch(BASE + url, {
    headers: {
      'Authorization': authHeader(),
      'User-Agent': `Cofrinho (${EMAIL})`,   // Organizze exige User-Agent com contato
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${String(text).slice(0, 300)}`);
  return data;
}
const fmt = n => 'R$ ' + (Number(n || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Organizze devolve valores em CENTAVOS -> dividir por 100.

async function cmdAuth() {
  const accs = await get('/accounts');
  console.log(`✅ Conectado ao Organizze. ${accs.length} conta(s) visível(is).`);
}

async function cmdSync() {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const accounts = await get('/accounts');
  const cards = await get('/credit_cards');
  const raw = { geradoEm: new Date().toISOString(), accounts, credit_cards: cards, invoices: {}, transactions: [] };

  // faturas por cartão
  for (const c of cards) {
    try { raw.invoices[c.id] = await get(`/credit_cards/${c.id}/invoices`); } catch (e) { raw.invoices[c.id] = { erro: e.message }; }
  }
  // transações 12m (a API pagina por período; puxa o range todo)
  try { raw.transactions = await get(`/transactions?start_date=${from}&end_date=${today}`); } catch (e) { raw.transactions = { erro: e.message }; }

  fs.writeFileSync(RAW_FILE, JSON.stringify(raw, null, 1));

  let md = `# 🏦 Reconciliação ao vivo (Organizze / Open Finance)\n\n_Puxado da API em ${new Date().toLocaleString('pt-BR')}_\n\n## Contas\n`;
  for (const a of accounts) md += `- 🏦 **${a.name}** — saldo ${fmt(a.balance_cents != null ? a.balance_cents : a.balance)}\n`;
  md += `\n## Cartões\n`;
  for (const c of cards) {
    md += `- 💳 **${c.name}** — limite ${fmt(c.limit_cents != null ? c.limit_cents : c.limit)}` +
      (c.closing_day ? ` · fecha dia ${c.closing_day}` : '') + (c.due_day ? ` · vence dia ${c.due_day}` : '') + `\n`;
    const inv = raw.invoices[c.id];
    if (Array.isArray(inv)) {
      const next = inv.filter(i => i.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || inv[inv.length - 1];
      if (next) md += `    - próxima fatura ${next.date}: ${fmt(next.amount_cents != null ? next.amount_cents : next.balance_cents)}\n`;
    }
  }
  const txN = Array.isArray(raw.transactions) ? raw.transactions.length : 0;
  md += `\n_${txN} transações nos últimos 12 meses._\n`;
  fs.writeFileSync(RESUMO_FILE, md);
  console.log('✅ Sync completo.');
  console.log('   Bruto:  ' + RAW_FILE);
  console.log('   Resumo: ' + RESUMO_FILE + '\n');
  console.log(md);
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'auth') await cmdAuth();
    else if (cmd === 'sync') await cmdSync();
    else {
      console.log('Comandos: auth | sync');
      if (!TOKEN) console.log('\n⚠️  Faltam ORGANIZZE_EMAIL e ORGANIZZE_API_TOKEN no .env');
    }
  } catch (e) { console.error('❌ ' + e.message); process.exit(1); }
})();
