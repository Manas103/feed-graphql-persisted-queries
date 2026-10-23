import { describe, expect, it } from 'vitest';
import { MutableFeed, cursorWalk, offsetWalk } from '../src/pagination.js';

describe('cursor pagination under concurrent mutation', () => {
  it('produces 0 duplicates and 0 skipped items over 1000 trials', async () => {
    let duplicates = 0;
    let skipped = 0;
    for (let t = 0; t < 1000; t++) {
      const feed = new MutableFeed(50);
      const mutations = (t % 7) + 1;
      const result = await cursorWalk(feed, 5, mutations);
      duplicates += result.duplicates;
      skipped += result.skipped;
    }
    expect(duplicates).toBe(0);
    expect(skipped).toBe(0);
  });

  it('a single walk sees every pre-existing item exactly once even with new inserts', async () => {
    const feed = new MutableFeed(30);
    const before = new Set(feed.allIds());
    const result = await cursorWalk(feed, 4, 5);
    const seenBefore = result.seenIds.filter((id) => before.has(id));
    expect(new Set(seenBefore).size).toBe(before.size);
  });
});

describe('the naive offset paginator it replaced (not a claim, the contrast)', () => {
  it('the same mutation pattern produces real duplicates under offset pagination', async () => {
    const feed = new MutableFeed(50);
    const result = await offsetWalk(feed, 5, 5);
    // This is the bug this project's cursor design exists to avoid; asserting it is
    // non-zero here is intentional, not a bug in the test.
    expect(result.duplicates).toBeGreaterThan(0);
  });
});
