import { z } from "zod";
import { createMigratedDb } from "./helpers/sqliteDb";
import { EpisodeStore } from "../conversations/store";
import { growthLevel, measureGrowth, stageFor } from "../growth/growth";
import type { BackgroundLlm } from "../llm/background";
import { consolidateMemories, knowledgeDigest } from "../memory/consolidate";
import { MemoryStore } from "../memory/store";

const NOW = new Date("2026-10-19T08:00:00Z");

describe("growth", () => {
  it("starts near zero and grows with diminishing returns", async () => {
    const db = await createMigratedDb();
    const g0 = await measureGrowth(db, NOW);
    expect(g0.level).toBeLessThan(0.05);
    expect(g0.stage).toBe("Forming");
    const a = growthLevel({
      memories: 20,
      people: 5,
      patterns: 2,
      episodes: 10,
      photosIndexed: 500,
      actions: 5,
      daysKnown: 7,
    });
    const b = growthLevel({
      memories: 200,
      people: 40,
      patterns: 20,
      episodes: 100,
      photosIndexed: 6000,
      actions: 60,
      daysKnown: 120,
    });
    expect(a).toBeGreaterThan(0.1);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1);
    expect(stageFor(b)).toBe("Deep");
    // Days with the user count even before anything is saved.
    const later = await measureGrowth(
      db,
      new Date(NOW.getTime() + 30 * 86_400_000),
    );
    expect(later.daysKnown).toBe(30);
    expect(later.level).toBeGreaterThan(g0.level);
  });
});

describe("consolidation", () => {
  function fakeLlm(answer: unknown): BackgroundLlm & { calls: number } {
    return {
      label: "fake",
      calls: 0,
      async json<T>(task: { schema: z.ZodType<T> }): Promise<T> {
        this.calls++;
        return task.schema.parse(answer);
      },
    } as BackgroundLlm & { calls: number };
  }

  it("derives patterns from approved memories and conversations, reinforces confirmed facts, and runs once a day", async () => {
    const db = await createMigratedDb();
    const memory = new MemoryStore(db);
    const episodes = new EpisodeStore(db);
    const ids: string[] = [];
    for (const [category, content] of [
      ["Routines", "The user goes to church on Sunday mornings"],
      ["People", "Miriam is the user’s wife"],
      ["Preferences", "The user prefers calls to texts for anything emotional"],
      ["Routines", "The user takes medication at 6:30am and 7:30pm"],
    ] as const) {
      const r = await memory.save(
        {
          category,
          content,
          source: "conversation",
          personName: category === "People" ? "Miriam" : undefined,
        },
        { now: NOW },
      );
      if (r.status === "saved") ids.push(r.memory.id);
    }
    const ep = await episodes.upsertForConversation(
      {
        conversationId: "c1",
        summary:
          "The user asked how things are going with Miriam and wanted a plan for Sunday.",
        decisions: [],
        openTasks: ["Book dinner for Friday"],
        topics: ["Miriam"],
      },
      NOW,
    );
    const llm = fakeLlm({
      patterns: [
        {
          statement:
            "The user protects Sunday mornings for church and family and avoids scheduling over them",
          evidence_ids: [ids[0], ep.id],
          confidence: "likely",
        },
        {
          statement: "Unsupported claim",
          evidence_ids: ["nope"],
          confidence: "strong",
        },
      ],
      reinforce: [{ id: ids[1], why: "Mentioned again" }],
    });
    const r = await consolidateMemories({
      db,
      memory,
      episodes,
      llm,
      now: NOW,
    });
    expect(r).toEqual({ patterns: 1, reinforced: 1 });
    const patterns = await memory.list("Patterns");
    expect(patterns).toHaveLength(1);
    expect(patterns[0].source).toBe("derived");
    expect(patterns[0].derivedFrom).toEqual([ids[0], ep.id]);
    expect((await memory.get(ids[1]))!.importance).toBe(4);

    // Same day: no second call. Next day with nothing new: still no call.
    expect(
      await consolidateMemories({
        db,
        memory,
        episodes,
        llm,
        now: new Date(NOW.getTime() + 3_600_000),
      }),
    ).toBeNull();
    expect(
      await consolidateMemories({
        db,
        memory,
        episodes,
        llm,
        now: new Date(NOW.getTime() + 25 * 3_600_000),
      }),
    ).toBeNull();
    expect(llm.calls).toBe(1);

    const digest = await knowledgeDigest(memory, episodes);
    expect(digest).toMatch(
      /^Patterns noticed over time:\n- The user protects Sunday mornings/,
    );
    expect(digest).toContain("[People] Miriam");
    expect(digest).toContain("Book dinner for Friday");
    expect((await measureGrowth(db, NOW)).patterns).toBe(1);
  });
});
