import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CalendarEvent, CallLogEntry, CapturedNotification, ChatCard, EmailMessage, PhotoAsset, SmsMessage } from '../../core/types';
import { formatDay, formatTime, relativeTime } from '../../core/util/time';
import { mockPhotoSource } from '../../platform/sources/mockPhotos';
import { useApp } from '../AppContext';
import { Icon, type IconName } from '../components/Icon';
import { Panel } from '../components/Panel';
import { Txt } from '../components/Txt';
import { space } from '../theme';
import { ConfirmCard } from './ConfirmCard';

function Row({ icon, title, meta, body, accent, a11y }: { icon: IconName; title: string; meta?: string; body?: string; accent?: string; a11y?: string }) {
  const { palette: p } = useApp();
  return (
    <View style={styles.row} accessible accessibilityLabel={a11y ?? [title, meta, body].filter(Boolean).join(', ')}>
      <View style={[styles.rowIcon, { borderColor: accent ?? p.line }]}>
        <Icon name={icon} size={18} color={accent ?? p.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.rowTop}>
          <Txt variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </Txt>
          {meta && (
            <Txt variant="mono" color={p.textTertiary}>
              {meta}
            </Txt>
          )}
        </View>
        {body ? (
          <Txt variant="small" color={p.textSecondary} numberOfLines={3}>
            {body}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

export function EventsCard({ events, label = 'Schedule', code, index }: { events: CalendarEvent[]; label?: string; code?: string; index?: number }) {
  const { palette: p } = useApp();
  const [now] = useState(() => Date.now());
  return (
    <Panel code={code} label={label} index={index}>
      <View style={{ gap: space.sm }}>
        {events.map((e) => {
          const live = Date.parse(e.start) <= now && Date.parse(e.end) >= now;
          const moved = /moved from/i.test(e.notes ?? '');
          return (
            <View key={e.id} style={styles.event} accessible accessibilityLabel={`${e.title}, ${formatDay(e.start)} at ${formatTime(e.start)}${e.location ? `, ${e.location}` : ''}${moved ? ', time changed' : ''}`}>
              <View style={[styles.timeCol, { borderRightColor: live ? p.red : p.line }]}>
                <Txt variant="mono" color={live ? p.text : p.text}>
                  {e.allDay ? 'ALL DAY' : formatTime(e.start)}
                </Txt>
                <Txt variant="mono" color={p.textTertiary} style={{ fontSize: 11 }}>
                  {formatDay(e.start).toUpperCase()}
                </Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={2}>
                  {e.title}
                </Txt>
                {(e.location || moved) && (
                  <View style={styles.rowTop}>
                    {moved && (
                      <Txt variant="mono" color={p.redGlow}>
                        TIME CHANGED
                      </Txt>
                    )}
                    {e.location ? (
                      <Txt variant="small" color={p.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
                        {e.location}
                      </Txt>
                    ) : null}
                  </View>
                )}
              </View>
            </View>
          );
        })}
        {events.length === 0 && (
          <Txt variant="small" color={p.textSecondary}>
            Clear.
          </Txt>
        )}
      </View>
    </Panel>
  );
}

export function TextsCard({ messages, label = 'Texts', index }: { messages: SmsMessage[]; label?: string; index?: number }) {
  const { palette: p } = useApp();
  return (
    <Panel label={label} index={index}>
      <View style={{ gap: space.md }}>
        {messages.map((m) => (
          <Row
            key={m.id}
            icon="message"
            title={m.direction === 'incoming' ? (m.contactName ?? m.address) : `To ${m.contactName ?? m.address}`}
            meta={relativeTime(m.date)}
            body={m.body}
            accent={m.direction === 'incoming' && !m.read ? p.text : undefined}
          />
        ))}
      </View>
    </Panel>
  );
}

export function EmailsCard({ emails, label = 'Email', index }: { emails: EmailMessage[]; label?: string; index?: number }) {
  const { palette: p } = useApp();
  return (
    <Panel label={label} index={index}>
      <View style={{ gap: space.md }}>
        {emails.map((e) => (
          <Row key={e.id} icon="mail" title={`${e.fromName ?? e.from} — ${e.subject}`} meta={relativeTime(e.date)} body={e.snippet || e.body.slice(0, 160)} accent={e.unread ? p.text : undefined} />
        ))}
      </View>
    </Panel>
  );
}

export function CallsCard({ calls, label = 'Calls', index }: { calls: CallLogEntry[]; label?: string; index?: number }) {
  const { palette: p } = useApp();
  return (
    <Panel label={label} index={index}>
      <View style={{ gap: space.md }}>
        {calls.map((c) => (
          <Row
            key={c.id}
            icon={c.type === 'missed' ? 'phoneMissed' : 'phone'}
            title={c.contactName ?? c.number}
            meta={relativeTime(c.date)}
            body={c.type === 'missed' ? 'Missed call' : `${c.type[0].toUpperCase()}${c.type.slice(1)} · ${Math.max(1, Math.round(c.durationSec / 60))} min`}
            accent={c.type === 'missed' ? p.red : undefined}
          />
        ))}
      </View>
    </Panel>
  );
}

export function NotificationsCard({ notifications, index }: { notifications: CapturedNotification[]; index?: number }) {
  return (
    <Panel label="Notifications" index={index}>
      <View style={{ gap: space.md }}>
        {notifications.map((n) => (
          <Row key={n.id} icon="bell" title={`${n.appName} · ${n.title}`} meta={relativeTime(n.postedAt)} body={n.text} />
        ))}
      </View>
    </Panel>
  );
}

export function PhotoGrid({ photos, index }: { photos: PhotoAsset[]; index?: number }) {
  const { palette: p } = useApp();
  return (
    <Panel label={`${photos.length} photo${photos.length === 1 ? '' : 's'}`} index={index}>
      <View style={styles.grid}>
        {photos.map((ph) => (
          <Pressable key={ph.id} style={[styles.thumb, { borderColor: p.line }]} accessibilityRole="image" accessibilityLabel={`Photo from ${formatDay(ph.takenAt)}${ph.location?.placeName ? ` at ${ph.location.placeName}` : ''}`}>
            <Image source={ph.uri.startsWith('mock://') ? mockPhotoSource(ph) : { uri: ph.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
            <View style={[styles.thumbMeta, { backgroundColor: p.scrim }]}>
              <Txt variant="mono" color={p.text} style={{ fontSize: 11 }} numberOfLines={1}>
                {formatDay(ph.takenAt).toUpperCase()}
              </Txt>
            </View>
          </Pressable>
        ))}
      </View>
    </Panel>
  );
}

export function SuspiciousCard({ source, excerpt, reason }: { source: string; excerpt: string; reason: string }) {
  const { palette: p } = useApp();
  return (
    <Panel tone="alert" code="ALERT" label="Suspicious content" animate={false} accessibilityLabel={`Suspicious ${source}. ${reason}. Optimus ignored it.`}>
      <View style={{ gap: space.sm }}>
        <View style={styles.rowTop}>
          <Icon name="alert" size={18} color={p.redGlow} />
          <Txt variant="smallStrong" color={p.redGlow} style={{ flex: 1 }}>
            {reason} — in a {source}. Ignored.
          </Txt>
        </View>
        <Txt variant="small" color={p.textSecondary} numberOfLines={4}>
          “{excerpt}”
        </Txt>
      </View>
    </Panel>
  );
}

export function MemorySavedChip({ content }: { content: string }) {
  const { palette: p } = useApp();
  return (
    <View style={[styles.chip, { borderColor: p.redDim, backgroundColor: p.bg }]} accessible accessibilityLabel={`Saved to memory: ${content}`}>
      <Icon name="check" size={14} color={p.text} />
      <Txt variant="small" color={p.textSecondary} numberOfLines={2} style={{ flex: 1 }}>
        Memory · {content}
      </Txt>
    </View>
  );
}

export function ChatCardView({ card, index }: { card: ChatCard; index?: number }) {
  switch (card.type) {
    case 'events':
      return <EventsCard events={card.events} index={index} />;
    case 'texts':
      return <TextsCard messages={card.messages} index={index} />;
    case 'emails':
      return <EmailsCard emails={card.emails} index={index} />;
    case 'calls':
      return <CallsCard calls={card.calls} index={index} />;
    case 'notifications':
      return <NotificationsCard notifications={card.notifications} index={index} />;
    case 'photos':
      return <PhotoGrid photos={card.photos} index={index} />;
    case 'confirm':
      return <ConfirmCard actionId={card.actionId} />;
    case 'suspicious':
      return <SuspiciousCard source={card.source} excerpt={card.excerpt} reason={card.reason} />;
    case 'memory-saved':
      return <MemorySavedChip content={card.content} />;
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  rowIcon: { width: 32, height: 32, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  event: { flexDirection: 'row', gap: space.md, alignItems: 'center', minHeight: 48 },
  timeCol: { width: 84, borderRightWidth: 2, paddingRight: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: '31%', aspectRatio: 1, borderWidth: 1, borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  thumbMeta: { paddingHorizontal: 4, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6, alignSelf: 'flex-start', maxWidth: '100%' },
});
