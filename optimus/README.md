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

## Design

The visual system is defined in `.claude/skills/optimus-design/`: true black for the OLED screen, white for information, and one red used only as a signal. Type is Barlow Semi Condensed, Inter and JetBrains Mono. The avatar is a procedural 3D neural brain (`src/core/brain` for geometry and the state machine, `src/ui/components/BrainImpl.tsx` for Skia rendering on the UI thread). It is idle, listening, thinking or responding, follows the mic level and speech, and slows down for reduce motion and power saving. The app is dark mode only.

## Verification

```bash
npm run verify                     # typecheck + lint + 151 unit tests
./scripts/check-android-kotlin.sh  # compiles the native Kotlin against the Android 15 framework (no SDK needed)
npx expo prebuild --platform android --no-install   # config plugins → Android project
npx expo export --platform android # Hermes JS bundle
```

The unit tests cover memory (save, dedupe, contradictions, people, forget cascades, retrieval budget and ranking), confirmation logic, tools through the agent loop (8-call cap, untrusted-data wrapping, injection flags, missing permissions), redaction and retention, the brief, backup/restore, email parsing, the brain geometry and state machine, and the proxy (auth, cap, rate limit, streaming cost accounting).

## Known limitations

- **No arrival reminders yet.** "Remind me when I get home" would need geofencing, which needs always-on background location; that's blocked in this build for privacy. Location is used only as on-demand context.
- **RCS.** Samsung Messages RCS chats aren't in the SMS database, so Optimus reads incoming RCS from notifications (with notification access on). Messages you sent from another device, and RCS media, can be missing. Optimus says so when it matters.
- **Background timing.** Android and One UI decide when background work runs. The brief's notification fires on time, and the brief itself is built when you open the app if the background run was late.
- **Shortcuts** (long-press icon) are registered on first launch, so they appear after you've opened the app once.
