import { describe, expect, it } from 'vitest';
import { parse } from 'graphql';
import {
  buildFeedRenderDocument,
  compileFeedRenderPersistedQuery,
  computePersistedQueryId,
} from '../src/persisted_queries.js';

describe('persisted query compilation', () => {
  it('compiles the colocated fragments into one valid, single-operation document', () => {
    const document = buildFeedRenderDocument();
    const ast = parse(document); // throws if composition produced invalid GraphQL
    const operations = ast.definitions.filter((d) => d.kind === 'OperationDefinition');
    expect(operations).toHaveLength(1);
    const fragments = ast.definitions.filter((d) => d.kind === 'FragmentDefinition');
    // Author, Comment, CommentList, FeedItem: one component, one fragment each.
    expect(fragments).toHaveLength(4);
  });

  it('is deterministic: compiling twice gives the same id', () => {
    const a = compileFeedRenderPersistedQuery();
    const b = compileFeedRenderPersistedQuery();
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(computePersistedQueryId(a.query));
  });

  it('a persisted request ({id, variables}) is smaller than sending the full query text', () => {
    const { id, query } = compileFeedRenderPersistedQuery();
    const variables = { first: 20, after: null };
    const fullBody = JSON.stringify({ query, variables });
    const persistedBody = JSON.stringify({ id, variables });
    expect(persistedBody.length).toBeLessThan(fullBody.length);
  });
});
