import type Anthropic from "@anthropic-ai/sdk";
import { PermissionsAndroid, Platform } from "react-native";
import * as Native from "../../modules/optimus-android";
import { BriefStore } from "../core/brief/brief";
import { OptimusEngine } from "../core/engine";
import type { Db } from "../core/db/types";
import type { BackgroundLlm } from "../core/llm/background";
import {
  HeuristicBackgroundLlm,
  ScriptedTransport,
} from "../core/llm/scripted";
import { MAIN_MODEL } from "../core/llm/prompts";
import { LlmError, type LlmTransport } from "../core/llm/transport";
import { createMockSources, type MockDataSources } from "../core/mock/sources";
import {
  DEFAULT_SETTINGS,
  kvGet,
  kvSet,
  loadSettings,
  saveSettings,
  upgradeModelDefaults,
  type Settings,
} from "../core/settings/settings";
import type { DataSources, SourceName } from "../core/sources/types";
import { z } from "zod";
import { OpenAIBackgroundLlm, type OpenAIConfig } from "../core/llm/openai";
import { OpenAIResponsesTransport } from "../core/llm/openaiResponses";
import { createClient, ProxyBackgroundLlm, ProxyTransport } from "./claude";
import { fetch as expoFetch } from "expo/fetch";
import { openDatabase } from "./db";
import { proxyToken } from "./secrets";
import { loadMockPhoto } from "./sources/mockPhotos";
import { createRealSources } from "./sources/real";
import { notificationScheduler, routineScheduler } from "./notify";

/**
 * Process-wide app runtime: database, settings, engine, and the switches
 * between Mock/Real data and Claude, OpenAI or the offline demo brain.
 */
export interface Runtime {
  db: Db;
  engine: OptimusEngine;
  settings: Settings;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  sources(): DataSources;
  transportLabel(): string;
  background(): BackgroundLlm;
  isDemoBrain(): boolean;
  /** Short name of the live provider for status readouts, e.g. "CLAUDE". */
  providerLabel(): string;
  refreshClient(): Promise<void>;
  /** Sends a one-line request through the proxy to the chosen model. Throws an LlmError on failure. */
  testModel(): Promise<void>;
  mock: MockDataSources;
}

let runtime: Runtime | null = null;
let booting: Promise<Runtime> | null = null;

export function getRuntime(): Runtime | null {
  return runtime;
}

export function boot(): Promise<Runtime> {
  if (runtime) return Promise.resolve(runtime);
  booting ??= doBoot();
  return booting;
}

async function doBoot(): Promise<Runtime> {
  const db = await openDatabase();
  let settings = await loadSettings(db).catch(() => DEFAULT_SETTINGS);
  // Older builds had an "excluded apps" list; it reads better as approvals.
  if (
    settings.excludedNotificationApps.length &&
    settings.notificationApps === "all" &&
    !settings.approvedNotificationApps.length
  ) {
    const excluded = new Set(settings.excludedNotificationApps);
    const seen = await db
      .all<{ packageName: string }>(
        "SELECT DISTINCT package_name AS packageName FROM notifications",
      )
      .catch(() => [] as { packageName: string }[]);
    settings = await saveSettings(db, {
      notificationApps: "approved",
      approvedNotificationApps: seen
        .map((a) => a.packageName)
        .filter((pk) => !excluded.has(pk)),
      excludedNotificationApps: [],
    });
  }
  const upgrade = upgradeModelDefaults(settings);
  if (upgrade)
    settings = await saveSettings(db, upgrade).catch(() => ({
      ...settings,
      ...upgrade,
    }));
  let client: Anthropic | null = null;
  let transport: LlmTransport;
  let background: BackgroundLlm;

  const mock = createMockSources({ photoLoader: loadMockPhoto });
  const demoTransport = new ScriptedTransport({
    delayMs: 18,
    captions: (id) => mock.dataset.photos.find((p) => p.id === id)?.mockCaption,
  });
  const heuristics = new HeuristicBackgroundLlm();

  async function refreshClient() {
    const token = await proxyToken.get();
    if (settings.proxyUrl && token && settings.provider === "openai") {
      client = null;
      const cfg: OpenAIConfig = {
        baseUrl: settings.proxyUrl,
        token,
        model: settings.openaiModel.trim(),
        backgroundModel: settings.openaiBackgroundModel.trim(),
        fetch: expoFetch as unknown as typeof globalThis.fetch,
      };
      transport = new OpenAIResponsesTransport(cfg);
      background = new OpenAIBackgroundLlm(
        cfg,
        (schema) => z.toJSONSchema(schema) as Record<string, unknown>,
      );
    } else if (settings.proxyUrl && token) {
      client = createClient(settings.proxyUrl, token);
      transport = new ProxyTransport(client);
      background = new ProxyBackgroundLlm(client);
    } else {
      client = null;
      transport = demoTransport;
      background = heuristics;
    }
  }
  await refreshClient();

  // Real sources are created lazily so Mock mode never touches permissions.
  let real: DataSources | null = null;
  const engineRef: { engine?: OptimusEngine } = {};
  const sources = (): DataSources => {
    if (settings.dataMode === "mock") return mock;
    real ??= createRealSources({
      db,
      notifications: engineRef.engine!.notifications,
      locationEnabled: () => settings.locationEnabled,
      icloudProxy: () =>
        settings.emailAccounts.includes("icloud") && settings.proxyUrl
          ? settings.proxyUrl
          : null,
      gmailProxy: () =>
        settings.emailAccounts.includes("gmail") &&
        settings.gmailViaProxy &&
        settings.proxyUrl
          ? settings.proxyUrl
          : null,
    });
    return real;
  };

  const engine = new OptimusEngine({
    db,
    sources,
    transport: () => transport,
    background: () => background,
    scheduler: notificationScheduler,
    routineScheduler,
    locationEnabled: () => settings.locationEnabled,
    webSearch: () => settings.webSearchEnabled,
    effort: () =>
      (({ fast: "low", balanced: "medium", deep: "high" }) as const)[
        settings.thinking ?? "fast"
      ],
    unavailableSources: () => unavailableSources(settings),
  });
  engineRef.engine = engine;
  // Notifications scheduled by older builds open Home; re-create them so a tap opens the chat with the message.
  if ((await kvGet(db, "notify.payloadVersion")) !== "2") {
    engine
      .rescheduleNotifications()
      .then(() => kvSet(db, "notify.payloadVersion", "2"))
      .catch(() => undefined);
  }

  runtime = {
    db,
    engine,
    get settings() {
      return settings;
    },
    async updateSettings(patch) {
      const modeChanged =
        "dataMode" in patch && patch.dataMode !== settings.dataMode;
      settings = await saveSettings(db, patch);
      // Today's brief was built from the old mode's data (e.g. the demo phone).
      if (modeChanged) await new BriefStore(db).clear();
      if (
        "proxyUrl" in patch ||
        "provider" in patch ||
        "openaiModel" in patch ||
        "openaiBackgroundModel" in patch
      )
        await refreshClient();
      if (
        "excludedNotificationApps" in patch ||
        "notificationCaptureEnabled" in patch ||
        "notificationApps" in patch ||
        "approvedNotificationApps" in patch
      ) {
        Native.setNotificationCaptureConfig(captureConfig(settings));
      }
      return settings;
    },
    sources,
    transportLabel: () => transport.label,
    background: () => background,
    isDemoBrain: () => transport === demoTransport,
    providerLabel: () =>
      transport === demoTransport
        ? "DEMO"
        : settings.provider === "openai"
          ? "OPENAI"
          : "CLAUDE",
    refreshClient,
    async testModel() {
      if (transport === demoTransport)
        throw new LlmError("not-configured", "not configured");
      await transport.stream(
        {
          model: MAIN_MODEL,
          system: [
            {
              type: "text",
              text: "Connection test. Reply with the single word OK.",
            },
          ],
          messages: [{ role: "user", content: "Test" }],
          tools: [],
          maxTokens: 2000,
          effort: "low",
        },
        () => undefined,
      );
    },
    mock,
  } as Runtime;
  Native.setNotificationCaptureConfig(captureConfig(settings));
  return runtime;
}

/** What the listener service keeps: all apps, or only the approved ones. */
function captureConfig(s: Settings) {
  return {
    enabled: s.notificationCaptureEnabled,
    excludedPackages: s.excludedNotificationApps,
    allowedPackages:
      s.notificationApps === "approved" ? s.approvedNotificationApps : [],
  };
}

/** Which real sources lack permission (empty in Mock mode). */
export async function unavailableSources(
  settings: Settings,
): Promise<SourceName[]> {
  if (settings.dataMode === "mock") return [];
  const out: SourceName[] = [];
  if (Platform.OS === "android" && Native.isAvailable()) {
    const P = (PermissionsAndroid?.PERMISSIONS ??
      {}) as typeof PermissionsAndroid.PERMISSIONS;
    if (!(await PermissionsAndroid.check(P.READ_SMS))) out.push("texts");
    if (!(await PermissionsAndroid.check(P.READ_CALL_LOG))) out.push("calls");
    if (!Native.getDeviceStatus()?.notificationAccessGranted)
      out.push("notifications");
  } else {
    out.push("texts", "calls", "notifications");
  }
  const { getPermissionStates } = await import("./permissions");
  const states = await getPermissionStates();
  if (!states.calendar) out.push("calendar");
  if (!states.contacts) out.push("contacts");
  if (!states.photos) out.push("photos");
  if (!settings.emailAccounts.length) out.push("email");
  if (!settings.locationEnabled || !states.location) out.push("location");
  return out;
}
