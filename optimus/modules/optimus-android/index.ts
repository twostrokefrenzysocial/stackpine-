import { requireOptionalNativeModule } from 'expo';

/**
 * Android-only bridge for data Expo doesn't expose: SMS/MMS, the call log,
 * captured notifications, and device status checks for Samsung setup.
 * Every function degrades safely when the native module is missing (iOS,
 * web, Expo Go), so Mock Data Mode runs anywhere.
 */

export interface RawSms {
  id: string;
  threadId: string;
  address: string;
  body: string;
  dateMs: number;
  type: 'inbox' | 'sent' | 'draft' | 'outbox' | 'failed' | 'queued' | 'other';
  read: boolean;
  kind: 'sms' | 'mms' | 'rcs';
}

export interface MessagingDiagnostics {
  readSmsGranted: boolean;
  /** Row counts, or 'unavailable' when a store can't be read on this phone. */
  sms?: number | 'unavailable';
  mms?: number | 'unavailable';
  samsungRcs?: number | 'unavailable';
  defaultSmsApp: string | null;
  notificationAccessGranted: boolean;
}

export interface RawCall {
  id: string;
  number: string;
  cachedName: string | null;
  dateMs: number;
  durationSec: number;
  type: 'incoming' | 'outgoing' | 'missed' | 'rejected' | 'voicemail' | 'blocked' | 'other';
}

export interface RawNotification {
  key: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  postedAtMs: number;
  category: string | null;
  redacted: boolean;
}

export interface DeviceStatus {
  sdkInt: number;
  manufacturer: string;
  model: string;
  installerPackage: string | null;
  isSideloaded: boolean;
  notificationAccessGranted: boolean;
  /** Android 13+: notification access is blocked until "Allow restricted settings" is tapped. */
  restrictedSettingsLikelyBlocked: boolean;
  ignoringBatteryOptimizations: boolean;
}

interface NativeModuleShape {
  getSmsMessages(opts: { sinceMs?: number; limit?: number; query?: string; threadId?: string }): Promise<RawSms[]>;
  sendSms(to: string, body: string): Promise<{ id: string }>;
  getMessagingDiagnostics(): Promise<MessagingDiagnostics>;
  getCallLog(opts: { sinceMs?: number; limit?: number; number?: string }): Promise<RawCall[]>;
  startCall(number: string): Promise<void>;
  getDeviceStatus(): DeviceStatus;
  openNotificationAccessSettings(): void;
  openAppDetailsSettings(): void;
  openBatteryOptimizationSettings(): void;
  setNotificationCaptureConfig(cfg: { enabled: boolean; excludedPackages: string[] }): void;
  drainCapturedNotifications(): Promise<RawNotification[]>;
  requestListenerRebind(): void;
}

const Native = requireOptionalNativeModule<NativeModuleShape>('OptimusAndroid');

function need(): NativeModuleShape {
  if (!Native) throw new Error('Optimus native module unavailable');
  return Native;
}

export function isAvailable(): boolean {
  return Native != null;
}

/** Newest first. `sinceMs` enables incremental sync. Requires READ_SMS. */
export function getSmsMessages(opts: { sinceMs?: number; limit?: number; query?: string; threadId?: string } = {}): Promise<RawSms[]> {
  return need().getSmsMessages(opts);
}

/** Which message stores this phone exposes (SMS, MMS, Samsung RCS) and the chat-notification state. */
export async function getMessagingDiagnostics(): Promise<MessagingDiagnostics | null> {
  return Native ? Native.getMessagingDiagnostics() : null;
}

/** Sends via SmsManager (multipart when long). Requires SEND_SMS. */
export function sendSms(to: string, body: string): Promise<{ id: string }> {
  return need().sendSms(to, body);
}

/** Newest first. Requires READ_CALL_LOG. */
export function getCallLog(opts: { sinceMs?: number; limit?: number; number?: string } = {}): Promise<RawCall[]> {
  return need().getCallLog(opts);
}

/** Places the call when CALL_PHONE is granted, otherwise opens the dialer. */
export function startCall(number: string): Promise<void> {
  return need().startCall(number);
}

export function getDeviceStatus(): DeviceStatus | null {
  return Native ? Native.getDeviceStatus() : null;
}

export function openNotificationAccessSettings(): void {
  Native?.openNotificationAccessSettings();
}

/** App info screen: where the ⋮ menu holds "Allow restricted settings". */
export function openAppDetailsSettings(): void {
  Native?.openAppDetailsSettings();
}

export function openBatteryOptimizationSettings(): void {
  Native?.openBatteryOptimizationSettings();
}

/** Read by the listener service even when the JS runtime isn't running. */
export function setNotificationCaptureConfig(cfg: { enabled: boolean; excludedPackages: string[] }): void {
  Native?.setNotificationCaptureConfig(cfg);
}

/** Everything the listener queued since the last drain, oldest first; clears the queue. */
export async function drainCapturedNotifications(): Promise<RawNotification[]> {
  return Native ? Native.drainCapturedNotifications() : [];
}

export function requestListenerRebind(): void {
  Native?.requestListenerRebind();
}
