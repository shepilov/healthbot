# Healthbot

Telegram health tracking bot MVP.

The bot runs locally with Telegram long polling, stores data in memory, and uses
event-sourced domain events plus read models for status. There is no persistent
database in the MVP, so all user data is lost when the process restarts.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Telegram bot token from [BotFather](https://t.me/BotFather)

## Telegram Bot Token

Create a development bot in Telegram:

1. Open [BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Choose a display name and username.
4. Copy the token into `.env` as `BOT_TOKEN`.

Do not commit real bot tokens. `.env` is ignored by git.

## Setup

```sh
npm install
cp .env.example .env
```

Configure `.env`:

```sh
BOT_TOKEN=123456:your-real-token
LOG_LEVEL=info
```

The app loads `.env` automatically on startup.

## Running Locally

```sh
npm run dev
```

The bot starts in Telegram long-polling mode. No public HTTPS endpoint or
webhook tunnel is required for local development.

For a production-style local build:

```sh
npm run build
npm start
```

## Bot Commands

- `/start` starts profile intake if the profile is missing, otherwise shows
  available commands.
- `/profile` restarts the one-time profile questionnaire.
- `/daily` starts the daily check-in.
- `/weekly` starts the weekly check-in with face photo upload.
- `/monthly` starts the monthly lab values flow.
- `/status` shows profile status, active questionnaire, and latest completed
  daily, weekly, and monthly periods.
- `/cancel` cancels the active questionnaire.

## Architecture

- `src/domain` contains event types, the in-memory event store, event bus, and
  generic projector helpers.
- `src/questionnaire` contains the declarative questionnaire definitions and
  questionnaire engine.
- `src/telegram` contains the Grammy adapter, command routing, inline keyboard
  rendering, and Telegram-specific parsing.
- `src/status` contains read models projected from append-only events.

Questionnaire completions emit domain events. Daily, weekly, and monthly flows
also emit `PeriodCheckInCompleted` events. Read models treat repeated check-ins
for the same period as replacement at projection time while preserving the full
append-only event history.

## Testing And Checks

Run the automated Vitest suite:

```sh
npm test
```

Useful local checks:

```sh
npm run typecheck
npm run lint
npm run build
npm run format:check
npm audit --json
```

The test suite covers questionnaire progression, validation, conditional
questions, cancellation, photo/lab handling, status projection, period
replacement semantics, and Telegram adapter command handling with mocked
Telegram API calls.

## In-Memory Data

The MVP uses:

- `InMemoryEventStore` for domain events
- `InMemoryActiveFlowStore` for active questionnaire state
- in-process read model projection from stored events

This is intentionally replaceable. A persistent implementation should keep the
same `EventStore` and `ActiveFlowStore` interfaces, store events append-only,
and rebuild read models by replaying events through the existing projectors.

## MVP Limitations

- Data is not persisted and will be lost when the process restarts.
- The bot does not provide medical advice, diagnosis, lab interpretation, or
  photo analysis.
- Face photos are not downloaded or analyzed; only Telegram `file_id` is
  recorded in memory.
- Lab values are validated as numbers only; there is no medical interpretation.
- Webhook deployment, reminders, scheduling, authentication beyond Telegram,
  and external analytics are out of scope for the MVP.
