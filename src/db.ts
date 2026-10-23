// A mock "database" for the feed: an in-memory store plus a call counter. The counter
// is the thing every claim in this project is measured against, so it lives on the
// data-access boundary, not inside a resolver or a DataLoader -- a resolver that reads
// from cache instead of calling one of these functions does not increment it, which is
// exactly the distinction the batching claim is about.
export interface User {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  createdAt: number;
}

export interface Post {
  id: string;
  authorId: string;
  text: string;
  createdAt: number;
}

export class CallCounter {
  private counts = new Map<string, number>();

  // Counts *calls*, not keys: a batched call for 50 ids is still one call.
  recordCall(fn: string) {
    this.counts.set(fn, (this.counts.get(fn) ?? 0) + 1);
  }

  total(): number {
    let t = 0;
    for (const v of this.counts.values()) t += v;
    return t;
  }

  breakdown(): Record<string, number> {
    return Object.fromEntries(this.counts.entries());
  }

  reset() {
    this.counts.clear();
  }
}

export class MockDb {
  readonly users = new Map<string, User>();
  readonly posts: Post[] = [];
  readonly commentsByPost = new Map<string, Comment[]>();
  readonly likeCounts = new Map<string, number>();
  readonly counter = new CallCounter();

  constructor(numUsers: number, numPosts: number, commentsPerPost: number) {
    for (let i = 0; i < numUsers; i++) {
      this.users.set(`u${i}`, { id: `u${i}`, name: `User ${i}`, avatarUrl: `/avatar/${i}.png` });
    }
    for (let i = 0; i < numPosts; i++) {
      const authorId = `u${i % numUsers}`;
      const post: Post = {
        id: `p${i}`,
        authorId,
        text: `Post number ${i}`,
        createdAt: 1_700_000_000_000 - i * 1000,
      };
      this.posts.push(post);
      const comments: Comment[] = [];
      for (let c = 0; c < commentsPerPost; c++) {
        // Comment authors cycle through a *different* phase than post authors so the
        // two id sets overlap partially: this is what makes DataLoader's per-tick
        // dedup matter, rather than the batching win being an artifact of every
        // comment author being the same one user.
        const commentAuthorId = `u${(i * 7 + c * 3) % numUsers}`;
        comments.push({
          id: `p${i}-c${c}`,
          postId: post.id,
          authorId: commentAuthorId,
          text: `Comment ${c} on post ${i}`,
          createdAt: post.createdAt - (c + 1) * 10,
        });
      }
      this.commentsByPost.set(post.id, comments);
      this.likeCounts.set(post.id, (i * 13) % 500);
    }
  }

  // --- Unbatched, one-id-at-a-time access (what a naive resolver calls directly) ---
  getUserById(id: string): User | undefined {
    this.counter.recordCall('getUserById');
    return this.users.get(id);
  }

  getCommentsForPost(postId: string, limit: number): Comment[] {
    this.counter.recordCall('getCommentsForPost');
    return (this.commentsByPost.get(postId) ?? []).slice(0, limit);
  }

  getLikeCount(postId: string): number {
    this.counter.recordCall('getLikeCount');
    return this.likeCounts.get(postId) ?? 0;
  }

  // --- Batched, many-ids-at-once access (what a DataLoader batch function calls) ---
  getUsersByIds(ids: readonly string[]): User[] {
    this.counter.recordCall('getUsersByIds');
    return ids.map((id) => this.users.get(id)!);
  }

  getCommentsForPosts(postIds: readonly string[], limit: number): Comment[][] {
    this.counter.recordCall('getCommentsForPosts');
    return postIds.map((id) => (this.commentsByPost.get(id) ?? []).slice(0, limit));
  }

  getLikeCounts(postIds: readonly string[]): number[] {
    this.counter.recordCall('getLikeCounts');
    return postIds.map((id) => this.likeCounts.get(id) ?? 0);
  }

  getFeedPage(first: number, afterCursor: string | null): Post[] {
    this.counter.recordCall('getFeedPage');
    const sorted = this.posts; // already newest-first by construction
    let startIdx = 0;
    if (afterCursor) {
      const idx = sorted.findIndex((p) => encodeCursor(p) === afterCursor);
      startIdx = idx === -1 ? sorted.length : idx + 1;
    }
    return sorted.slice(startIdx, startIdx + first);
  }
}

export function encodeCursor(post: Post): string {
  return Buffer.from(`${post.createdAt}:${post.id}`).toString('base64');
}
