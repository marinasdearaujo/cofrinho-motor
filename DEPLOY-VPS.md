# 🖥️ Deploy do Cofrinho na VPS (24/7)

Rodar o robô de importação (Organizze) + alertas do Telegram sozinho na VPS.

## ⚠️ Segurança
As credenciais NÃO estão no repo (o `.env` é gitignored). São criadas na VPS no passo 3.

## 1. Clonar (na VPS)
```
git clone https://github.com/marinasdearaujo/cofrinho-motor.git
cd cofrinho-motor
```

## 2. Node 20+ e Playwright
```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install
npx playwright install --with-deps chromium
```

## 3. Criar o `.env` (a Marina passa os valores)
```
ORGANIZZE_EMAIL=
ORGANIZZE_API_TOKEN=
ORGANIZZE_WEB_PASSWORD=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 4. Testar
```
node organizze-import-robot.js importar
node telegram-bot.js daily
bash rodar-cofrinho.sh
```

## 5. Cron (9h e 21h; AJUSTE O FUSO se a VPS for UTC: 9h BRT = 12h UTC)
```
crontab -e
0 9,21 * * * cd ~/cofrinho-motor && bash rodar-cofrinho.sh >> cofrinho-cron.log 2>&1
```

## 6. Desligar o do Mac da Marina (evita rodar em dobro)
```
launchctl unload ~/Library/LaunchAgents/com.cofrinho.diario.plist
```
