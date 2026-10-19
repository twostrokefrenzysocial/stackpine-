import { handle, withKeepalive, type HandlerEnv } from "../src/handler";
import { LedgerCore } from "../src/ledgerCore";
import { costUsd } from "../src/pricing";
import {
  chunkedStream,
  fakeClock,
  MemoryStorage,
  sampleStream,
} from "./helpers";

const BASE = "https://optimus-proxy.example.workers.dev";
const TOKEN = "a".repeat(64);
const env: HandlerEnv = {
  ANTHROPIC_API_KEY: "sk-ant-real-key",
  APP_TOKEN: TOKEN,
  ALLOWED_MODELS: "claude-sonnet-5-5, claude-haiku-5-5",
};

const encoder = new TextEncoder();

/** Builds a proxy wired to an in-memory ledger and a scripted upstream. */
function setup(
  upstream: (req: Request) => Response | Promise<Response> = () =>
    new Response("{}"),
) {
  const clock = fakeClock("2026-10-18T12:00:00Z");
  const ledger = new LedgerCore(
    new MemoryStorage(),
    { defaultCapUsd: 20, rateLimitPerMinute: 30 },
    clock.now,
  );
  const pending: Promise<unknown>[] = [];
  const upstreamRequests: Request[] = [];
  const logs: string[] = [];
  const call = (request: Request) =>
    handle(request, env, {
      ledger,
      upstreamFetch: async (req) => {
        upstreamRequests.push(req);
        return upstream(req);
      },
      waitUntil: (p) => pending.push(p),
      log: (m) => logs.push(m),
    });
  const settle = () => Promise.all(pending);
  return { call, ledger, clock, upstreamRequests, settle, logs };
}

function messagesRequest(
  body: unknown,
  headers: Record<string, string> = {},
  path = "/v1/messages",
) {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-optimus-token": TOKEN,
      "x-api-key": "placeholder",
      "anthropic-version": "2023-06-01",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = {
  model: "claude-sonnet-5-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
};

async function errorType(res: Response): Promise<string> {
  return ((await res.json()) as { error: { type: string } }).error.type;
}

describe("routing and auth", () => {
  it("serves /health without auth and answers OPTIONS with 204", async () => {
    const { call } = setup();
    const health = await call(new Request(`${BASE}/health`));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(
      (await call(new Request(`${BASE}/v1/messages`, { method: "OPTIONS" })))
        .status,
    ).toBe(204);
  });

  it.each([
    ["missing", {}],
    ["wrong", { "x-optimus-token": "b".repeat(64) }],
    ["prefix of", { "x-optimus-token": TOKEN.slice(0, 10) }],
  ])(
    "rejects a %s token with 401 and never calls upstream",
    async (_label, headers) => {
      const { call, upstreamRequests } = setup();
      const res = await call(
        new Request(`${BASE}/v1/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify(validBody),
        }),
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        type: "error",
        error: { type: "optimus_unauthorized", message: expect.any(String) },
      });
      expect(upstreamRequests).toHaveLength(0);
    },
  );

  it("requires auth for /usage and returns 404 for unknown routes", async () => {
    const { call } = setup();
    expect((await call(new Request(`${BASE}/usage`))).status).toBe(401);
    const res = await call(
      new Request(`${BASE}/v1/models`, {
        headers: { "x-optimus-token": TOKEN },
      }),
    );
    expect(res.status).toBe(404);
    expect(await errorType(res)).toBe("optimus_not_found");
  });

  it("reports misconfiguration when secrets are missing", async () => {
    const res = await handle(
      new Request(`${BASE}/usage`, { headers: { "x-optimus-token": "" } }),
      {},
      {
        ledger: {} as never,
        upstreamFetch: fetch,
        waitUntil: () => {},
      },
    );
    expect(res.status).toBe(500);
    expect(await errorType(res)).toBe("optimus_misconfigured");
  });
});

describe("request validation", () => {
  it("rejects models outside the allowlist", async () => {
    const { call, upstreamRequests } = setup();
    const res = await call(
      messagesRequest({ ...validBody, model: "claude-opus-5-5" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { type: string; allowedModels: string[] };
    };
    expect(body.error.type).toBe("optimus_model_not_allowed");
    expect(body.error.allowedModels).toEqual([
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    expect(upstreamRequests).toHaveLength(0);
  });

  it("rejects max_tokens above 64000", async () => {
    const { call } = setup();
    const res = await call(
      messagesRequest({ ...validBody, max_tokens: 64_001 }),
    );
    expect(res.status).toBe(400);
    expect(await errorType(res)).toBe("optimus_max_tokens_too_large");
  });

  it("rejects malformed JSON", async () => {
    const { call } = setup();
    const res = await call(messagesRequest("{not json"));
    expect(res.status).toBe(400);
    expect(await errorType(res)).toBe("optimus_invalid_request");
  });
});

describe("forwarding", () => {
  it("swaps in the real API key, passes version/beta headers and the body unchanged", async () => {
    const { call, upstreamRequests } = setup(
      () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    const rawBody = `{"model":"claude-haiku-5-5",  "max_tokens":10,"messages":[]}`;
    await call(
      messagesRequest(
        rawBody,
        { "anthropic-beta": "files-api-2025-04-14" },
        "/v1/messages?beta=true",
      ),
    );

    const [up] = upstreamRequests;
    expect(up.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(up.headers.get("x-api-key")).toBe("sk-ant-real-key");
    expect(up.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(up.headers.get("anthropic-beta")).toBe("files-api-2025-04-14");
    expect(up.headers.get("x-optimus-token")).toBeNull();
    expect(await up.text()).toBe(rawBody);
  });

  it("defaults anthropic-version when the client omits it", async () => {
    const { call, upstreamRequests } = setup();
    const req = messagesRequest(validBody);
    req.headers.delete("anthropic-version");
    await call(req);
    expect(upstreamRequests[0].headers.get("anthropic-version")).toBe(
      "2023-06-01",
    );
  });

  it("streams SSE back byte-for-byte and records the cost of the served model", async () => {
    // The API fell back to claude-sonnet-5; billing must follow the response.
    const bytes = encoder.encode(sampleStream("claude-sonnet-5"));
    const { call, ledger, settle, logs } = setup(
      () =>
        new Response(chunkedStream(bytes, [1, 7, 64, 3]), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "request-id": "req_123",
          },
        }),
    );

    const res = await call(messagesRequest({ ...validBody, stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("request-id")).toBe("req_123");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    await settle();
    const expected = costUsd("claude-sonnet-5", {
      input_tokens: 1000,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 3000,
      output_tokens: 500,
    });
    // 1000*2 + 2000*2.5 + 3000*0.2 + 500*10 = 12,600 per million tokens.
    expect(expected).toBeCloseTo(0.0126, 10);
    expect(await ledger.usage()).toMatchObject({
      spentUsd: 0.0126,
      requests: 1,
    });
    expect(logs.join("\n")).not.toContain("ünïcødé"); // content is never logged
  });

  it("records usage from a non-streaming response", async () => {
    const { call, ledger, settle } = setup(
      () =>
        new Response(
          JSON.stringify({
            model: "claude-haiku-5-5",
            content: [],
            usage: { input_tokens: 10_000, output_tokens: 2_000 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const res = await call(
      messagesRequest({ ...validBody, model: "claude-haiku-5-5" }),
    );
    expect(((await res.json()) as { model: string }).model).toBe(
      "claude-haiku-5-5",
    );
    await settle();
    // 10,000 * 0.10 + 2,000 * 0.50 = 2,000 per million tokens.
    expect((await ledger.usage()).spentUsd).toBeCloseTo(0.002, 10);
  });

  it("passes upstream errors through without recording a cost", async () => {
    const upstreamError = {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    };
    const { call, ledger, settle } = setup(
      () =>
        new Response(JSON.stringify(upstreamError), {
          status: 529,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await call(messagesRequest(validBody));
    expect(res.status).toBe(529);
    expect(await res.json()).toEqual(upstreamError);
    await settle();
    expect((await ledger.usage()).requests).toBe(0);
  });

  it("forwards count_tokens without recording cost or enforcing the cap", async () => {
    const { call, ledger, settle, upstreamRequests } = setup(
      () =>
        new Response(JSON.stringify({ input_tokens: 42 }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await ledger.record(25); // over the cap
    const res = await call(
      messagesRequest(
        { model: "claude-sonnet-5-5", messages: [] },
        {},
        "/v1/messages/count_tokens",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ input_tokens: 42 });
    expect(upstreamRequests[0].url).toBe(
      "https://api.anthropic.com/v1/messages/count_tokens",
    );
    await settle();
    expect((await ledger.usage()).requests).toBe(1);
  });

  it("returns 502 when the upstream is unreachable", async () => {
    const { call } = setup(() => {
      throw new TypeError("network down");
    });
    const res = await call(messagesRequest(validBody));
    expect(res.status).toBe(502);
    expect(await errorType(res)).toBe("optimus_upstream_unreachable");
  });
});

describe("spending cap and rate limit", () => {
  it("returns 402 once the monthly cap is reached", async () => {
    const { call, ledger, upstreamRequests } = setup();
    await ledger.record(20);
    const res = await call(messagesRequest(validBody));
    expect(res.status).toBe(402);
    expect(res.headers.get("x-should-retry")).toBe("false");
    expect(await res.json()).toEqual({
      type: "error",
      error: {
        type: "optimus_spending_cap_reached",
        message: "Monthly spending cap of $20.00 reached",
        spentUsd: 20,
        capUsd: 20,
      },
    });
    expect(upstreamRequests).toHaveLength(0);
  });

  it("lets requests through again in the next month", async () => {
    const { call, ledger, clock } = setup();
    await ledger.record(20);
    expect((await call(messagesRequest(validBody))).status).toBe(402);
    clock.set("2026-11-01T00:00:01Z");
    expect((await call(messagesRequest(validBody))).status).toBe(200);
  });

  it("returns 429 with retry-after after 30 requests in a minute", async () => {
    const { call, upstreamRequests } = setup();
    for (let i = 0; i < 30; i++)
      expect((await call(messagesRequest(validBody))).status).toBe(200);
    const res = await call(messagesRequest(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await errorType(res)).toBe("optimus_rate_limited");
    expect(upstreamRequests).toHaveLength(30);
  });

  it("returns 503 when the ledger is unavailable", async () => {
    const res = await handle(messagesRequest(validBody), env, {
      ledger: {
        check: () => Promise.reject(new Error("DO overloaded")),
        record: () => Promise.reject(new Error()),
        usage: () => Promise.reject(new Error()),
        setCap: () => Promise.reject(new Error()),
      },
      upstreamFetch: fetch,
      waitUntil: () => {},
    });
    expect(res.status).toBe(503);
    expect(await errorType(res)).toBe("optimus_ledger_unavailable");
  });
});

describe("/usage and /cap", () => {
  const authed = (path: string, init: RequestInit = {}) =>
    new Request(`${BASE}${path}`, {
      ...init,
      headers: { "x-optimus-token": TOKEN, ...init.headers },
    });

  it("reports usage", async () => {
    const { call, ledger } = setup();
    await ledger.record(1.5);
    const res = await call(authed("/usage"));
    expect(await res.json()).toEqual({
      month: "2026-10",
      spentUsd: 1.5,
      capUsd: 20,
      requests: 1,
      remainingUsd: 18.5,
      rateLimitPerMinute: 30,
    });
  });

  it("corrects this month's spend to match the provider bill, keeping the request count", async () => {
    const { call, ledger } = setup();
    await ledger.record(5.71);
    const res = await call(
      authed("/usage", {
        method: "PUT",
        body: JSON.stringify({ spentUsd: 0.12 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      spentUsd: 0.12,
      requests: 1,
      remainingUsd: 19.88,
    });
    const bad = await call(
      authed("/usage", {
        method: "PUT",
        body: JSON.stringify({ spentUsd: -1 }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await call(
          new Request(`${BASE}/usage`, {
            method: "PUT",
            body: '{"spentUsd":0}',
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("updates the cap", async () => {
    const { call } = setup();
    const res = await call(
      authed("/cap", { method: "PUT", body: JSON.stringify({ capUsd: 50 }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      capUsd: 50,
      remainingUsd: 50,
      month: "2026-10",
    });
    expect(await (await call(authed("/usage"))).json()).toMatchObject({
      capUsd: 50,
    });
  });

  it.each([[0], [-5], [1000.5], ["25"], [null], [Number.MAX_VALUE]])(
    "rejects capUsd=%p",
    async (capUsd) => {
      const { call } = setup();
      const res = await call(
        authed("/cap", { method: "PUT", body: JSON.stringify({ capUsd }) }),
      );
      expect(res.status).toBe(400);
      expect(await errorType(res)).toBe("optimus_invalid_cap");
    },
  );

  it("rejects a non-JSON cap body", async () => {
    const { call } = setup();
    const res = await call(authed("/cap", { method: "PUT", body: "fifty" }));
    expect(res.status).toBe(400);
    expect(await errorType(res)).toBe("optimus_invalid_cap");
  });

  it("accepts the maximum cap of 1000", async () => {
    const { call } = setup();
    const res = await call(
      authed("/cap", { method: "PUT", body: JSON.stringify({ capUsd: 1000 }) }),
    );
    expect(res.status).toBe(200);
  });
});

describe("OpenAI route", () => {
  const oaEnv: HandlerEnv = {
    ...env,
    OPENAI_API_KEY: "sk-openai-real",
    OPENAI_MODELS: "oa-main, oa-mini",
    OPENAI_PRICES: '{"oa-main":{"input":2,"output":10,"cacheRead":0.5}}',
  };
  function oaSetup(
    upstream: (req: Request) => Response | Promise<Response>,
    e: HandlerEnv = oaEnv,
  ) {
    const clock = fakeClock("2026-10-18T12:00:00Z");
    const ledger = new LedgerCore(
      new MemoryStorage(),
      { defaultCapUsd: 20, rateLimitPerMinute: 30 },
      clock.now,
    );
    const pending: Promise<unknown>[] = [];
    const upstreamRequests: Request[] = [];
    const call = (request: Request) =>
      handle(request, e, {
        ledger,
        upstreamFetch: async (req) => {
          upstreamRequests.push(req);
          return upstream(req);
        },
        waitUntil: (p) => pending.push(p),
        log: () => {},
      });
    return {
      call,
      ledger,
      upstreamRequests,
      settle: () => Promise.all(pending),
    };
  }
  const oaRequest = (body: unknown) =>
    new Request(`${BASE}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-optimus-token": TOKEN },
      body: JSON.stringify(body),
    });
  const chunks = [
    {
      object: "chat.completion.chunk",
      model: "oa-main",
      choices: [{ index: 0, delta: { content: "Hi" } }],
    },
    {
      object: "chat.completion.chunk",
      model: "oa-main",
      choices: [],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        prompt_tokens_details: { cached_tokens: 400_000 },
      },
    },
  ];
  const streamBody =
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n";

  it("forwards with the OpenAI key, forces usage reporting and meters the cost", async () => {
    const { call, upstreamRequests, settle, ledger } = oaSetup(
      () =>
        new Response(streamBody, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const res = await call(
      oaRequest({
        model: "oa-main",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(streamBody);
    await settle();
    const up = upstreamRequests[0];
    expect(up.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(up.headers.get("authorization")).toBe("Bearer sk-openai-real");
    expect(up.headers.get("x-optimus-token")).toBeNull();
    expect((await up.json()).stream_options).toEqual({ include_usage: true });
    // 600k input × $2 + 400k cached × $0.5 + 100k output × $10 = $1.2 + $0.2 + $1.0
    expect((await ledger.usage()).spentUsd).toBeCloseTo(2.4, 6);
  });

  it("rejects models outside OPENAI_MODELS and refuses when OpenAI is not enabled", async () => {
    const { call, upstreamRequests } = oaSetup(() => new Response("{}"));
    const res = await call(oaRequest({ model: "gpt-anything", messages: [] }));
    expect(res.status).toBe(400);
    expect(await errorType(res)).toBe("optimus_model_not_allowed");
    const off = oaSetup(() => new Response("{}"), {
      ...oaEnv,
      OPENAI_MODELS: "",
    });
    expect(
      (await off.call(oaRequest({ model: "oa-main", messages: [] }))).status,
    ).toBe(400);
    expect(upstreamRequests).toHaveLength(0);
  });

  it("bills unpriced models at the high fallback rate", async () => {
    const body = JSON.stringify({
      model: "oa-mini",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    });
    const { call, settle, ledger } = oaSetup(
      () =>
        new Response(body, { headers: { "content-type": "application/json" } }),
    );
    await call(oaRequest({ model: "oa-mini", messages: [] }));
    await settle();
    expect((await ledger.usage()).spentUsd).toBeCloseTo(15, 6);
  });

  it("needs OPENAI_API_KEY for the OpenAI route only", async () => {
    const { call } = oaSetup(() => new Response("{}"), { ...env });
    const res = await call(oaRequest({ model: "oa-main", messages: [] }));
    expect(res.status).toBe(500);
    expect(await errorType(res)).toBe("optimus_misconfigured");
    const onlyOpenAI = oaSetup(() => new Response("{}"), {
      APP_TOKEN: TOKEN,
      OPENAI_API_KEY: "k",
      OPENAI_MODELS: "oa-main",
    });
    expect(
      (await onlyOpenAI.call(oaRequest({ model: "oa-main", messages: [] })))
        .status,
    ).toBe(200);
    expect((await onlyOpenAI.call(messagesRequest(validBody))).status).toBe(
      500,
    );
  });
});

describe("text-to-speech route", () => {
  const ttsEnv: HandlerEnv = { ...env, OPENAI_API_KEY: "sk-openai-real" };
  const ttsRequest = (body: unknown) =>
    new Request(`${BASE}/openai/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-optimus-token": TOKEN },
      body: JSON.stringify(body),
    });

  it("streams audio back and bills by characters", async () => {
    const clock = fakeClock("2026-10-18T12:00:00Z");
    const ledger = new LedgerCore(
      new MemoryStorage(),
      { defaultCapUsd: 20, rateLimitPerMinute: 30 },
      clock.now,
    );
    const pending: Promise<unknown>[] = [];
    const upstreamRequests: Request[] = [];
    const audio = new Uint8Array([73, 68, 51]);
    const res = await handle(
      ttsRequest({
        model: "gpt-4o-mini-tts",
        input: "a".repeat(1000),
        voice: "onyx",
      }),
      ttsEnv,
      {
        ledger,
        upstreamFetch: async (r) => {
          upstreamRequests.push(r);
          return new Response(audio, {
            headers: { "content-type": "audio/mpeg" },
          });
        },
        waitUntil: (p) => pending.push(p),
      },
    );
    await Promise.all(pending);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(audio);
    expect(upstreamRequests[0].url).toBe(
      "https://api.openai.com/v1/audio/speech",
    );
    expect(upstreamRequests[0].headers.get("authorization")).toBe(
      "Bearer sk-openai-real",
    );
    expect((await ledger.usage()).spentUsd).toBeCloseTo(0.015, 6);
  });

  it("rejects unknown voices models and oversized text", async () => {
    const { call } = setup();
    expect(
      (await call(ttsRequest({ model: "gpt-5", input: "hi" }))).status,
    ).toBe(500); // no OpenAI key in the base env
    const ledger = new LedgerCore(
      new MemoryStorage(),
      { defaultCapUsd: 20, rateLimitPerMinute: 30 },
      fakeClock("2026-10-18T12:00:00Z").now,
    );
    const deps = {
      ledger,
      upstreamFetch: async () => new Response("x"),
      waitUntil: () => {},
    };
    expect(
      (await handle(ttsRequest({ model: "gpt-5", input: "hi" }), ttsEnv, deps))
        .status,
    ).toBe(400);
    expect(
      (
        await handle(
          ttsRequest({ model: "tts-1", input: "a".repeat(5000) }),
          ttsEnv,
          deps,
        )
      ).status,
    ).toBe(400);
  });
});

describe("stream keepalive and Gmail over IMAP", () => {
  it("sends SSE comment pings while the upstream is quiet, and nothing on non-streams", async () => {
    const enc = new TextEncoder();
    let release: () => void = () => undefined;
    const slow = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(enc.encode('data: {"a":1}\n\n'));
        await new Promise<void>((r) => (release = r));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    const out = withKeepalive(slow, "text/event-stream", 40);
    const reader = out.getReader();
    const dec = new TextDecoder();
    let got = dec.decode((await reader.read()).value);
    await new Promise((r) => setTimeout(r, 120));
    release();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += dec.decode(value);
    }
    expect(got).toContain(": keepalive\n\n");
    expect(got.startsWith('data: {"a":1}')).toBe(true);
    expect(got.endsWith("data: [DONE]\n\n")).toBe(true);
    const plain = new ReadableStream<Uint8Array>({
      start: (c) => (c.enqueue(enc.encode("x")), c.close()),
    });
    expect(withKeepalive(plain, "application/json")).toBe(plain);
  });

  it("reports Gmail configured only when its app password is set", async () => {
    const { call } = setup();
    const status = (e: HandlerEnv) =>
      handle(
        new Request(`${BASE}/mail/gmail/status`, {
          headers: { "x-optimus-token": TOKEN },
        }),
        e,
        {
          ledger: new LedgerCore(
            new MemoryStorage(),
            { defaultCapUsd: 20, rateLimitPerMinute: 30 },
            () => new Date(),
          ),
          upstreamFetch: async () => new Response("{}"),
          waitUntil: () => undefined,
          openConn: () => {
            throw new Error("not used");
          },
        },
      );
    expect(await (await status(env)).json()).toEqual({ configured: false });
    expect(
      await (
        await status({
          ...env,
          GMAIL_EMAIL: "me@gmail.com",
          GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
        })
      ).json(),
    ).toEqual({ configured: true, address: "me@gmail.com" });
    const search = await call(
      new Request(`${BASE}/mail/gmail/search`, {
        method: "POST",
        headers: {
          "x-optimus-token": TOKEN,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(search.status).toBe(400);
    expect((await search.json()).error.type).toBe(
      "optimus_gmail_not_configured",
    );
  });
});
