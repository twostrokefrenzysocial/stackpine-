// In-memory DataSources backed by the mock dataset. Mutations (sent texts,
// calendar edits, sent email) change the dataset so later reads reflect them.

import type { CalendarEvent, Contact, EmailMessage, GeoPoint, PhotoAsset, SmsMessage } from '../types';
import {
  AccessError,
  type CalendarSource,
  type CallsSource,
  type ContactsSource,
  type DataSources,
  type DateRange,
  type EmailSource,
  type LocationSource,
  type NotificationsSource,
  type PhotosSource,
  type SourceName,
  type TextsSource,
} from '../sources/types';
import { MOCK_USER_EMAIL, buildMockDataset, findContactByAddress, normalizePhone, type MockDataset } from './dataset';

export type MockPhotoLoader = (
  photo: PhotoAsset,
  maxEdge: number,
) => Promise<{ base64: string; mediaType: 'image/jpeg' } | null>;

export interface MockSourcesOptions {
  now?: () => Date;
  photoLoader?: MockPhotoLoader;
  denied?: Partial<Record<SourceName, boolean>>;
  /** Start from an existing dataset instead of building a fresh one. */
  dataset?: MockDataset;
}

export interface SentText {
  id: string;
  to: string;
  body: string;
  at: string;
}
export interface SentEmail {
  id: string;
  to: string[];
  subject: string;
  body: string;
  inReplyToId?: string;
  at: string;
}
export interface PlacedCall {
  number: string;
  at: string;
}

export type MockDataSources = DataSources & {
  dataset: MockDataset;
  sentTexts: SentText[];
  sentEmails: SentEmail[];
  placedCalls: PlacedCall[];
};

const DEFAULT_LIMITS = { texts: 20, calls: 20, notifications: 30, emails: 15, photos: 20, contacts: 10 };
const DEFAULT_RADIUS_KM = 2;

// ---------- Helpers ----------

const lc = (s: string | undefined) => (s ?? '').toLowerCase();
const includesCI = (haystack: (string | undefined)[], needle: string) => {
  const n = needle.toLowerCase();
  return haystack.some((h) => lc(h).includes(n));
};
const time = (isoDate: string) => new Date(isoDate).getTime();
const newestFirst = <T extends { date: string }>(a: T, b: T) => time(b.date) - time(a.date);

function inRange(isoDate: string, range: DateRange): boolean {
  const t = time(isoDate);
  if (range.since && t < time(range.since)) return false;
  if (range.until && t > time(range.until)) return false;
  return true;
}

/** "my wife" -> "wife"; trims and lowercases. */
function cleanPersonQuery(q: string): string {
  return q.trim().toLowerCase().replace(/^(my|our)\s+/, '');
}

function contactMatches(c: Contact, query: string): boolean {
  const q = cleanPersonQuery(query);
  if (!q) return false;
  if (includesCI([c.name, c.nickname, c.relationship, c.company, ...c.emails], q)) return true;
  const digits = normalizePhone(q);
  return digits.length >= 4 && c.phones.some((p) => normalizePhone(p).includes(digits));
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Wraps every method of a source so it throws AccessError when denied. */
function guard<T extends object>(name: SourceName, source: T, denied: MockSourcesOptions['denied']): T {
  if (!denied?.[name]) return source;
  const wrapped = {} as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    wrapped[key] = async () => {
      throw new AccessError(name, 'permission-denied');
    };
  }
  return wrapped as T;
}

// ---------- Factory ----------

export function createMockSources(opts: MockSourcesOptions = {}): MockDataSources {
  const now = opts.now ?? (() => new Date());
  const dataset = opts.dataset ?? buildMockDataset(now());
  const sentTexts: SentText[] = [];
  const sentEmails: SentEmail[] = [];
  const placedCalls: PlacedCall[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  /** True if an address (phone or email) or display name matches the person query. */
  const addressMatches = (address: string, displayName: string | undefined, query: string): boolean => {
    const q = cleanPersonQuery(query);
    if (includesCI([address, displayName], q)) return true;
    const qDigits = normalizePhone(q);
    if (qDigits.length >= 4 && normalizePhone(address).includes(qDigits)) return true;
    const owner = findContactByAddress(dataset.contacts, address);
    return !!owner && contactMatches(owner, query);
  };

  /** Resolve "Jen" / "my wife" / a number to a phone number. */
  const resolvePhone = (to: string): string => {
    if (normalizePhone(to).length >= 5 && !/[a-z]/i.test(to)) return to.trim();
    const contact = dataset.contacts.find((c) => c.phones.length > 0 && contactMatches(c, to));
    if (!contact) throw new Error(`No phone number found for "${to}"`);
    return contact.phones[0];
  };

  // ---------- Texts ----------
  const texts: TextsSource = {
    async search(q) {
      return dataset.texts
        .filter((m) => inRange(m.date, q))
        .filter((m) => !q.contact || addressMatches(m.address, m.contactName, q.contact))
        .filter((m) => !q.query || includesCI([m.body, m.contactName, m.address], q.query))
        .sort(newestFirst)
        .slice(0, q.limit ?? DEFAULT_LIMITS.texts);
    },
    async recentThreads(limit = DEFAULT_LIMITS.texts) {
      const latest = new Map<string, SmsMessage>();
      for (const m of dataset.texts) {
        const prev = latest.get(m.threadId);
        if (!prev || time(m.date) > time(prev.date)) latest.set(m.threadId, m);
      }
      return [...latest.values()].sort(newestFirst).slice(0, limit);
    },
    async send(to, body) {
      const address = resolvePhone(to);
      const digits = normalizePhone(address);
      const existing = dataset.texts.find((m) => normalizePhone(m.address) === digits);
      const id = nextId('sms-sent');
      const at = now().toISOString();
      dataset.texts.push({
        id,
        threadId: existing?.threadId ?? `th-${digits}`,
        address: existing?.address ?? address,
        contactName: findContactByAddress(dataset.contacts, address)?.name,
        body,
        date: at,
        direction: 'outgoing',
        read: true,
        kind: 'sms',
      });
      sentTexts.push({ id, to: address, body, at });
      return { id };
    },
    async limitations() {
      return [...dataset.textLimitations];
    },
  };

  // ---------- Calls ----------
  const calls: CallsSource = {
    async list(q) {
      return dataset.calls
        .filter((c) => inRange(c.date, q))
        .filter((c) => !q.type || c.type === q.type)
        .filter((c) => !q.contact || addressMatches(c.number, c.contactName, q.contact))
        .sort(newestFirst)
        .slice(0, q.limit ?? DEFAULT_LIMITS.calls);
    },
    async startCall(number) {
      placedCalls.push({ number: resolvePhone(number), at: now().toISOString() });
    },
  };

  // ---------- Notifications ----------
  const notifications: NotificationsSource = {
    async list(q) {
      return dataset.notifications
        .filter((n) => inRange(n.postedAt, q))
        .filter((n) => !q.app || includesCI([n.packageName, n.appName], q.app))
        .filter((n) => !q.query || includesCI([n.title, n.text, n.appName], q.query))
        .sort((a, b) => time(b.postedAt) - time(a.postedAt))
        .slice(0, q.limit ?? DEFAULT_LIMITS.notifications);
    },
  };

  // ---------- Calendar ----------
  const findEvent = (id: string): CalendarEvent => {
    const e = dataset.events.find((x) => x.id === id);
    if (!e) throw new Error(`Event not found: ${id}`);
    return e;
  };
  const calendar: CalendarSource = {
    async list(range) {
      const since = time(range.since);
      const until = time(range.until);
      // Overlap test: event intersects [since, until].
      return dataset.events
        .filter((e) => time(e.end) > since && time(e.start) <= until)
        .sort((a, b) => time(a.start) - time(b.start))
        .map((e) => ({ ...e }));
    },
    async create(e) {
      const created: CalendarEvent = { ...e, id: nextId('evt-new') };
      dataset.events.push(created);
      return { ...created };
    },
    async update(id, patch) {
      const e = findEvent(id);
      Object.assign(e, patch, { id });
      return { ...e };
    },
    async remove(id) {
      findEvent(id);
      dataset.events = dataset.events.filter((e) => e.id !== id);
    },
  };

  // ---------- Contacts ----------
  const contacts: ContactsSource = {
    async search(query, limit = DEFAULT_LIMITS.contacts) {
      return dataset.contacts.filter((c) => contactMatches(c, query)).slice(0, limit);
    },
    async get(id) {
      return dataset.contacts.find((c) => c.id === id) ?? null;
    },
    async all() {
      return [...dataset.contacts];
    },
  };

  // ---------- Email ----------
  const email: EmailSource = {
    async accounts() {
      return [...new Set(dataset.emails.map((e) => e.account))];
    },
    async search(q) {
      return dataset.emails
        .filter((e) => inRange(e.date, q))
        .filter((e) => !q.unreadOnly || e.unread)
        .filter((e) => !q.from || addressMatches(e.from, e.fromName, q.from))
        .filter((e) => !q.query || includesCI([e.subject, e.snippet, e.body, e.from, e.fromName], q.query))
        .sort(newestFirst)
        .slice(0, q.limit ?? DEFAULT_LIMITS.emails);
    },
    async get(id) {
      return dataset.emails.find((e) => e.id === id) ?? null;
    },
    async send(draft) {
      const id = nextId('email-sent');
      const at = now().toISOString();
      const parent = draft.inReplyToId ? dataset.emails.find((e) => e.id === draft.inReplyToId) : undefined;
      const sent: EmailMessage = {
        id,
        threadId: parent?.threadId ?? `et-${id}`,
        account: parent?.account ?? 'gmail',
        from: MOCK_USER_EMAIL,
        to: [...draft.to],
        subject: draft.subject,
        snippet: draft.body.replace(/\s+/g, ' ').slice(0, 120),
        body: draft.body,
        date: at,
        unread: false,
        labels: ['SENT'],
      };
      dataset.emails.push(sent);
      sentEmails.push({ id, to: [...draft.to], subject: draft.subject, body: draft.body, inReplyToId: draft.inReplyToId, at });
      return { id };
    },
  };

  // ---------- Photos ----------
  const photos: PhotosSource = {
    async list(q) {
      const near = q.near;
      return dataset.photos
        .filter((p) => inRange(p.takenAt, q))
        .filter((p) => {
          if (!near) return true;
          if (!p.location) return false;
          return haversineKm(near, p.location) <= (near.radiusKm ?? DEFAULT_RADIUS_KM);
        })
        .sort((a, b) => time(b.takenAt) - time(a.takenAt))
        .slice(0, q.limit ?? DEFAULT_LIMITS.photos);
    },
    async loadForVision(id, maxEdge) {
      const photo = dataset.photos.find((p) => p.id === id);
      if (!photo || !opts.photoLoader) return null;
      return opts.photoLoader(photo, maxEdge);
    },
  };

  // ---------- Location ----------
  const location: LocationSource = {
    async current() {
      return { ...dataset.current };
    },
    async home() {
      return { ...dataset.home };
    },
  };

  const d = opts.denied;
  return {
    mode: 'mock',
    texts: guard('texts', texts, d),
    calls: guard('calls', calls, d),
    notifications: guard('notifications', notifications, d),
    calendar: guard('calendar', calendar, d),
    contacts: guard('contacts', contacts, d),
    email: guard('email', email, d),
    photos: guard('photos', photos, d),
    location: guard('location', location, d),
    dataset,
    sentTexts,
    sentEmails,
    placedCalls,
  };
}
