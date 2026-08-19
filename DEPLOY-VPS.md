# 🖥️ Deploy do Cofrinho na VPS (24/7) — guia pro Claude Code do Higor

Objetivo: rodar o robô de importação (Organizze) + alertas do Telegram sozinho na VPS, sem depender do Mac ligado.

## ⚠️ Segurança
As credenciais NÃO estão neste repositório (o `.env` é gitignored). Elas são criadas na VPS no passo 3. Rode só numa VPS confiável.

## 1. Clonar o repo (na VPS)
```
git clone https://github.com/marinasdearaujo/cofrinho-motor.git
cd cofrinho-motor
```
(Repo privado — precisa de token/acesso do GitHub da Marina, ou ela adiciona o Higor como colaborador.)

## 2. Instalar Node 20+ e Playwright
```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install
npx playwright install --with-deps chromium   # Chromium headless + libs do Linux
```

## 3. Criar o arquivo `.env` (as credenciais)
Crie `.env` na pasta do projeto com estas chaves (a Marina passa os valores — estão no `.env` do Mac dela em `cofrinho/Finanças/.env`):
```
ORGANIZZE_EMAIL=
ORGANIZZE_API_TOKEN=
ORGANIZZE_WEB_PASSWORD=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 4. Testar
```
node organizze-import-robot.js importar   # loga e varre (0 cliques se tudo atualizado, sem erro = ok)
node telegram-bot.js daily                # tem que chegar no Telegram da Marina
bash rodar-cofrinho.sh                     # o ciclo completo
```
Se o pulso chegou no Telegram, está funcionando.

## 5. Agendar no cron
```
crontab -e
```
Adicione (roda 9h e 21h todo dia):
```
0 9,21 * * * cd ~/cofrinho-motor && bash rodar-cofrinho.sh >> cofrinho-cron.log 2>&1
```
⚠️ **Fuso:** confira com `date`. Se a VPS estiver em UTC, 9h de Brasília = 12h UTC → use `0 12,0 * * *`.

## 6. Desligar o agendador do Mac da Marina (pra não rodar em dobro)
No Mac:
```
launchctl unload ~/Library/LaunchAgents/com.cofrinho.diario.plist
```

## Pronto
Roda sozinho na VPS, 24/7. O robô loga por email+senha (a conta aceita acesso direto), salva a sessão em `.organizze-session.json` e reusa. Logs em `cofrinho-cron.log`.
