#!/usr/bin/env node
/* ============================================================
   BRIDGE Organizze -> Cofrinho
   Gera cofrinho-completo.json a partir dos dados REAIS e ao vivo do Organizze:
   saldos, 4 cartões reais, transações honestas (transferências fora), projeção.
   Uso: node organizze-to-cofrinho.js   (gera JSON + copia p/ ~/Downloads)
   ============================================================ */
const fs = require('fs'), path = require('path'), os = require('os');
const env = {}; for (const ENV of [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../../.env')]) { try { for (const l of fs.readFileSync(ENV, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim(); } } catch (e) {} }
const H = { Authorization: 'Basic ' + Buffer.from(env.ORGANIZZE_EMAIL + ':' + env.ORGANIZZE_API_TOKEN).toString('base64'), 'User-Agent': 'Cofrinho (' + env.ORGANIZZE_EMAIL + ')' };
const B = 'https://api.organizze.com.br/rest/v2';
const TODAY = '2026-07-29', CM = TODAY.slice(0, 7);
const g = async u => (await fetch(B + u, { headers: H })).json();
// Contas de NEGÓCIO do Higor (Chef Foods) — passam centenas de milhares, NÃO são finanças pessoais. Excluir.
const EXCLUDE_ACCOUNTS = new Set([10309131]);
const parseBal = s => typeof s === 'number' ? s : parseFloat(String(s).replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

/* ---- mapa de cartão -> pessoa/apelido ---- */
const CARD_META = {
  2577034: { name: 'Nubank (Marina)', color: '#7c5cff', who: 'Marina' },
  2578643: { name: 'Itaú (Marina)', color: '#ffa94d', who: 'Marina' },
  2577036: { name: 'Nubank (Higor)', color: '#22d3ee', who: 'Higor' },
  2578644: { name: 'Itaú (Higor)', color: '#34e0a1', who: 'Higor' },
};

/* ---- categorização: regras de merchant BR (desc) + fallback categoria Organizze ---- */
const RULES = [
  ['doacao', /vakinha|d[ií]zimo|sine cera|igreja|paroqui|doacao|doa[cç]ão|oferta/i],
  ['financiamento', /safra|crefisa|consignado|crediar|losango|fininvest|financiam|empr[eé]stimo|parcela.*carro/i],
  ['transporte', /\buber\b|\b99\b|99app|indigo|estacion|unipark|posto|combust|shell|ipiranga|petrobr|passagem|gasolina|jardim das americas/i],
  ['mercado', /monte carlo|amigao|amigão|atacad|condor|super ?merc|carrefour|muffato|tonin|hortifr|emporio|nildo ribeiro|mercado\b/i],
  ['restaurante', /ifood|ifd\*|habanero|brosa|companhia sulameric|pizzar|\bcafe\b|gelato|kozuki|\bbar\b|burger|sushi|lanch|delivery|outback|mcdonald|subway|habib|al basha|infinite house|dubs/i],
  ['pet', /\bpet\b|petshop|pet max|cobasi|petz|veter|ra[cç][aã]o|inuvet|pet farma|drogavet|agropet/i],
  ['saude', /farmacia|farmácia|drogaria|panvel|\braia\b|unimed|dimed|manipula|pague menos|nissei|drogasil|pacheco|clinica|laborat|hospital|exame|medic|cirurgia|andreogarcia|andreo garcia|psicorp|psicol/i],
  ['assinatura', /google|openai|chatgpt|anthropic|claude|apple\.com|spotify|\bcanva\b|netflix|elevenlabs|riversidefm|amazon prime|prime video|youtube|microsoft|icloud|hbo|disney|notion|adobe|figma|hetzner|hostinger|vercel|submagic|ebw\*/i],
  ['compras', /mercadolivre|mercado ?livre|mercadol|shopee|shein|magalu|magazine|aliexpress|amazon|\bmag\*|vidrosho|infocent|ismafer|confec/i],
  ['casa', /casa das cores|tintas|viverde|liggas|\bgas\b|leroy|telha|constru|madeira|gmad|eletric|hidrau|ferragem|balaroti|obramax|cassol|m[oó]veis|c e z/i],
  ['lazer', /espacolaser|espaçolaser|\blaser\b|smartfit|smart fit|academia|cinema|ingresso|bilharama|dinos alive|jockey|country|bovolini|diversoes|diversões/i],
  ['educacao', /casa do saber|curso|faculdade|udemy|alura|hotmart|kiwify|jim\.com|registrobr|registro\.br/i],
];
const ORG2COF = { 'Bares e restaurantes': 'restaurante', 'Roupas': 'compras', 'Dívidas e empréstimos': 'financiamento', 'Educação': 'educacao', 'Lazer e hobbies': 'lazer', 'Alimentação': 'mercado', 'Presentes e doações': 'doacao', 'Mercado': 'mercado', 'Saúde': 'saude', 'Casa': 'casa', 'Cuidados pessoais': 'lazer', 'Pets': 'pet', 'Compras': 'compras', 'Assinaturas e serviços': 'assinatura', 'Impostos e Taxas': 'outros', 'Transporte': 'transporte', 'Viagem': 'lazer', 'Trabalho': 'trabalho', 'Família e filhos': 'outros' };
function catOf(desc, orgCatName) {
  const d = desc || '';
  for (const [c, re] of RULES) if (re.test(d)) return c;
  return ORG2COF[orgCatName] || 'outros';
}

/* ---- detecção de transferência interna (não é renda/gasto real) ---- */
const SELF = /marina scheffer|higor vieira dantas/i, FATURA = /pagamento de fatura/i,
  INVEST = /resgate|valor recebido de investimentos|aplica[cç]|nu sele[cç]|\brdb\b|tesouro|rentab/i,
  PIXCRED = /valor adicionado.*cart[aã]o|pix no cr[eé]dito|adicionado para pix/i,
  INTERBANK = /banco inter|cr[eé]dito em conta/i, CARDPAY = /itau unibanco holding|ita[uú] unibanco holding/i,
  FAMILIA = /suzilaine|c e z moveis|c e z móveis|matheus henrique/i;
function isTransfer(t, pairCount) {
  const d = t.description || '';
  if (FATURA.test(d) || SELF.test(d) || INVEST.test(d) || PIXCRED.test(d) || INTERBANK.test(d) || CARDPAY.test(d) || FAMILIA.test(d)) return true;
  if ((pairCount[t.date + '|' + Math.abs(t.amount_cents)] || 0) >= 2) return true; // par casado mesmo dia
  return false;
}

const MES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesLabel = iso => { const [y, m] = iso.split('-'); return MES_PT[+m - 1] + '/' + y.slice(2); };
const round2 = n => Math.round(n * 100) / 100;
const cleanDesc = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 42);

(async () => {
  /* 1) saldos */
  const accsList = await g('/accounts');
  const accounts = [];
  let reserve = 0;
  for (const a of accsList) { if (EXCLUDE_ACCOUNTS.has(a.id)) continue; const d = await g('/accounts/' + a.id); const bal = parseBal(d.balance); accounts.push({ name: a.name, balance: round2(bal), poupanca: /poupan/i.test(a.name) }); reserve += bal; }
  reserve = round2(reserve);

  /* 2) categorias (id->nome) */
  const catList = await g('/categories'); const catName = {}; for (const c of catList) catName[c.id] = c.name;

  /* 3) cartões + faturas (com itens agrupados das transações) */
  const cardList = await g('/credit_cards');
  // transações do MÊS CORRENTE (extrato) — pull focado (evita duplicação de range enorme)
  let cmTx = [], page = 1;
  while (true) { const r = await g(`/transactions?start_date=${CM}-01&end_date=${CM}-31&page=${page}`); if (!Array.isArray(r) || !r.length) break; cmTx = cmTx.concat(r.filter(t => !EXCLUDE_ACCOUNTS.has(t.account_id))); if (r.length < 100) break; page++; if (page > 12) break; }
  const pairCount = {}; for (const t of cmTx) { const k = t.date + '|' + Math.abs(t.amount_cents); pairCount[k] = (pairCount[k] || 0) + 1; }

  const cards = [];
  for (const c of cardList) {
    const meta = CARD_META[c.id] || { name: c.name, color: '#7c5cff', who: '?' };
    const inv = await g('/credit_cards/' + c.id + '/invoices');
    // só faturas NÃO pagas (vencimento >= hoje). Julho já fechou/pagou.
    const fut = (Array.isArray(inv) ? inv : []).filter(i => i.date >= TODAY).sort((a, b) => a.date.localeCompare(b.date));
    const faturas = fut.map(i => ({ mes: mesLabel(i.date), venc: i.date, total: round2(Math.abs(i.amount_cents) / 100), items: [] }));
    const next = faturas[0];
    cards.push({ id: 'card_' + c.id, name: meta.name, color: meta.color, fecha: c.closing_day,
      proxFatura: next ? next.total : 0, proxVenc: next ? next.venc : '', totalAberto: round2(faturas.reduce((s, f) => s + f.total, 0)), faturas });
  }

  /* 4) extrato do mês corrente (transações reais, transferências fora) */
  const appTx = [];
  for (const t of cmTx) {
    if (isTransfer(t, pairCount)) continue;
    const v = t.amount_cents / 100;
    appTx.push({ id: 'o' + t.id, type: v > 0 ? 'income' : 'expense', amount: round2(Math.abs(v)),
      cat: v > 0 ? incCat(t.description) : catOf(t.description, catName[t.category_id]),
      desc: cleanDesc(t.description), date: t.date, card: t.credit_card_id ? 'card_' + t.credit_card_id : '' });
  }
  appTx.sort((a, b) => b.date.localeCompare(a.date));
  const realIn = round2(appTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const realOut = round2(appTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));

  /* 5) contas fixas manuais (não estão nos cartões) — aluguel já acabou */
  const manuais = [
    { name: 'Parcela carro do Higor', amount: 2793.34, due: nextDue(10), cat: 'transporte', repeat: true },
    { name: 'Terapia de casal (~R$215/sem)', amount: 930, due: nextDue(7), cat: 'saude', repeat: true },
    { name: 'Gasolina (~R$200/sem)', amount: 870, due: nextDue(7), cat: 'transporte', repeat: true },
    { name: 'Unimed (Marina)', amount: 550, due: nextDue(15), cat: 'saude', repeat: true },
    { name: 'Igreja (~R$100/sem)', amount: 430, due: nextDue(7), cat: 'doacao', repeat: true },
    { name: 'Mãe (envio mensal)', amount: 350, due: nextDue(5), cat: 'transferencia', repeat: true },
    { name: 'Copel (luz)', amount: 248.52, due: nextDue(10), cat: 'moradia', repeat: true },
    { name: 'Internet casa (Inova Fibra)', amount: 181.23, due: nextDue(10), cat: 'moradia', repeat: true },
    { name: 'Água (Sanepar)', amount: 150, due: nextDue(10), cat: 'moradia', repeat: true },
    { name: 'Internet praia', amount: 99.90, due: nextDue(10), cat: 'moradia', repeat: true },
    { name: 'Celular Marina', amount: 49.99, due: nextDue(10), cat: 'assinatura', repeat: true },
  ].map((m, i) => ({ id: 'b' + i, paid: false, card: '', repeat: !!m.repeat, pAtual: 0, pTotal: 0, ...m }));
  const mFixed = round2(manuais.filter(b => b.repeat).reduce((s, b) => s + b.amount, 0));

  /* 6) projeção: renda recorrente vs (faturas reais por mês + contas fixas) */
  const baseInc = 20500; // renda recorrente real (Chef ~19,5k variável + Fábio); Upwork Marina entra à parte quando confirmar
  const months = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const projection = months.map(mk => {
    let cartao = 0;
    cards.forEach(c => c.faturas.forEach(f => { if ((f.venc || '').slice(0, 7) === mk) cartao += f.total; }));
    const saida = mFixed + cartao;
    return { mes: mesLabel(mk + '-01'), ym: mk, entrada: Math.round(baseInc), saida: Math.round(saida), fixo: Math.round(mFixed), cartao: Math.round(cartao) };
  });

  /* 6b) gasto por categoria no mês corrente (real) — pra tela de Limites */
  const catSpent = {};
  for (const t of appTx) if (t.type === 'expense') catSpent[t.cat] = round2((catSpent[t.cat] || 0) + t.amount);

  /* 6c) próximos passos (microações calculadas) */
  const fmtBR = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const nextSteps = [];
  const augCard = cards.reduce((s, c) => s + (c.proxFatura || 0), 0);
  const sepCard = cards.reduce((s, c) => s + ((c.faturas[1]) ? c.faturas[1].total : 0), 0);
  const drop = round2(augCard - sepCard);
  const faltaReserva = Math.max(0, 11000 - reserve);
  if (faltaReserva > 0) nextSteps.push({ icon: '🛟', t: `Reserva de 1 mês: faltam ${fmtBR(faltaReserva)}`, d: `Você tem ${fmtBR(reserve)}. A meta mínima é R$ 11.000 (1 mês de gastos). É o alvo nº1.` });
  if (drop > 200) nextSteps.push({ icon: '📉', t: `As faturas caem ${fmtBR(drop)} de ago → set`, d: `O rabo das parcelas derrete. Quando cair, mande a diferença direto pra reserva — sem nem sentir.` });
  nextSteps.push({ icon: '🪜', t: `Escadinha de agosto: guarde o piso`, d: `Comece pequeno e nunca pule. Em mês que sobrar, jogue o extra por cima com o botão Guardar.` });
  nextSteps.push({ icon: '🚫', t: `Regra de ouro: não parcelar compra nova`, d: `Cada parcela nova estica o rabo. Segurar compras novas é o que faz a sobra crescer de +${fmtBR(projection[0].entrada - projection[0].saida)} p/ +${fmtBR(projection[4].entrada - projection[4].saida)} até dezembro.` });

  /* 7) monta DB do Cofrinho (preserva escadinha + metas como defaults) */
  const DB = {
    _fonte: 'Organizze API (auto-sync) — ' + TODAY, _reserva: reserve, _accounts: accounts,
    _resumoMes: { entra: realIn, sai: realOut },
    projection, tx: appTx,
    catBudgets: { restaurante: 800, compras: 700, pet: 550, assinatura: 450, outros: 500, mercado: 500, transporte: 400, saude: 400, lazer: 250, casa: 300, educacao: 150, moradia: 300, doacao: 450, transferencia: 400, trabalho: 800 },
    incomes: [
      { id: 'inc_chef', source: 'Higor (Chef Foods)', amount: 19500, who: 'Higor', confirmed: true, note: 'variável — o que fica na conta' },
      { id: 'inc_upwork', source: 'Upwork (Marina)', amount: 3800, who: 'Marina', confirmed: false, note: 'varia mês a mês' },
      { id: 'inc_fabio', source: 'Fábio (pai) — ajudas', amount: 1050, who: 'Marina', confirmed: true, note: 'carro/lavar' },
    ],
    cards,
    bills: manuais.sort((a, b) => a.due.localeCompare(b.due)),
    goals: [
      { id: 'g_reserva', name: 'Reserva de emergência', emoji: '🛟', target: 10000, current: reserve, deadline: '', reward: 'Tranquilidade total 😌' },
      { id: 'g_casa', name: 'Casa nova Maringá', emoji: '🏠', target: 145000, current: 0, deadline: '', reward: 'Chave na mão 🔑' },
    ],
    ladder: { start: 10, step: 5, startMonth: '2026-08', months: 24, done: {}, goalId: 'g_reserva' },
    budget: 0, xp: 0, streak: 0, lastDay: null, badges: [], rewards: [], eye: true, seeded: true,
  };
  const outPath = path.join(__dirname, 'cofrinho-completo.json');
  fs.writeFileSync(outPath, JSON.stringify(DB, null, 1));
  try { fs.writeFileSync(path.join(os.homedir(), 'Downloads', 'cofrinho-completo.json'), JSON.stringify(DB, null, 1)); } catch (e) {}

  console.log('✅ Bridge OK — cofrinho-completo.json gerado + copiado p/ Downloads\n');
  console.log('💰 Reserva (saldo líquido):', 'R$ ' + reserve.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  console.log('📥 Julho real: entra R$', realIn.toLocaleString('pt-BR'), '| sai R$', realOut.toLocaleString('pt-BR'));
  console.log('💳 Cartões (próx fatura):');
  for (const c of cards) console.log('   ' + c.name.padEnd(16) + 'R$ ' + c.proxFatura.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' (' + c.proxVenc + ') • aberto R$ ' + c.totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  console.log('\n📊 Projeção (entra x sai):');
  let acc = 0; for (const p of projection) { const net = p.entrada - p.saida; acc += net; console.log('   ' + p.mes + '  entra ' + p.entrada + '  sai ' + p.saida + '  net ' + (net >= 0 ? '+' : '') + net + '  acum ' + (acc >= 0 ? '+' : '') + acc); }
})();

/* ---- helpers ---- */
function nextDue(day) { const d = new Date(2026, 6, 29); let mo = d.getMonth(), yr = d.getFullYear(); if (d.getDate() > day) mo++; if (mo > 11) { mo = 0; yr++; } return `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function sameInvoiceMonth(txDate, closingDay, invMonth) {
  // fatura que fecha dia X no mês M cobre compras de (dia X do mês M-1) até (dia X do mês M) -> vence no mês M
  const [ty, tm, td] = txDate.split('-').map(Number);
  let iy = +invMonth.slice(0, 4), im = +invMonth.slice(5, 7);
  // janela: compra pertence à fatura do mês seguinte ao fechamento
  const afterClosingPrev = (ty === iy && tm === im && td <= closingDay) || (tm === im - 1 && td > closingDay) || (im === 1 && tm === 12 && ty === iy - 1 && td > closingDay);
  return afterClosingPrev;
}
function incCat(desc) { const d = desc || ''; if (/chef foods|salario|salário/i.test(d)) return 'salario'; if (/upwork/i.test(d)) return 'trabalho'; if (/fabio|fábio/i.test(d)) return 'presente'; return 'outros'; }
