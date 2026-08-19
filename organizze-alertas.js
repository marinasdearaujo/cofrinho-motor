#!/usr/bin/env node
/* ============================================================
   Cofrinho — Alertas de teto por categoria (Organizze ao vivo)
   Puxa os gastos do MÊS CORRENTE pela API e compara com os tetos
   definidos com a Marina. Uso: node organizze-alertas.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const BASE = 'https://api.organizze.com.br/rest/v2';
// Lê o .env local (cofrinho/Finanças/.env) primeiro; se não achar, cai pro .env da raiz do workspace.
const ENV_CANDIDATES = [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../../.env')];

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
const auth = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
async function get(url) {
  const res = await fetch(BASE + url, { headers: { Authorization: auth, 'User-Agent': `Cofrinho (${EMAIL})`, 'Content-Type': 'application/json' } });
  const t = await res.text();
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}
const BRL = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Tetos do mês (definidos com a Marina, ago/2026)
const CAPS = [
  { key: 'compras',     nome: '🛍️ Compras / Marketplace', teto: 600, kws: ['mercadolivre', 'mercado livre', 'mercadol', 'magalu', 'magazine', 'shein', 'amazon', 'aliexpress', 'shopee', 'tiktok shop', 'ebn', 'ebw'] },
  { key: 'ifood',       nome: '🍔 iFood / delivery',       teto: 400, kws: ['ifood', 'ifd', 'restaurante', 'lanches', 'pizz', 'burger', 'hamburg', 'bakery', 'sushi', 'habanero', 'al basha', 'dubs', 'brosa', 'sulameric', 'nupay'] },
  { key: 'mercado',     nome: '🛒 Mercado',                teto: 650, kws: ['monte carlo', 'amigao', 'atacad', 'supermerc', 'emporio', 'angelo', 'mercado monte'] },
  { key: 'assinaturas', nome: '💻 Assinaturas',            teto: 300, kws: ['netflix', 'spotify', 'openai', 'chatgpt', 'anthropic', 'claude', 'youtubepremium', 'apple.com', 'applecom', 'canva', 'elevenlabs', 'microsoft', 'registrobr', 'twilio', 'google youtube'] },
  { key: 'pet',         nome: '🐾 Pet (Paco)',             teto: 500, kws: ['pet ', 'veter', 'farmabee', 'drogavet', 'mercado pet', 'pet farma', 'pet max'] },
];

function bucket(desc) {
  const d = (desc || '').toLowerCase();
  for (const c of CAPS) if (c.kws.some(k => d.includes(k))) return c.key;
  return null;
}

(async () => {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const start = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  const end = now.toISOString().slice(0, 10);
  const txs = await get(`/transactions?start_date=${start}&end_date=${end}`);
  const spent = Object.fromEntries(CAPS.map(c => [c.key, 0]));
  for (const t of (Array.isArray(txs) ? txs : [])) {
    const v = -(t.amount_cents || 0) / 100;
    if (v <= 0) continue; // só despesas
    const b = bucket(t.description);
    if (b) spent[b] += v;
  }
  const diasNoMes = new Date(y, mo + 1, 0).getDate();
  const diaHoje = now.getDate();
  const ritmo = diaHoje / diasNoMes; // fração do mês já decorrida

  console.log(`\n🐷 ALERTAS DO COFRINHO — ${start.slice(0,7)} (dia ${diaHoje}/${diasNoMes})\n`);
  let estouro = 0;
  for (const c of CAPS) {
    const g = spent[c.key];
    const projFim = ritmo > 0 ? g / ritmo : g; // projeção pro fim do mês no ritmo atual
    const pct = Math.round((g / c.teto) * 100);
    let flag = '🟢';
    if (g > c.teto) { flag = '🔴'; estouro++; }
    else if (projFim > c.teto || pct >= 80) flag = '🟡';
    const projTxt = projFim > c.teto ? `  ⚠️ no ritmo atual fecha ~${BRL(projFim)}` : '';
    console.log(`${flag} ${c.nome.padEnd(26)} ${BRL(g).padStart(9)} / teto ${BRL(c.teto)}  (${pct}%)${projTxt}`);
  }
  console.log(`\n${estouro ? '🔴 ' + estouro + ' categoria(s) estouraram o teto.' : '✅ Nenhum teto estourado ainda.'}`);
  console.log('Rode de novo quando quiser: node organizze-alertas.js\n');
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
