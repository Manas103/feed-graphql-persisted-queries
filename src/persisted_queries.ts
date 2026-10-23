import { createHash } from 'node:crypto';
import { parse, print } from 'graphql';
import { AuthorFragment } from '../components/Author.js';
import { CommentFragment } from '../components/Comment.js';
import { CommentListFragment } from '../components/CommentList.js';
import { FeedItemFragment } from '../components/FeedItem.js';

// The registry of every component's colocated fragment, in no particular order: the
// compiler below does not rely on this list being in dependency order, since GraphQL
// documents (unlike most source files) do not require a fragment to be declared
// before something that spreads it.
const COMPONENT_FRAGMENTS: string[] = [
  AuthorFragment,
  CommentFragment,
  CommentListFragment,
  FeedItemFragment,
];

const ROOT_OPERATION = `
  query FeedRender($first: Int!, $after: String) {
    feed(first: $first, after: $after) {
      edges {
        cursor
        node { ...FeedItemFields }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function fragmentName(source: string): string {
  const m = source.match(/fragment\s+(\w+)\s+on/);
  if (!m) throw new Error(`could not find a fragment name in: ${source}`);
  return m[1];
}

// Collects every fragment reachable from the component registry, deduplicated by
// name (two components could in principle spread the same fragment; GraphQL rejects a
// document that declares the same fragment name twice), and stitches them onto the
// root operation into one document. This is the entire "colocated fragments compile
// into one persisted query" claim: this function is what does the compiling.
export function buildFeedRenderDocument(): string {
  const seen = new Map<string, string>();
  for (const frag of COMPONENT_FRAGMENTS) {
    seen.set(fragmentName(frag), frag);
  }
  const parts = [ROOT_OPERATION, ...[...seen.values()]];
  const documentText = parts.join('\n');
  // Parsing (and re-printing through graphql's canonical printer) both validates the
  // stitched document and normalizes whitespace, so the persisted query id below is
  // stable across insignificant formatting changes to the component source files.
  const ast = parse(documentText);
  return print(ast);
}

export function computePersistedQueryId(documentText: string): string {
  return createHash('sha256').update(documentText).digest('hex');
}

export interface PersistedQueryManifestEntry {
  id: string;
  query: string;
}

export function compileFeedRenderPersistedQuery(): PersistedQueryManifestEntry {
  const query = buildFeedRenderDocument();
  const id = computePersistedQueryId(query);
  return { id, query };
}
