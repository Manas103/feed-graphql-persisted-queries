// Executes the exact query the colocated-fragment compiler produces (see
// src/persisted_queries.ts) twice against the same seeded feed: once with naive
// resolvers (every field hits the mock db directly) and once with DataLoader-backed
// batched resolvers, counting underlying db calls each time and diffing the two
// results to confirm batching changed nothing about what was returned, only how many
// calls it took to return it.
import { parse, execute } from 'graphql';
import { MockDb } from '../src/db.js';
import { buildFeedSchema, makeLoaders } from '../src/schema.js';
import { buildFeedRenderDocument } from '../src/persisted_queries.js';

async function run(numPosts: number, commentsPerPost: number, numUsers: number, pageSize: number) {
  const document = parse(buildFeedRenderDocument());
  const variables = { first: pageSize, after: null };

  const naiveDb = new MockDb(numUsers, numPosts, commentsPerPost);
  const naiveSchema = buildFeedSchema(naiveDb, 'naive');
  const naiveResult = await execute({ schema: naiveSchema, document, variableValues: variables });

  const batchedDb = new MockDb(numUsers, numPosts, commentsPerPost);
  const loaders = makeLoaders(batchedDb);
  const batchedSchema = buildFeedSchema(batchedDb, 'batched', loaders);
  const batchedResult = await execute({
    schema: batchedSchema,
    document,
    variableValues: variables,
  });

  const naiveJson = JSON.stringify(naiveResult.data);
  const batchedJson = JSON.stringify(batchedResult.data);
  const identical = naiveJson === batchedJson;

  console.log('---RESULTS---');
  console.log(`page_size=${pageSize} comments_per_post=${commentsPerPost} num_users=${numUsers}`);
  console.log(`naive_db_calls=${naiveDb.counter.total()} naive_breakdown=${JSON.stringify(naiveDb.counter.breakdown())}`);
  console.log(`batched_db_calls=${batchedDb.counter.total()} batched_breakdown=${JSON.stringify(batchedDb.counter.breakdown())}`);
  console.log(`results_identical=${identical}`);
  if (naiveResult.errors) console.log(`naive_errors=${JSON.stringify(naiveResult.errors)}`);
  if (batchedResult.errors) console.log(`batched_errors=${JSON.stringify(batchedResult.errors)}`);

  if (!identical) {
    console.error('FAIL: batched result differs from naive result');
    process.exitCode = 1;
  }
}

const pageSize = Number(process.argv[2] ?? 20);
const commentsPerPost = Number(process.argv[3] ?? 10);
const numUsers = Number(process.argv[4] ?? 50);

run(500, commentsPerPost, numUsers, pageSize);
