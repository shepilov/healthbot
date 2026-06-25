# Telegram Web App Proposal

## Goal

Use a Telegram Web App for flows that are awkward as long chat forms, while
keeping quick check-ins chat-first.

Best candidates:

- profile intake
- monthly lab entry

Daily and weekly check-ins should stay in chat for now because they are short
and work well with inline keyboards.

## Proposed UX

Profile:

- Open a compact form from an inline button.
- Group fields by section: basic info, goals, female health, skin, care,
  chronic conditions, medications.
- Validate required fields before submit.
- Submit once and receive a Telegram recap message.

Monthly labs:

- Open a lab form with one input per lab marker.
- Empty fields are treated as skipped and recorded as `null`.
- Numeric validation runs before submit.
- Submit once and receive a compact recap with submitted values and skipped
  count.

## Event Mapping

The Web App should not bypass the domain model. Submissions should map to the
same events the chat questionnaire emits:

- `QuestionnaireStarted`
- one `AnswerRecorded` per logical question, or per form section if the
  questionnaire is later split
- `QuestionnaireCompleted`
- `PeriodCheckInCompleted` for monthly submissions

This keeps the existing read models and `/status` behavior unchanged.

## Integration Shape

1. Telegram chat sends an inline button that opens the Web App.
2. The Web App collects form data and submits it through Telegram Web App data.
3. The bot validates the submitted payload.
4. The bot calls the same questionnaire/domain services used by chat flows.
5. The bot sends a recap message.

The MVP currently has no server-side persistent storage. A Web App prototype can
still use the in-memory event store, but production use should wait until the
event store and active-flow store have persistent implementations.

## Validation

- Required profile fields must be present.
- Multi-select values must match known option ids.
- Lab values must be finite numbers or empty.
- No medical interpretation should run in the Web App or bot.

## Tradeoffs

Benefits:

- Better layout for long forms.
- Easier lab entry and editing.
- Fewer chat messages.

Costs:

- Requires a web frontend and hosting.
- Requires secure payload validation.
- Requires more explicit handling of partial form state.

## Recommendation

Do not build the Web App before persistence. First polish chat UX for daily and
weekly flows, then add persistent event storage, then prototype the Web App for
monthly labs.
