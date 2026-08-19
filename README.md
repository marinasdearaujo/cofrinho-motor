# 🐷 Cofrinho — Motor

Motor autônomo das finanças de Marina & Higor:
- **Robô de importação** (`organizze-import-robot.js`) — loga no Organizze e importa os lançamentos novos (Playwright).
- **Bot de alertas** (`telegram-bot.js`) — puxa gastos do mês ao vivo e manda pulso diário + resumo mensal no Telegram.
- **Ciclo** (`rodar-cofrinho.sh`) — roda os dois em sequência; agendado no cron.

Deploy 24/7 numa VPS: ver **[DEPLOY-VPS.md](DEPLOY-VPS.md)**.

As credenciais ficam num `.env` local (gitignored) — nunca neste repositório.
