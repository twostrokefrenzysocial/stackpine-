import type { BackgroundLlm } from '../../llm/background';
import type { PhotosSource } from '../../sources/types';
import type { PhotoAsset } from '../../types';
import { createMigratedDb } from '../../__tests__/helpers/sqliteDb';
import { indexNextBatch, photoIndexStats, searchPhotoIndex } from '../photoIndex';

/** A big fake library, newest first, with one old scanned print buried deep. */
function library(n: number): { photos: PhotosSource; loads: string[] } {
  const all: PhotoAsset[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    uri: `file://p${i}.jpg`,
    filename: i % 7 === 3 ? `Screenshot_${i}.png` : `IMG_${i}.jpg`,
    takenAt: new Date(Date.UTC(2026, 9, 18) - i * 86_400_000).toISOString(),
    width: 4000,
    height: 3000,
    screenshot: i % 7 === 3,
  }));
  const loads: string[] = [];
  const photos: PhotosSource = {
    async list() {
      return all.slice(0, 40);
    },
    async page(cursor, size) {
      const start = cursor ? Number(cursor) : 0;
      return { photos: all.slice(start, start + size), next: start + size < all.length ? String(start + size) : undefined, total: all.length };
    },
    async get(id) {
      return all.find((p) => p.id === id) ?? null;
    },
    async loadForVision(id) {
      loads.push(id);
      return { base64: id, mediaType: 'image/jpeg' };
    },
  };
  return { photos, loads };
}

/** Describes each image from its "pixels" (here, its id). p137 is the childhood photo. */
const describer = (): BackgroundLlm & { calls: number } => {
  const llm = {
    label: 'fake',
    calls: 0,
    async json() {
      throw new Error('unused');
    },
    async vision<T>(task: { images: { label: string; base64: string }[]; schema: { parse: (v: unknown) => T } }) {
      llm.calls++;
      return task.schema.parse({
        photos: task.images.map((img) => ({
          label: img.label,
          description:
            img.base64 === 'p137'
              ? 'Old scanned film print, faded colors, likely 1990s. A young boy sits on the grass next to an elderly woman (grandmother age) with another young boy on her other side. Outdoors, backyard.'
              : `Recent phone photo of a pumpkin patch, adults and a toddler. ${img.base64}`,
        })),
      });
    },
  };
  return llm as unknown as BackgroundLlm & { calls: number };
};

describe('photo index', () => {
  it('works through the whole library in batches, skipping screenshots, and finds an old photo by description', async () => {
    const db = await createMigratedDb();
    const { photos, loads } = library(200);
    const llm = describer();
    let added = 0;
    for (let i = 0; i < 40; i++) {
      const n = await indexNextBatch({ db, photos, llm, batch: 10 });
      if (!n) break;
      added += n;
    }
    const stats = await photoIndexStats(db);
    expect(stats.complete).toBe(true);
    expect(added).toBe(stats.indexed);
    expect(stats.indexed).toBe(200 - Math.ceil((200 - 3) / 7));
    expect(loads.some((id) => /^p(3|10|17)$/.test(id))).toBe(false); // screenshots never sent
    const hits = await searchPhotoIndex(db, 'young boy with grandma and cousin sitting in the grass old photo');
    expect(hits[0].id).toBe('p137');
  });

  it('picks up new photos first on later runs, without redoing old ones', async () => {
    const db = await createMigratedDb();
    const { photos } = library(30);
    const llm = describer();
    while (await indexNextBatch({ db, photos, llm, batch: 10 }));
    const before = llm.calls;
    expect(await indexNextBatch({ db, photos, llm, batch: 10 })).toBe(0);
    expect(llm.calls).toBe(before);
  });

  it('does nothing without a model that can see', async () => {
    const db = await createMigratedDb();
    const { photos } = library(10);
    expect(await indexNextBatch({ db, photos, llm: undefined })).toBe(0);
  });
});
