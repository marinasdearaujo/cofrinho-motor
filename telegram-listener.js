#!/usr/bin/env node
/* ============================================================
   Cofrinho — Ouvinte do Telegram (roda contínuo na VPS)
   - Responde comandos: /hoje /mes /extrato /ajuda
   - Responde PERGUNTAS SOLTAS via IA (Gemini), lendo os dados reais do Organizze.
     Ex: "de onde vieram as entradas?", "quanto posso gastar em compras ainda?"

   Rode como serviço: node telegram-listener.js  (fica escutando pra sempre)
   .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY (+ Organizze)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const bot = require('./telegram-bot.js');

const env = {};
for (const ENV of [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../../.env')]) {
  try { for (const l of fs.readFileSync(ENV, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } } catch (e) {}
}
const GKEY = env.GEMINI_API_KEY, GMODEL = env.GEMINI_MODEL || 'gemini-3.6-flash';
const CHAT = env.TELEGRAM_CHAT_ID;

// Monta o contexto financeiro do mês pra IA responder ancorada nos dados reais
async function contexto() {
  const { entradas, saidas, porCat, incomes, gastos, mes, hoje, dias } = await bot.monthFlow();
  const inLines = incomes.slice().sort((a, b) => b[0] - a[0]).map(([v, d]) => `  +R$${v.toFixed(0)} — ${d}`).join('\n') || '  (nenhuma)';
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([n, v]) => `  ${n}: R$${v.toFixed(0)}`).join('\n');
  const top = gastos.slice().sort((a, b) => b.val - a.val).slice(0, 20).map(g => `  R$${g.val.toFixed(0)} — ${g.d} [${g.cat}]`).join('\n');
  return `Mês de referência: ${mes} (hoje é dia ${hoje} de ${dias}).
ENTRADAS totais: R$${entradas.toFixed(0)}
ENTRADAS (item a item):\n${inLines}
SAÍDAS totais: R$${saidas.toFixed(0)}
SAÍDAS por categoria:\n${cats}
MAIORES GASTOS (transação a transação):\n${top}
TETOS definidos por categoria: Compras R$600, iFood/Alimentação R$400, Mercado R$650, Assinaturas R$300, Pets R$500.
Obs: transferências entre contas da própria Marina/Higor já foram removidas dos números.`;
}

async function perguntarIA(pergunta) {
  const ctx = await contexto();
  const prompt = `Você é o assistente financeiro pessoal do app "Cofrinho", da Marina e do Higor. Responda em português do Brasil, curto, direto e amigável (emoji com moderação). Use SOMENTE os dados abaixo; se a informação não estiver neles, diga que não tem esse dado no registro do mês. Nunca invente valores.

=== DADOS DO MÊS ===
${ctx}

=== PERGUNTA DA MARINA ===
${pergunta}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GMODEL}:generateContent?key=${GKEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const j = await r.json();
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text;
    return txt || '🤔 Não consegui pensar numa resposta agora. Tenta perguntar de outro jeito?';
  } catch (e) { return '⚠️ A IA não respondeu (' + e.message + '). Tenta de novo?'; }
}

// Retorna { texto, html } — comandos vêm em HTML, respostas da IA em texto puro
async function responder(text) {
  const t = (text || '').trim().toLowerCase();
  if (['/start', '/ajuda', '/help'].includes(t))
    return { texto: 'Oi! 🐷 Sou o Cofrinho. Você pode:\n\n<b>/hoje</b> — pulso do dia (tetos)\n<b>/mes</b> — resumo do mês\n<b>/extrato</b> — onde o dinheiro foi (Pareto)\n\nOu me <b>perguntar à vontade</b>, tipo:\n· "de onde vieram as entradas?"\n· "quanto já gastei com iFood?"\n· "posso gastar mais em compras?"', html: true };
  if (['/hoje', '/pulso'].includes(t)) return { texto: await bot.daily(), html: true };
  if (['/mes', '/mês', '/resumo'].includes(t)) return { texto: await bot.monthly(), html: true };
  if (t === '/extrato') return { texto: await bot.extrato(), html: true };
  return { texto: await perguntarIA(text), html: false };
}

async function loop() {
  let offset = 0;
  console.log('🐷 Ouvinte do Cofrinho no ar. Escutando o Telegram...');
  while (true) {
    try {
      const r = await bot.tg('getUpdates', { offset, timeout: 50 });
      for (const u of (r.result || [])) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m || !m.text) continue;
        if (CHAT && String(m.chat.id) !== String(CHAT)) continue; // só responde à Marina
        try {
          const { texto, html } = await responder(m.text);
          await bot.tg('sendMessage', { chat_id: m.chat.id, text: texto, parse_mode: html ? 'HTML' : undefined, disable_web_page_preview: true });
        } catch (e) {
          await bot.tg('sendMessage', { chat_id: m.chat.id, text: '⚠️ Erro: ' + e.message });
        }
      }
    } catch (e) { await new Promise(res => setTimeout(res, 5000)); }
  }
}
loop();
