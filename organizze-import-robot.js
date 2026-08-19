#!/usr/bin/env node
/* ============================================================
   Cofrinho — Robô de importação (Playwright)
   Loga no Organizze, clica "importar" nas conexões pendentes,
   pra a API enxergar os lançamentos novos sem clique manual.

   Comandos:
     node organizze-import-robot.js calibrar   -> loga, abre Conexões, dump (ajustar seletores)
     node organizze-import-robot.js importar    -> importação de verdade (headless)

   .env (mesma pasta): ORGANIZZE_EMAIL, ORGANIZZE_WEB_PASSWORD
   ============================================================ */
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(path.resolve(__dirname, '../../receitas-scraper/node_modules/playwright'))); }

const env = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const EMAIL = env.ORGANIZZE_EMAIL, PASS = env.ORGANIZZE_WEB_PASSWORD;
const STATE = path.resolve(__dirname, '.organizze-session.json');
const LOGIN_URL = 'https://auth.organizze.com.br/login';

async function novoContexto(browser) {
  const opts = { viewport: { width: 1400, height: 1000 } };
  if (fs.existsSync(STATE)) opts.storageState = STATE;
  return browser.newContext(opts);
}
function estaLogado(page) {
  return /app\.organizze\.com\.br/.test(page.url()) && !/login|entrar/i.test(page.url());
}
async function logar(page, ctx) {
  if (!PASS) throw new Error('Falta ORGANIZZE_WEB_PASSWORD no .env');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.getByRole('button', { name: /^Entrar$/i }).click().catch(() => page.click('button[type="submit"]'));
  await page.waitForTimeout(5000);
  await ctx.storageState({ path: STATE });
}
async function garantirLogin(page, ctx) {
  await page.goto('https://app.organizze.com.br/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (!estaLogado(page) || await page.locator('input[type="password"]').count()) {
    await logar(page, ctx);
    await page.goto('https://app.organizze.com.br/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
}
async function irParaConexoes(page) {
  await page.getByRole('link', { name: /conex.o banc.ria/i }).first().click().catch(() => {});
  await page.waitForTimeout(3500);
}
async function calibrar() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await novoContexto(browser); const page = await ctx.newPage();
  await garantirLogin(page, ctx); await irParaConexoes(page);
  const txt = await page.evaluate(() => document.body.innerText);
  console.log('URL:', page.url()); console.log(txt.slice(0, 1500));
  await browser.close();
}
async function importar() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await novoContexto(browser); const page = await ctx.newPage();
  await garantirLogin(page, ctx); await irParaConexoes(page);
  let cliques = 0;
  const alvos = page.locator('button, a, [role=button]').filter({ hasText: /importar|lan.amentos novos/i });
  const n = await alvos.count();
  for (let i = 0; i < n; i++) { try { await alvos.nth(i).click({ timeout: 4000 }); cliques++; await page.waitForTimeout(3000); } catch (e) {} }
  console.log(`Cliques de importação: ${cliques}`);
  await ctx.storageState({ path: STATE }); await browser.close();
}
const cmd = process.argv[2] || 'importar';
(cmd === 'calibrar' ? calibrar : importar)().catch(e => { console.error('Erro:', e.message); process.exit(1); });
