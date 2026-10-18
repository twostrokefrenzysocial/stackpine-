# Optimus

A personal AI assistant for Android (built and tuned for the Samsung Galaxy S24 Ultra). Optimus sees your texts, calls, notifications, calendar, email, photos and contacts, remembers you across conversations, and acts only after you approve.

> First time? Follow **[SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md)**. It walks through every account and key, step by step.

## What's in this folder

| Path | What it is |
| --- | --- |
| `src/app/` | Screens (Expo Router). `index` = Command Center, `chat/[id]`, `memory`, `activity`, `settings`, `onboarding`, plus `voice` and `brief` deep-link entries. |
| `src/core/` | The brain, in plain TypeScript with no React Native imports, so it's unit tested in Node. Memory, tools, the agent loop, confirmation logic, redaction, the daily brief, backup. |
| `src/platform/` | Device glue: encrypted SQLite, secure storage, the Claude client (via your proxy), real data sources, voice, notifications, background tasks, the widget. |
| `src/ui/` | Design system (see `.claude/skills/optimus-design/`): black/white/red tokens, panels, the live 3D neural brain avatar, cards, controls. |
| `modules/optimus-android/` | A local native module (Kotlin): SMS/MMS, call log, the notification listener (with on-device passcode redaction and an encrypted queue), Samsung setup checks. |
| `proxy/` | A Cloudflare Worker that holds your Anthropic API key, checks the app token, rate-limits, and enforces the monthly spending cap. See `proxy/README.md`. |
| `assets/` | Brand art rendered from the brain geometry (`scripts/render-brand.mjs`), mock photos (`scripts/render-mock-photos.mjs`), sounds. |
| `.claude/skills/optimus-design/` | The design system skill: colors, type, components, motion, and the brain avatar spec. |

## How it works

- **Conversation:** `src/core/llm/agent.ts` streams from Claude Sonnet 5.5 through the proxy, with tools. Each request is capped at 8 tool calls, after which Optimus must answer with what it has. The system prompt and core "About Me" memories are prompt-cached; per-turn context (time, permissions, relevant memories) is a separate uncached block.
- **Background jobs:** Claude Haiku 5.5 extracts durable facts and episode summaries after a conversation goes quiet, keeps a rolling summary for long chats, and writes the brief's prose.
- **Safety:** third-party content is wrapped in `<untrusted_data>` and scanned for instruction-like text (`src/core/safety/untrusted.ts`). Suspicious items are flagged in chat and in the Activity Log. Tools can only *propose* sends, calls, edits and deletes. Those run only when you tap **Approve** on the card (`src/core/actions/actions.ts`).
- **Memory:** three layers in encrypted SQLite (SQLCipher, key in the Android Keystore): conversations, long-term facts (FTS5 search, with dedupe, contradiction updates and one entry per person), and episodes. Facts learned from your data wait in **Memory Core › Pending** until you approve them.
- **Offline:** past conversations, memories and the last brief are local, so they still work offline. Without a proxy configured, an offline *demo brain* (keyword rules, clearly labelled) lets you try every flow in Mock Data Mode.

## Commands

```bash
npm install
npm test               # unit tests (core + proxy)
npm run typecheck      # TypeScript
npm run lint           # ESLint (expo config)
npm start              # Metro for the dev client
npx eas-cli@latest build --profile preview --platform android   # installable APK
npx eas-cli@latest update --channel preview --message "..."     # JS-only update, no reinstall
```

The browser preview (`npm run web`) is only for checking layouts. It runs on mock data, and SQLite there has no FTS5, so search falls back to simple keyword matching.

## Data modes

**Settings › Data mode** switches between **Mock** and **Real**.

- **Mock** uses a realistic fake phone (`src/core/mock/`): the Ruiz family, Dave's moved 3 PM, Sarah waiting on feedback, a phishing email, passcode notifications and illustrated photos.
- **Real** reads the phone, using only the permissions you've granted. Anything Optimus can't see, it tells you.
