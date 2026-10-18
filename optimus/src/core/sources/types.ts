import type {
  CalendarEvent,
  CallLogEntry,
  CapturedNotification,
  Contact,
  EmailMessage,
  GeoPoint,
  PhotoAsset,
  SmsMessage,
} from '../types';

/**
 * Every data source the assistant can see. Two implementations exist:
 * mock (src/core/mock) and real (src/platform/sources). The Settings toggle
 * picks one at runtime.
 *
 * A source that lacks permission throws `AccessError` so the assistant can
 * say plainly what it can't see.
 */

export class AccessError extends Error {
  constructor(
    public readonly source: SourceName,
    public readonly reason: 'permission-denied' | 'not-connected' | 'unavailable' | 'offline',
    message?: string,
  ) {
    super(message ?? `${source}: ${reason}`);
    this.name = 'AccessError';
  }
}

export type SourceName =
  | 'texts'
  | 'calls'
  | 'notifications'
  | 'calendar'
  | 'email'
  | 'photos'
  | 'contacts'
  | 'location';

export interface DateRange {
  since?: string; // ISO
  until?: string; // ISO
}

export interface TextsSource {
  search(q: { query?: string; contact?: string; limit?: number } & DateRange): Promise<SmsMessage[]>;
  recentThreads(limit?: number): Promise<SmsMessage[]>; // latest message per thread
  send(to: string, body: string): Promise<{ id: string }>;
  /** Message types the device couldn't expose (e.g. RCS). */
  limitations(): Promise<string[]>;
}

export interface CallsSource {
  list(q: { contact?: string; type?: CallLogEntry['type']; limit?: number } & DateRange): Promise<CallLogEntry[]>;
  startCall(number: string): Promise<void>;
}

export interface NotificationsSource {
  list(q: { app?: string; query?: string; limit?: number } & DateRange): Promise<CapturedNotification[]>;
}

export interface CalendarSource {
  list(range: Required<DateRange>): Promise<CalendarEvent[]>;
  create(e: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent>;
  update(id: string, patch: Partial<Omit<CalendarEvent, 'id'>>): Promise<CalendarEvent>;
  remove(id: string): Promise<void>;
}

export interface ContactsSource {
  search(query: string, limit?: number): Promise<Contact[]>;
  get(id: string): Promise<Contact | null>;
  all(): Promise<Contact[]>;
}

export interface EmailSource {
  accounts(): Promise<EmailMessage['account'][]>;
  search(q: { query?: string; from?: string; unreadOnly?: boolean; limit?: number } & DateRange): Promise<EmailMessage[]>;
  get(id: string): Promise<EmailMessage | null>;
  send(draft: { to: string[]; subject: string; body: string; inReplyToId?: string }): Promise<{ id: string }>;
}

export interface PhotosSource {
  list(q: { limit?: number; near?: GeoPoint & { radiusKm?: number } } & DateRange): Promise<PhotoAsset[]>;
  /** Walks the whole library, newest first, `size` at a time. */
  page?(cursor: string | undefined, size: number): Promise<{ photos: PhotoAsset[]; next?: string; total?: number }>;
  /** One photo by id (for ids older than a list page). */
  get?(id: string): Promise<PhotoAsset | null>;
  /** Base64 JPEG, resized so the long edge is <= maxEdge. */
  loadForVision(id: string, maxEdge: number): Promise<{ base64: string; mediaType: 'image/jpeg' } | null>;
}

export interface LocationSource {
  current(): Promise<GeoPoint>;
  home(): Promise<GeoPoint | null>;
}

export interface DataSources {
  mode: 'mock' | 'real';
  texts: TextsSource;
  calls: CallsSource;
  notifications: NotificationsSource;
  calendar: CalendarSource;
  contacts: ContactsSource;
  email: EmailSource;
  photos: PhotosSource;
  location: LocationSource;
}
