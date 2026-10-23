# feed-graphql-persisted-queries

A feed surface where every component declares its own colocated GraphQL fragment, a
build step stitches them into one persisted query, and a DataLoader-backed resolver
layer collapses the per-node database calls those fragments would otherwise cause.
Cursor-based pagination is checked against a concurrently mutated feed for the
specific bug class ("items vanish while scrolling") that offset pagination cannot
avoid. Every number below was measured on this machine, not targeted.

## Why this exists

A small version of Meta's own client stack: React components colocate the data they
need in a fragment, the client never ships raw query text (a persisted query id
instead), and a batching loader is what makes nested per-node resolvers not cost one
database round trip per node. `dataloader` is the actual package Meta published for
exactly this pattern; this project uses it, not a hand-rolled substitute.

## What this is, and is not

- **Relay-inspired, not Relay.** There is no Relay compiler, no `useFragment` runtime,
  no normalized client store. "Colocation" here means a component file exports a
  `fragment` string alongside its React component, and `src/persisted_queries.ts`
  walks a hand-maintained registry of those exports to stitch the final document.
  Relay does the equivalent walk at build time over every file in a project
  automatically; this project's registry is four entries, listed explicitly.
- **A GraphQL schema and resolvers, not a running HTTP server.** Everything executes
  in-process via `graphql-js`'s `execute()`. There is no Express/Apollo Server here,
  and no network call; the "request payload" measurement compares JSON string sizes
  that a real client/server pair would exchange, not bytes actually sent over a socket.
  gzip would shrink both numbers; the relative reduction would not change by much
  (both bodies are mostly small, highly repetitive text).
- **The feed is a `Map`-backed mock, not a database.** "Database calls" are counted at
  the boundary of a mock `MockDb` class with in-memory data (`src/db.ts`); nothing
  here talks to MySQL or Postgres. The claim is about resolver-call fan-out, which the
  call counter measures honestly regardless of what is behind it.
- **"Concurrently mutated" means interleaved across awaited page requests, not
  multi-threaded.** Node is single-threaded. The mutator in `src/pagination.ts`
  inserts a new post between each `await` in the paginator's loop, which is the actual
  shape of the real bug (another write landing between two of a client's page
  requests), not a claim about thread-level races.

## Machine and toolchain

Node.js v22.17.1, npm 10.9.2, TypeScript 5.5, `graphql` 16.9, `dataloader` 2.2.2,
`vitest` 5.0.5 (jsdom environment) with `@testing-library/react` 16, run on Windows 11
(AMD Ryzen 7 7800X3D). All benchmarks and tests are pure computation with no I/O other
than reading/writing small files in `docs/`; CPU core count does not materially affect
single-threaded Node benchmark numbers here, so it is not reported per-run.

## Architecture

```
components/
  Author.tsx        colocated AuthorFields fragment + <Author/>
  Comment.tsx        colocated CommentFields fragment (spreads AuthorFields) + <Comment/>
  CommentList.tsx    colocated CommentListFields fragment + <CommentList/>
  FeedItem.tsx       colocated FeedItemFields fragment (spreads the above) + <FeedItem/>
src/
  db.ts               mock feed database + CallCounter (what every claim measures)
  schema.ts           graphql-js schema; naive resolvers call db.ts directly, batched
                       resolvers call through DataLoader
  persisted_queries.ts  collects every component's fragment, stitches the one document,
                       hashes it into a persisted query id
  pagination.ts       MutableFeed, cursorWalk (the claim), offsetWalk (the contrast)
bench/
  run_resolver_batching_bench.ts   naive vs batched db-call count, result diff
  run_pagination_bench.ts           1,000-trial duplicate/skip tally, both paginators
scripts/
  compile_persisted_queries.ts   writes docs/persisted-queries.json, reports payload size
tests/
  resolver_batching.test.ts, persisted_queries.test.ts, pagination.test.ts,
  FeedItem.test.tsx (jsdom + React Testing Library)
```

**Why fragments spread by name instead of inlining their dependencies' text.** An
early version of `CommentFragment` tried to embed `AuthorFragment`'s source directly
so each fragment file was "self-contained." Composing two such fragments into one
document then declared `fragment AuthorFields` twice, which GraphQL rejects. The fix,
and the actual Relay-shaped answer, is that a fragment spreads its dependency by name
(`...AuthorFields`) and a single compiler pass collects every named fragment once; see
Findings for the exact failure this produced before the fix.

**Why DataLoader instances are created per-request, not per-process.** A loader
memoizes every key it has ever seen for its lifetime; sharing one loader across
requests would let a stale value from request A leak into request B. `makeLoaders()`
is called once per `execute()` in both the benchmark and the tests, matching how a
real GraphQL server scopes loaders to the request context.

## Validation

**Result-identity oracle.** The resolver-batching benchmark and its test both execute
the *same* compiled document against two independently seeded `MockDb` instances, one
with naive resolvers and one with batched resolvers, and assert the JSON-serialized
results are byte-identical. Batching is only a valid optimization if it never changes
what a query returns; this is checked on every run, not asserted once.

**Deterministic compilation.** `persisted_queries.test.ts` compiles the document twice
and asserts the same id both times, and parses the stitched document with `graphql`'s
own parser, which is what would catch a fragment-naming collision like the one in
Findings.

```
$ npx vitest run
 Test Files  4 passed (4)
      Tests  8 passed (8)
```
Full output: `docs/test_output.txt`.

## Findings

**The first version of the fragment compiler produced a document that could not
parse, and the error pointed at the wrong fragment.** `CommentFragment` originally
interpolated `AuthorFragment`'s source directly into its own template string, so that
each fragment file "contained everything it needed." That worked fine in isolation.
The moment `FeedItemFragment` (which also, transitively, needs `AuthorFields`) was
stitched into the same document as `CommentListFragment` -> `CommentFragment`, the
assembled text declared `fragment AuthorFields on User { ... }` twice, and `graphql`'s
parser reported a duplicate-fragment-name error whose location pointed at the *second*
occurrence, inside `CommentFragment`, which made it look like `Comment.tsx` was the
file to fix. It was not: the actual problem was the inlining strategy itself, which
cannot scale past one level of fragment nesting without collisions. The fix was making
every component export only its own fragment's text, spreading dependencies by name,
and having `persisted_queries.ts` deduplicate by fragment name once, globally, when it
assembles the document. This is also exactly why Relay's real compiler works the way
it does: fragments are a flat namespace, assembled once, not textually nested per file.

**The naive offset paginator does not just occasionally skip an item, it reliably
duplicates hundreds.** Running the same concurrent-insert pattern through
`offsetWalk` instead of `cursorWalk` (same 1,000 trials, same mutation schedule)
produced 3,997 duplicated items across the run and zero skipped ones. The mechanism:
every head-insert shifts all existing items one slot higher, so the next
fixed-offset page re-reads items the previous page already returned, rather than
missing items entirely, in this particular (insert-only, no deletes) mutation pattern.
A workload that deleted instead of inserted would skip, not duplicate. Either way, the
failure is "offset is a position, not an identity," which is the one-sentence reason
the cursor design exists.

## Measured results

| Claim | Measured | Meets claim |
|---|---|---|
| 1,240 resolver database calls per feed render reduced to 18 | naive **1,237**, batched **5** (results byte-identical) | no (see note) |
| request payload fell 94% | **84.84%** (732 bytes full query+variables -> 111 bytes persisted id+variables) | no |
| 1,000 cursor paginations against a concurrently mutated feed: 0 duplicated items | **0 / 1,000** | yes |
| 1,000 cursor paginations against a concurrently mutated feed: 0 skipped items | **0 / 1,000** | yes |
| each component's colocated data fragment compiled into one persisted query id | **true**: 4 components, 4 fragments, 1 compiled document, 1 sha256 id | yes |

**On the 1,237 -> 5 result.** Three page sizes were tried for "one feed render": the
default 20 posts (naive 262 calls, batched 6), and 95 posts, chosen because
`2 + 13*posts = 1240` solves to `posts = 95.2`, giving naive **1,237**, within 3 of the
claim. Batched calls did not scale with page size in either run (6, then 5): this
schema's batching only has two sequential "waves" (post-level fields, then
comment-author fields), each wave one DataLoader dispatch per loader, so the batched
count is bounded by loader count and wave depth, not by how many posts are on the
page. Reaching exactly 18 batched calls would need a schema with more independent
loaders or more sequential resolution stages than this one has (for example a
per-viewer "liked by me" field, or mutual-friends suggestions); adding fields solely
to move this number would be tuning the benchmark to the target, which this project's
standard does not allow, so the honest result is a far larger reduction than claimed
(about 247x here, versus the claimed 69x), achieved with fewer distinct batched calls,
not more.

**On the 84.84% payload result.** The compiled document is 634 bytes; a sha256 hex
persisted-query id is a fixed 64 bytes. For a 732-byte full request body (query +
`{first:20, after:null}` variables) against a 111-byte persisted-id body, the
reduction is 84.84%, not 94%. The gap is arithmetic, not a bug: reaching 94% at this
fixed id size would need roughly a 1,850-byte query, about 3x this one's size. A richer
feed-render query (more fields, more fragments) would close the gap; this project's
query is the one its own four components actually declare.

## Building and running

```bash
npm install
npx vitest run

npx tsx bench/run_resolver_batching_bench.ts 95 10 50   # page_size comments_per_post num_users
npx tsx bench/run_pagination_bench.ts 1000
npx tsx scripts/compile_persisted_queries.ts             # writes docs/persisted-queries.json
```

## Limitations

- The 1,240 -> 18 resolver-call claim and the 94% payload claim were not reached; see
  Measured results for what was tried and why the shortfall is structural to this
  schema's size, not a measurement artifact.
- No real network layer: payload-size numbers are JSON string lengths, not bytes
  measured on a socket, and nothing here is gzip-compressed the way a real HTTP
  response would be.
- "Concurrent" mutation is interleaving across `await` points in a single Node
  process, not multi-threaded or multi-process concurrency.
- The persisted-query id is a full sha256 hex digest (64 bytes); a production system
  optimizing purely for payload size might use a shorter hash, which this project does
  not do, since sha256 is what Apollo's own Automatic Persisted Queries convention
  uses and changing it just to inflate the percentage would be tuning the benchmark.
