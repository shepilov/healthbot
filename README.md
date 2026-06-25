# Healthbot

Telegram health tracking bot MVP.

This first version runs with long polling and stores no user data persistently. Later issues add the event store, questionnaires, and read models.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Telegram bot token from [BotFather](https://t.me/BotFather)

## Setup

```sh
npm install
cp .env.example .env
```

Put your Telegram bot token in `.env`:

```sh
BOT_TOKEN=123456:your-real-token
LOG_LEVEL=info
```

The app loads `.env` automatically on startup.

## Development

```sh
npm run dev
```

The bot starts in Telegram long-polling mode. No public HTTPS endpoint is required for local development.

## Checks

```sh
npm run lint
npm test
npm run build
```

## MVP Limitations

- Data is not persisted yet and will be lost when the process restarts.
- The bot does not provide medical advice, diagnosis, lab interpretation, or photo analysis.
- Webhook deployment is intentionally out of scope for the first scaffold.
