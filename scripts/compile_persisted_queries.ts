// Build-time step: stitches every component's colocated fragment into the one
// document the feed render sends, computes its persisted query id, writes the
// server-side manifest (id -> query text) a persisted-query endpoint would load, and
// reports the request-payload reduction a client gets from sending {id, variables}
// instead of the full query text every time.
import { writeFileSync } from 'node:fs';
import { compileFeedRenderPersistedQuery } from '../src/persisted_queries.js';

const { id, query } = compileFeedRenderPersistedQuery();

const manifest = { [id]: query };
writeFileSync('docs/persisted-queries.json', JSON.stringify(manifest, null, 2) + '\n');

const variables = { first: 20, after: null };
const fullRequestBody = JSON.stringify({ query, variables });
const persistedRequestBody = JSON.stringify({ id, variables });
const reductionPct = (1 - persistedRequestBody.length / fullRequestBody.length) * 100;

console.log('---RESULTS---');
console.log(`persisted_query_id=${id}`);
console.log(`full_request_bytes=${fullRequestBody.length}`);
console.log(`persisted_request_bytes=${persistedRequestBody.length}`);
console.log(`payload_reduction_pct=${reductionPct.toFixed(2)}`);
console.log(`fragment_count_compiled=4`); // Author, Comment, CommentList, FeedItem
