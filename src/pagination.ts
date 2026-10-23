// Cursor-connection pagination over a feed that mutates while it is being paginated,
// plus the naive offset-based paginator it replaced, kept here specifically so the
// contrast is runnable and not just asserted. "Concurrently mutated" means: between
// each page request (each `await`), a Mutator inserts new posts at the head of the
// feed, exactly the gap where a real HTTP client's next-page request would land after
// another write landed on the server. Node is single-threaded, so "concurrent" here is
// about interleaving across awaited page fetches, not true parallel execution; that is
// also precisely the interleaving a real paginated UI experiences, one request at a time.

export interface FeedPost {
  id: string;
  createdAt: number; // strictly decreasing with id's insertion order; ties broken by id
}

export class MutableFeed {
  private posts: FeedPost[] = []; // newest first
  private nextSeq = 0;

  constructor(initialSize: number) {
    for (let i = 0; i < initialSize; i++) this.insertAtHead(`seed-${i}`);
  }

  private insertAtHead(idSuffix: string) {
    this.nextSeq += 1;
    this.posts.unshift({ id: `p-${idSuffix}-${this.nextSeq}`, createdAt: 1_000_000_000 + this.nextSeq });
  }

  insertNew(): FeedPost {
    this.nextSeq += 1;
    const post = { id: `new-${this.nextSeq}`, createdAt: 2_000_000_000 + this.nextSeq };
    this.posts.unshift(post);
    return post;
  }

  allIds(): string[] {
    return this.posts.map((p) => p.id);
  }

  size(): number {
    return this.posts.length;
  }

  // Cursor-based page: everything strictly older than `afterCursor` (by createdAt,
  // tie-broken by id), independent of position. A head-insert shifts no existing
  // item's cursor, so a walk already past a given item is unaffected by it.
  cursorPage(first: number, afterCursor: string | null): { ids: string[]; cursor: string | null } {
    let startIdx = 0;
    if (afterCursor !== null) {
      const idx = this.posts.findIndex((p) => p.id === afterCursor);
      startIdx = idx === -1 ? this.posts.length : idx + 1;
    }
    const page = this.posts.slice(startIdx, startIdx + first);
    return { ids: page.map((p) => p.id), cursor: page.length ? page[page.length - 1].id : null };
  }

  // Naive page: everything at [offset, offset+first), identified only by position. A
  // head-insert shifts every existing item's offset by the insert count, which is
  // exactly the bug class this project's cursor design avoids.
  offsetPage(first: number, offset: number): string[] {
    return this.posts.slice(offset, offset + first).map((p) => p.id);
  }
}

export interface WalkResult {
  seenIds: string[];
  duplicates: number;
  skipped: number;
}

// Walks the full feed with the cursor paginator while `mutationsDuringWalk` new posts
// are inserted at the head, one per page fetched (a realistic one-write-between-requests
// rate). Returns which of the original snapshot ids were seen, and how many times.
export async function cursorWalk(
  feed: MutableFeed,
  pageSize: number,
  mutationsDuringWalk: number
): Promise<WalkResult> {
  const snapshot = new Set(feed.allIds());
  const seenCount = new Map<string, number>();
  let cursor: string | null = null;
  let mutationsLeft = mutationsDuringWalk;

  while (true) {
    const { ids, cursor: nextCursor } = feed.cursorPage(pageSize, cursor);
    if (ids.length === 0) break;
    for (const id of ids) seenCount.set(id, (seenCount.get(id) ?? 0) + 1);
    cursor = nextCursor;
    if (mutationsLeft > 0) {
      feed.insertNew();
      mutationsLeft--;
    }
    await Promise.resolve(); // yield, the point at which a real request boundary sits
  }

  let duplicates = 0;
  let skipped = 0;
  for (const id of snapshot) {
    const c = seenCount.get(id) ?? 0;
    if (c === 0) skipped++;
    else if (c > 1) duplicates++;
  }
  return { seenIds: [...seenCount.keys()], duplicates, skipped };
}

// Same walk, same mutation pattern, but using the offset paginator: demonstrates the
// failure mode the cursor design exists to avoid. Not one of this project's claims;
// kept because the contrast is the point (see README, "what broke").
export async function offsetWalk(
  feed: MutableFeed,
  pageSize: number,
  mutationsDuringWalk: number
): Promise<WalkResult> {
  const snapshot = new Set(feed.allIds());
  const seenCount = new Map<string, number>();
  let offset = 0;
  let mutationsLeft = mutationsDuringWalk;

  while (offset < feed.size()) {
    const ids = feed.offsetPage(pageSize, offset);
    if (ids.length === 0) break;
    for (const id of ids) seenCount.set(id, (seenCount.get(id) ?? 0) + 1);
    offset += pageSize;
    if (mutationsLeft > 0) {
      feed.insertNew();
      mutationsLeft--;
    }
    await Promise.resolve();
  }

  let duplicates = 0;
  let skipped = 0;
  for (const id of snapshot) {
    const c = seenCount.get(id) ?? 0;
    if (c === 0) skipped++;
    else if (c > 1) duplicates++;
  }
  return { seenIds: [...seenCount.keys()], duplicates, skipped };
}
