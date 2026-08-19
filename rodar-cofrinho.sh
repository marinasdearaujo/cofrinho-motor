#!/bin/bash
# Cofrinho — ciclo diário autônomo: robô importa -> manda pulso no Telegram (dia 1: resumo mensal)
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
echo "[$(date '+%Y-%m-%d %H:%M')] === Cofrinho: ciclo ==="
echo "-> importando (robô)..."
node organizze-import-robot.js importar
sleep 4
if [ "$(date '+%d')" = "01" ]; then
  echo "-> resumo mensal..."; node telegram-bot.js monthly
else
  echo "-> pulso diário..."; node telegram-bot.js daily
fi
echo "[$(date '+%Y-%m-%d %H:%M')] === fim ==="
