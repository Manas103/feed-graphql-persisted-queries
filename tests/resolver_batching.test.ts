import { describe, expect, it } from 'vitest';
import { parse, execute } from 'graphql';
import { MockDb } from '../src/db.js';
import { buildFeedSchema, makeLoaders } from '../src/schema.js';
import { buildFeedRenderDocument } from '../src/persisted_queries.js';

describe('resolver batching', () => {
  it('batched execution returns byte-identical data to naive execution, with far fewer db calls', async () => {
    const document = parse(buildFeedRenderDocument());
    const variables = { first: 20, after: null };

    const naiveDb = new MockDb(50, 40, 10);
    const naiveResult = await execute({
      schema: buildFeedSchema(naiveDb, 'naive'),
      document,
      variableValues: variables,
    });

    const batchedDb = new MockDb(50, 40, 10);
    const loaders = makeLoaders(batchedDb);
    const batchedResult = await execute({
      schema: buildFeedSchema(batchedDb, 'batched', loaders),
      document,
      variableValues: variables,
    });

    expect(naiveResult.errors).toBeUndefined();
    expect(batchedResult.errors).toBeUndefined();
    expect(JSON.stringify(batchedResult.data)).toBe(JSON.stringify(naiveResult.data));
    expect(batchedDb.counter.total()).toBeLessThan(naiveDb.counter.total());
    // The naive resolver issues one db call per field per node with no coalescing;
    // for 20 posts with author+likeCount+comments(10 with authors) that is a lot of
    // calls. The exact ratio is reported by bench/run_resolver_batching_bench.ts and
    // recorded in build_report.json; this test only asserts the batched path is a
    // real, large reduction, not a specific number.
    expect(naiveDb.counter.total()).toBeGreaterThan(200);
    expect(batchedDb.counter.total()).toBeLessThan(10);
  });
});
