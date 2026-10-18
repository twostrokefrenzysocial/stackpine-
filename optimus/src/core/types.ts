// Shared domain types. Pure TypeScript: no React Native imports, so everything
// under src/core can be unit tested in Node.

export type ISODate = string; // ISO 8601 timestamp

// ---------- Data sources ----------

export interface Contact {
  id: string;
  name: string;
  nickname?: string;
  relationship?: string; // "wife", "boss", ... (from contact notes or memory)
  phones: string[];
  emails: string[];
  birthday?: string; // YYYY-MM-DD
  company?: string;
  note?: string; // written by the user or synced; still treated as data
}

export interface SmsMessage {
  id: string;
  threadId: string;
  address: string; // phone number
  contactName?: string;
  body: string;
  date: ISODate;
  direction: 'incoming' | 'outgoing';
  read: boolean;
  kind: 'sms' | 'mms' | 'rcs' | 'rcs-notification';
}

export interface CallLogEntry {
  id: string;
  number: string;
  contactName?: string;
  date: ISODate;
  durationSec: number;
  type: 'incoming' | 'outgoing' | 'missed' | 'rejected' | 'voicemail';
}

export interface CapturedNotification {
  id: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  postedAt: ISODate;
  category?: string;
  redacted: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId?: string;
  title: string;
  start: ISODate;
  end: ISODate;
  allDay?: boolean;
  location?: string;
  notes?: string;
  attendees?: string[];
}

export interface EmailMessage {
  id: string;
  threadId: string;
  account: 'gmail' | 'outlook' | 'icloud' | 'mock';
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  snippet: string;
  body: string;
  date: ISODate;
  unread: boolean;
  important?: boolean;
  labels?: string[];
}

export interface PhotoAsset {
  id: string;
  uri: string;
  filename: string;
  takenAt: ISODate;
  width: number;
  height: number;
  location?: { latitude: number; longitude: number; placeName?: string };
  /** Screenshots are skipped when searching for real-world things. */
  screenshot?: boolean;
  // Mock photos ship a caption so vision can be simulated offline.
  mockCaption?: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label?: string;
}

// ---------- Memory ----------

export const MEMORY_CATEGORIES = [
  'About Me',
  'People',
  'Preferences',
  'Routines',
  'Projects and Goals',
  'Places',
  'Important Dates',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemorySourceKind =
  | 'conversation'
  | 'sms'
  | 'email'
  | 'calls'
  | 'notifications'
  | 'calendar'
  | 'contacts'
  | 'photos'
  | 'manual'
  | 'import';

export interface Memory {
  id: string;
  category: MemoryCategory;
  content: string;
  source: MemorySourceKind;
  sourceRef?: string; // conversation id, message id, ...
  contactId?: string; // People entries link to one contact
  personName?: string; // canonical name for People entries
  aliases?: string[]; // "my wife", "Jen"
  createdAt: ISODate;
  updatedAt: ISODate;
  lastUsedAt?: ISODate;
  importance: 1 | 2 | 3 | 4 | 5;
  previousValue?: string;
  sensitive?: boolean;
  derivedFrom?: string[]; // ids of memories this one was derived from
}

export type PendingMemoryStatus = 'pending' | 'approved' | 'rejected';
export interface PendingMemory {
  id: string;
  category: MemoryCategory;
  content: string;
  source: MemorySourceKind;
  sourceRef?: string;
  reason: string; // why it's pending: "learned from email", "sensitive"
  personName?: string;
  contactId?: string;
  importance: Memory['importance'];
  createdAt: ISODate;
  status: PendingMemoryStatus;
}

export interface Episode {
  id: string;
  conversationId: string;
  summary: string;
  decisions: string[];
  openTasks: string[];
  topics: string[];
  createdAt: ISODate;
}

// ---------- Conversations ----------

export type ChatRole = 'user' | 'assistant';

/** A rich card rendered inside the chat stream. */
export type ChatCard =
  | { type: 'events'; events: CalendarEvent[] }
  | { type: 'texts'; messages: SmsMessage[] }
  | { type: 'emails'; emails: EmailMessage[] }
  | { type: 'photos'; photos: PhotoAsset[]; title?: string }
  | { type: 'calls'; calls: CallLogEntry[] }
  | { type: 'notifications'; notifications: CapturedNotification[] }
  | { type: 'confirm'; actionId: string }
  | { type: 'suspicious'; source: string; excerpt: string; reason: string }
  | { type: 'memory-saved'; memoryId: string; content: string }
  | { type: 'sources'; sources: { title: string; url: string }[] };

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  text: string;
  cards: ChatCard[];
  createdAt: ISODate;
  /** Raw API content blocks for the assistant turn (kept for search/audit). */
  apiContent?: unknown;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  rollingSummary?: string;
  summarizedThroughMessageId?: string;
  processedAt?: ISODate; // background extraction done
}

// ---------- Actions requiring confirmation ----------

export type ActionKind =
  | 'send_text'
  | 'start_call'
  | 'create_event'
  | 'edit_event'
  | 'delete_event'
  | 'send_email'
  | 'save_memory_from_data'
  | 'create_reminder'
  | 'create_routine'
  | 'delete_routine'
  | 'delete_memory';

export type ActionStatus = 'pending' | 'approved' | 'executed' | 'failed' | 'cancelled';

export interface PendingAction {
  id: string;
  conversationId?: string;
  kind: ActionKind;
  /** Human-readable title, e.g. "Text to Sarah". */
  title: string;
  /** The full draft shown on the card. Editable fields are listed in `editable`. */
  draft: Record<string, unknown>;
  editable: string[];
  status: ActionStatus;
  createdAt: ISODate;
  resolvedAt?: ISODate;
  resultMessage?: string;
}

// ---------- Activity log ----------

export interface ActivityEntry {
  id: string;
  at: ISODate;
  kind: 'read' | 'action' | 'suspicious' | 'error' | 'memory' | 'system';
  tool?: string;
  summary: string;
  detail?: string;
}

// ---------- Reminders ----------

export interface Reminder {
  id: string;
  text: string;
  dueAt: ISODate;
  createdAt: ISODate;
  notificationId?: string;
  done: boolean;
  conversationId?: string;
}

// ---------- Daily brief ----------

export interface DailyBrief {
  id: string;
  date: string; // YYYY-MM-DD
  generatedAt: ISODate;
  headline: string;
  schedule: CalendarEvent[];
  peopleWaiting: { name: string; channel: 'text' | 'email'; preview: string; at: ISODate }[];
  missed: { kind: 'call' | 'notification'; label: string; at: ISODate }[];
  openTasks: string[];
  followUps: string[];
  reminders: Reminder[];
  narrative?: string; // short prose written by Haiku (optional)
}
