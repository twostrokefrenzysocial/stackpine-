# Optimus proxy

A small Cloudflare Worker that sits between the Optimus app and the AI provider: Anthropic's API, or OpenAI's if you switch the app to OpenAI.

- It keeps your Anthropic (and optional OpenAI) API key on Cloudflare, so no key is ever stored in the app.
- It stops all requests for the rest of the month once you reach your monthly spending cap. The default cap is $20, and you can change it in the app.
- It allows at most 30 requests per minute, so a runaway loop can't drain your balance.
- It only allows the models Optimus uses: `claude-sonnet-5-5` and `claude-haiku-5-5`.
- It never records the content of your conversations. Its logs contain only token counts and costs.

The free Cloudflare plan is enough for personal use.

## Deploy it (about 10 minutes, one time)

You need [Node.js](https://nodejs.org) (the "LTS" version) and a terminal:
Terminal on a Mac, PowerShell on Windows.

1. **Create a Cloudflare account** at <https://dash.cloudflare.com/sign-up>. Use the free plan.

2. **Get an Anthropic API key** at <https://console.anthropic.com/settings/keys>. Click
   *Create Key* and copy the key, which starts with `sk-ant-`. Keep the tab open; you'll need the key in step 6.

3. **Open a terminal in this folder** (`optimus/proxy`) and install the tools:

   ```sh
   npm install
   ```

4. **Log in to Cloudflare.** A browser window opens; click *Allow*.

   ```sh
   npx wrangler login
   ```

5. **Deploy:**

   ```sh
   npx wrangler deploy
   ```

   At the end, it prints a web address like
   `https://optimus-proxy.<your-name>.workers.dev`. Copy it, because this is your **proxy URL**.

6. **Store your Anthropic key on Cloudflare.** Paste the key when asked:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

7. **Create an app token.** This password lets your phone, and nothing else, use the proxy.
   Generate a long random one:

   ```sh
   openssl rand -hex 32
   ```

   If `openssl` isn't available (common on Windows), run this instead:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the 64-character result, then store it on Cloudflare:

   ```sh
   npx wrangler secret put APP_TOKEN
   ```

8. **Optional: OpenAI.** Only if you want to switch Optimus to OpenAI (Settings › Connection › OpenAI):
   1. Create a key at <https://platform.openai.com/api-keys> and set a monthly budget under **Settings › Limits** there.
   2. Store it on Cloudflare:
      ```sh
      npx wrangler secret put OPENAI_API_KEY
      ```
   3. In `wrangler.toml`, set `OPENAI_MODELS` to the model ids you want to allow (copy them from <https://platform.openai.com/docs/models>), and `OPENAI_PRICES` to their prices per million tokens from <https://platform.openai.com/pricing>. A model without a price counts against your cap at a deliberately high rate, so the cap trips early rather than late.
   4. Run `npx wrangler deploy` again.

   You can keep both keys: the app switch decides which one is used. If you only want OpenAI, you can skip the Anthropic key.

9. **Check that the proxy is running.** Open `<your proxy URL>/health` in a browser. It should show `{"ok":true}`.

9. **Connect the app.** In Optimus, open **Settings**, paste the **proxy URL** from step 5 and the
   **app token** from step 7, and save.

That's it. To update the proxy later, run `npx wrangler deploy` again from this folder.
Your secrets and your spending history are kept.

### If something goes wrong

| Problem | What it means |
| --- | --- |
| "Unauthorized" | The app token in Settings doesn't match `APP_TOKEN`. Run step 7 again and paste the new token into the app. |
| "Proxy misconfigured" | One of the two secrets isn't set. Do steps 6 and 7. |
| "Spending cap reached" | You've reached this month's cap. Raise it in the app, or wait until the 1st of next month (UTC). |
| "Rate limited" | You sent more than 30 requests in a minute. Wait a moment. |

To see live logs (costs and token counts only), run `npx wrangler tail`.

## Settings

The values below live under `[vars]` in `wrangler.toml`. After you change one, run `npx wrangler deploy`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_CAP_USD` | `20` | Monthly cap used until you set one from the app. |
| `RATE_LIMIT_PER_MINUTE` | `30` | Maximum requests in any rolling 60-second window. |
| `ALLOWED_MODELS` | `claude-sonnet-5-5,claude-haiku-5-5` | Models the app may request. |

---

## For developers

### API

All routes except `/health` require the `x-optimus-token` header.

| Route | Purpose |
| --- | --- |
| `POST /v1/messages` | Forwarded to Anthropic. Supports both streaming and non-streaming requests. The proxy enforces the cap and rate limit, and records the cost after the response finishes. |
| `POST /v1/messages/count_tokens` | Forwarded to Anthropic. It counts toward the rate limit but is never billed or blocked by the cap. |
| `POST /openai/v1/chat/completions` | Forwarded to OpenAI with `OPENAI_API_KEY`. Only models in `OPENAI_MODELS` are allowed. Streaming requests always get `stream_options.include_usage` so the cost is metered against the same cap and rate limit. |
| `GET /usage` | Returns `{ month, spentUsd, capUsd, requests, remainingUsd, rateLimitPerMinute }`. |
| `PUT /cap` | Takes `{ "capUsd": number }` with 0 < capUsd ≤ 1000. Returns the same shape as `/usage`. |
| `GET /health` | Returns `{ "ok": true }`. No auth needed. |

Errors that the proxy itself produces use Anthropic's error shape, with the type prefixed
`optimus_`:

```json
{ "type": "error", "error": { "type": "optimus_spending_cap_reached", "message": "...", "spentUsd": 20.01, "capUsd": 20 } }
```

| Status | `error.type` |
| --- | --- |
| 400 | `optimus_invalid_request`, `optimus_model_not_allowed`, `optimus_max_tokens_too_large`, `optimus_invalid_cap` |
| 401 | `optimus_unauthorized` |
| 402 | `optimus_spending_cap_reached` (sent with `x-should-retry: false`) |
| 404 | `optimus_not_found` |
| 429 | `optimus_rate_limited` (sent with a `retry-after` header) |
| 500 | `optimus_misconfigured` |
| 502 | `optimus_upstream_unreachable` |
| 503 | `optimus_ledger_unavailable` |

Errors from Anthropic itself, such as `overloaded_error`, are passed through unchanged.

### Layout

- `src/index.ts`: the Worker entry point. It connects the handler to `fetch` and the `Ledger` Durable Object.
- `src/handler.ts`: routing, validation, forwarding and metering. It takes its dependencies as arguments, so it runs in Node too.
- `src/ledgerCore.ts`: spend, cap and rate-limit logic over a small KV storage interface.
- `src/ledger.ts`: the `Ledger` Durable Object, a thin wrapper around `LedgerCore`.
- `src/usage.ts`: an incremental parser that extracts usage from SSE and JSON responses.
- `src/pricing.ts`: the price table and `costUsd()`.
- `src/auth.ts`: a constant-time token comparison.

Spend is recorded after each response finishes. Several requests running at once can therefore overshoot the
cap by roughly the cost of those requests.

### Commands

```sh
npm run dev         # local server (put secrets in .dev.vars)
npm run typecheck   # tsc against Workers types
npm run deploy
```

Unit tests run from the parent project: `cd .. && npx jest proxy`.
