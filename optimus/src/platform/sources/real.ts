import * as Calendar from 'expo-calendar/legacy';
import * as Contacts from 'expo-contacts/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import { PermissionsAndroid, Platform } from 'react-native';
import * as Native from '../../../modules/optimus-android';
import type { NotificationStore } from '../../core/notifications/store';
import { AccessError, type DataSources, type SourceName } from '../../core/sources/types';
import type { CalendarEvent, CallLogEntry, Contact, PhotoAsset, SmsMessage } from '../../core/types';
import { kvGet } from '../../core/settings/settings';
import type { Db } from '../../core/db/types';
import { createEmailSource } from './email';

// PermissionsAndroid is undefined on web (preview only).
const P = (PermissionsAndroid?.PERMISSIONS ?? {}) as typeof PermissionsAndroid.PERMISSIONS;

async function requireAndroidPermission(source: SourceName, permission: (typeof P)[keyof typeof P]) {
  if (Platform.OS !== 'android' || !Native.isAvailable()) throw new AccessError(source, 'unavailable');
  if (!(await PermissionsAndroid.check(permission))) throw new AccessError(source, 'permission-denied');
}

const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Packages whose notifications carry chat messages (incl. RCS not in the SMS DB). */
export const CHAT_PACKAGES = ['com.samsung.android.messaging', 'com.google.android.apps.messaging'];

function toContact(c: Contacts.ExistingContact): Contact {
  const rel = c.relationships?.[0]?.label;
  return {
    id: c.id ?? '',
    name: c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' '),
    nickname: c.nickname ?? undefined,
    relationship: rel ?? undefined,
    phones: (c.phoneNumbers ?? []).map((p) => p.number ?? '').filter(Boolean),
    emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
    birthday: c.birthday?.year && c.birthday.month != null && c.birthday.day ? `${c.birthday.year}-${String(c.birthday.month + 1).padStart(2, '0')}-${String(c.birthday.day).padStart(2, '0')}` : undefined,
    company: c.company ?? undefined,
    note: c.note ?? undefined,
  };
}

const CONTACT_FIELDS = [
  Contacts.Fields.Name,
  Contacts.Fields.FirstName,
  Contacts.Fields.LastName,
  Contacts.Fields.Nickname,
  Contacts.Fields.PhoneNumbers,
  Contacts.Fields.Emails,
  Contacts.Fields.Birthday,
  Contacts.Fields.Company,
  Contacts.Fields.Note,
  Contacts.Fields.Relationships,
];

export function createRealSources(deps: { db: Db; notifications: NotificationStore; locationEnabled: () => boolean; icloudProxy?: () => string | null }): DataSources {
  let contactCache: { at: number; list: Contact[] } | null = null;

  async function contactsAll(): Promise<Contact[]> {
    if (contactCache && Date.now() - contactCache.at < 5 * 60_000) return contactCache.list;
    const perm = await Contacts.getPermissionsAsync();
    if (!perm.granted) throw new AccessError('contacts', 'permission-denied');
    const res = await Contacts.getContactsAsync({ fields: CONTACT_FIELDS, pageSize: 5000 });
    contactCache = { at: Date.now(), list: res.data.map(toContact) };
    return contactCache.list;
  }

  async function nameFor(number: string): Promise<string | undefined> {
    try {
      const d = digits(number);
      if (d.length < 7) return undefined;
      return (await contactsAll()).find((c) => c.phones.some((p) => digits(p) === d))?.name;
    } catch {
      return undefined; // contacts permission is optional for this
    }
  }

  async function writableCalendarId(): Promise<string> {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const primary = cals.find((c) => c.allowsModifications && c.isPrimary) ?? cals.find((c) => c.allowsModifications);
    if (!primary) throw new Error('No writable calendar on this phone.');
    return primary.id;
  }

  async function requireCalendar() {
    const perm = await Calendar.getCalendarPermissionsAsync();
    if (!perm.granted) throw new AccessError('calendar', 'permission-denied');
  }

  const toEvent = (e: Calendar.Event): CalendarEvent => ({
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    start: new Date(e.startDate).toISOString(),
    end: new Date(e.endDate).toISOString(),
    allDay: e.allDay,
    location: e.location ?? undefined,
    notes: e.notes ?? undefined,
  });

  async function smsToMessage(r: Native.RawSms): Promise<SmsMessage> {
    return {
      id: r.id,
      threadId: r.threadId,
      address: r.address,
      contactName: await nameFor(r.address),
      body: r.body,
      date: new Date(r.dateMs).toISOString(),
      direction: r.type === 'inbox' ? 'incoming' : 'outgoing',
      read: r.read,
      kind: r.kind,
    };
  }

  /** Chat-app notifications become pseudo-messages, so RCS chats aren't invisible. */
  async function rcsFromNotifications(q: { query?: string; since?: string; until?: string; limit?: number }): Promise<SmsMessage[]> {
    const out: SmsMessage[] = [];
    for (const pkg of CHAT_PACKAGES) {
      const list = await deps.notifications.list({ app: pkg, query: q.query, since: q.since, until: q.until, limit: q.limit ?? 30 });
      for (const n of list) {
        out.push({ id: `rcs:${n.id}`, threadId: `rcs:${n.title}`, address: n.title, contactName: n.title, body: n.text, date: n.postedAt, direction: 'incoming', read: false, kind: 'rcs-notification' });
      }
    }
    return out;
  }

  return {
    mode: 'real',

    texts: {
      async search(q) {
        await requireAndroidPermission('texts', P.READ_SMS);
        let threadNumber: string | undefined;
        let contactName: string | undefined;
        if (q.contact) {
          if (/\d{7,}/.test(digits(q.contact))) threadNumber = q.contact;
          else {
            const c = (await contactsAll().catch(() => [])).find((x) => x.name.toLowerCase().includes(q.contact!.toLowerCase()));
            threadNumber = c?.phones[0];
            contactName = c?.name;
          }
        }
        const raw = await Native.getSmsMessages({ sinceMs: q.since ? Date.parse(q.since) : undefined, limit: 500, query: q.query });
        let msgs = await Promise.all(raw.filter((r) => !threadNumber || digits(r.address) === digits(threadNumber)).filter((r) => !q.until || r.dateMs <= Date.parse(q.until)).slice(0, q.limit ?? 20).map(smsToMessage));
        const rcs = (await rcsFromNotifications(q)).filter((m) => !contactName || m.contactName?.toLowerCase().includes(contactName.split(' ')[0].toLowerCase()));
        msgs = [...msgs, ...rcs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, q.limit ?? 20);
        return msgs;
      },
      async recentThreads(limit = 12) {
        await requireAndroidPermission('texts', P.READ_SMS);
        const raw = await Native.getSmsMessages({ limit: 300 });
        const seen = new Set<string>();
        const latest: Native.RawSms[] = [];
        for (const r of raw) {
          if (seen.has(r.threadId)) continue;
          seen.add(r.threadId);
          latest.push(r);
          if (latest.length >= limit) break;
        }
        return Promise.all(latest.map(smsToMessage));
      },
      async send(to, body) {
        await requireAndroidPermission('texts', P.SEND_SMS);
        return Native.sendSms(to, body);
      },
      async limitations() {
        const notes = ["Some RCS chat messages (Samsung Messages / Google Messages) aren't stored in the SMS database. Optimus reads incoming ones from their notifications instead, so replies you sent from another device and RCS media may be missing."];
        if (!(await kvGet(deps.db, 'notifications.listenerSeen'))) notes.push('Notification access is off, so RCS chats are not visible at all.');
        return notes;
      },
    },

    calls: {
      async list(q) {
        await requireAndroidPermission('calls', P.READ_CALL_LOG);
        let number: string | undefined;
        if (q.contact) {
          number = /\d{7,}/.test(digits(q.contact)) ? q.contact : (await contactsAll().catch(() => [])).find((c) => c.name.toLowerCase().includes(q.contact!.toLowerCase()))?.phones[0];
          if (!number) return [];
        }
        const raw = await Native.getCallLog({ sinceMs: q.since ? Date.parse(q.since) : undefined, limit: 300, number });
        const out: CallLogEntry[] = [];
        for (const c of raw) {
          if (q.until && c.dateMs > Date.parse(q.until)) continue;
          const type = c.type === 'blocked' || c.type === 'other' ? 'rejected' : c.type;
          if (q.type && type !== q.type) continue;
          out.push({ id: c.id, number: c.number, contactName: c.cachedName ?? (await nameFor(c.number)), date: new Date(c.dateMs).toISOString(), durationSec: c.durationSec, type });
          if (out.length >= (q.limit ?? 20)) break;
        }
        return out;
      },
      async startCall(number) {
        if (!Native.isAvailable()) throw new AccessError('calls', 'unavailable');
        await Native.startCall(number);
      },
    },

    notifications: {
      async list(q) {
        const status = Native.getDeviceStatus();
        if (status && !status.notificationAccessGranted) {
          const any = await deps.notifications.list({ limit: 1 });
          if (!any.length) throw new AccessError('notifications', 'permission-denied');
        }
        return deps.notifications.list(q);
      },
    },

    calendar: {
      async list({ since, until }) {
        await requireCalendar();
        const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const events = await Calendar.getEventsAsync(cals.map((c) => c.id), new Date(since), new Date(until));
        return events.map(toEvent).sort((a, b) => a.start.localeCompare(b.start));
      },
      async create(e) {
        await requireCalendar();
        const id = await Calendar.createEventAsync(await writableCalendarId(), {
          title: e.title,
          startDate: new Date(e.start),
          endDate: new Date(e.end),
          allDay: e.allDay,
          location: e.location,
          notes: e.notes,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        return { ...e, id };
      },
      async update(id, patch) {
        await requireCalendar();
        await Calendar.updateEventAsync(id, {
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.start ? { startDate: new Date(patch.start) } : {}),
          ...(patch.end ? { endDate: new Date(patch.end) } : {}),
          ...(patch.location != null ? { location: patch.location } : {}),
          ...(patch.notes != null ? { notes: patch.notes } : {}),
        });
        const ev = await Calendar.getEventAsync(id);
        return toEvent(ev);
      },
      async remove(id) {
        await requireCalendar();
        await Calendar.deleteEventAsync(id);
      },
    },

    contacts: {
      async search(query, limit = 10) {
        const q = query.toLowerCase().trim();
        const all = await contactsAll();
        return all
          .filter((c) => c.name.toLowerCase().includes(q) || c.nickname?.toLowerCase() === q || c.relationship?.toLowerCase() === q || c.phones.some((p) => digits(p) === digits(q) && digits(q).length >= 7))
          .slice(0, limit);
      },
      async get(id) {
        const perm = await Contacts.getPermissionsAsync();
        if (!perm.granted) throw new AccessError('contacts', 'permission-denied');
        const c = await Contacts.getContactByIdAsync(id, CONTACT_FIELDS);
        return c ? toContact(c) : null;
      },
      all: contactsAll,
    },

    email: createEmailSource({ icloudProxy: deps.icloudProxy }),

    photos: {
      async list(q) {
        const perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) throw new AccessError('photos', 'permission-denied');
        const page = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.photo,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
          first: q.near ? 300 : Math.min(q.limit ?? 40, 600),
          createdAfter: q.since ? new Date(q.since) : undefined,
          createdBefore: q.until ? new Date(q.until) : undefined,
        });
        const out: PhotoAsset[] = [];
        for (const a of page.assets) {
          let location: PhotoAsset['location'];
          if (q.near) {
            const info = await MediaLibrary.getAssetInfoAsync(a);
            if (!info.location) continue;
            location = { latitude: info.location.latitude, longitude: info.location.longitude };
            const km = haversineKm(location, q.near);
            if (km > (q.near.radiusKm ?? 2)) continue;
          }
          const screenshot = /screenshot|screen_?record|screen ?capture/i.test(`${a.filename} ${a.uri}`);
          out.push({ id: a.id, uri: a.uri, filename: a.filename, takenAt: new Date(a.creationTime).toISOString(), width: a.width, height: a.height, location, screenshot });
          if (out.length >= (q.limit ?? 40)) break;
        }
        return out;
      },
      async page(cursor, size) {
        const perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) throw new AccessError('photos', 'permission-denied');
        const r = await MediaLibrary.getAssetsAsync({ mediaType: MediaLibrary.MediaType.photo, sortBy: [[MediaLibrary.SortBy.creationTime, false]], first: size, after: cursor });
        return {
          photos: r.assets.map((a) => ({ id: a.id, uri: a.uri, filename: a.filename, takenAt: new Date(a.creationTime).toISOString(), width: a.width, height: a.height, screenshot: /screenshot|screen_?record|screen ?capture/i.test(`${a.filename} ${a.uri}`) })),
          next: r.hasNextPage ? r.endCursor : undefined,
          total: r.totalCount,
        };
      },
      async get(id) {
        const a = await MediaLibrary.getAssetInfoAsync(id).catch(() => null);
        if (!a) return null;
        return { id: a.id, uri: a.uri, filename: a.filename, takenAt: new Date(a.creationTime).toISOString(), width: a.width, height: a.height, screenshot: /screenshot/i.test(`${a.filename} ${a.uri}`) };
      },
      async loadForVision(id, maxEdge) {
        const info = await MediaLibrary.getAssetInfoAsync(id);
        const uri = info.localUri ?? info.uri;
        return resizeForVision(uri, info.width, info.height, maxEdge);
      },
    },

    location: {
      async current() {
        if (!deps.locationEnabled()) throw new AccessError('location', 'permission-denied', 'Location is turned off in Settings');
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) throw new AccessError('location', 'permission-denied');
        const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      },
      async home() {
        const raw = await kvGet(deps.db, 'location.home');
        return raw ? JSON.parse(raw) : null;
      },
    },
  };
}

export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Shrinks a photo so only what's needed goes to Claude vision. */
export async function resizeForVision(uri: string, width: number, height: number, maxEdge: number): Promise<{ base64: string; mediaType: 'image/jpeg' } | null> {
  const scale = Math.min(1, maxEdge / Math.max(width || maxEdge, height || maxEdge));
  const ctx = ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize(width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
  return out.base64 ? { base64: out.base64, mediaType: 'image/jpeg' } : null;
}
