#!/bin/bash
# ============================================================
# Cofrinho — ciclo diário autônomo
#   1) robô importa os lançamentos novos no Organizze
#   2) manda o pulso diário no Telegram (dia 1 do mês: resumo mensal)
# Rode: bash rodar-cofrinho.sh
# ============================================================
cd "$(dirname "$0")" || exit 1
# garante que o node é achado quando rodar pelo agendador (launchd usa PATH mínimo)
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"

echo "[$(date '+%Y-%m-%d %H:%M')] === Cofrinho: ciclo diário ==="

echo "-> importando lançamentos novos (robô)..."
node organizze-import-robot.js importar

sleep 4

DIA=$(date '+%d')
if [ "$DIA" = "01" ]; then
  echo "-> dia 1: enviando RESUMO MENSAL..."
  node telegram-bot.js monthly
else
  echo "-> enviando pulso diário..."
  node telegram-bot.js daily
fi

echo "[$(date '+%Y-%m-%d %H:%M')] === fim ==="
