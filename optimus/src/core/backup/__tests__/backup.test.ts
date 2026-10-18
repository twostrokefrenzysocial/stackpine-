import { randomBytes } from 'node:crypto';
import { createMigratedDb } from '../../__tests__/helpers/sqliteDb';
import { ConversationStore } from '../../conversations/store';
import { MemoryStore } from '../../memory/store';
import { saveSettings } from '../../settings/settings';
import { BackupError, createBackup, readBackup, restoreBackup } from '../backup';

const random = (n: number) => new Uint8Array(randomBytes(n));

describe('encrypted backup', () => {
  it('round-trips memories and conversations to a new phone, with search intact', async () => {
    const oldPhone = await createMigratedDb();
    const mem = new MemoryStore(oldPhone);
    await mem.save({ category: 'Preferences', content: 'Takes coffee black, no sugar', source: 'conversation' });
    await mem.save({ category: 'People', content: 'Wife; loves tulips', personName: 'Jen Ruiz', aliases: ['my wife'], source: 'conversation' });
    const convs = new ConversationStore(oldPhone);
    const c = await convs.create('Chicago trip');
    await convs.addMessage(c.id, { role: 'user', text: 'Book the hotel near the conference in Chicago' });
    await saveSettings(oldPhone, { briefTime: '06:45' });

    const file = await createBackup(oldPhone, 'correct horse battery', random);
    expect(file).not.toContain('coffee');
    expect(file).not.toContain('Chicago');

    const newPhone = await createMigratedDb();
    const r = await restoreBackup(newPhone, file, 'correct horse battery');
    expect(r).toEqual({ memories: 2, conversations: 1 });
    const restored = new MemoryStore(newPhone);
    expect((await restored.search('coffee'))[0].memory.content).toMatch(/black/);
    expect((await restored.findPerson('my wife'))?.personName).toBe('Jen Ruiz');
    expect(await new ConversationStore(newPhone).search('hotel Chicago')).toHaveLength(1);
  });

  it('rejects a wrong passphrase and non-backup files', async () => {
    const db = await createMigratedDb();
    const file = await createBackup(db, 'passphrase-1', random);
    await expect(readBackup(file, 'passphrase-2')).rejects.toBeInstanceOf(BackupError);
    await expect(readBackup('{"hello":1}', 'x')).rejects.toThrow(/isn’t an Optimus backup/);
    await expect(createBackup(db, 'short', random)).rejects.toThrow(/at least 8/);
  });
});
