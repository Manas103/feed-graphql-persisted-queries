import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import DataLoader from 'dataloader';
import { MockDb, Comment, Post, User, encodeCursor } from './db.js';

export interface Loaders {
  user: DataLoader<string, User | undefined>;
  likeCount: DataLoader<string, number>;
  comments: DataLoader<string, Comment[]>;
}

// Fresh loaders per request/execution: DataLoader's per-tick batching and per-instance
// memoization are both meant to live for exactly one request, never across requests,
// or an edit made in one request could leak a stale cached value into the next one.
export function makeLoaders(db: MockDb): Loaders {
  return {
    user: new DataLoader(async (ids) => db.getUsersByIds(ids)),
    likeCount: new DataLoader(async (ids) => db.getLikeCounts(ids)),
    comments: new DataLoader(async (ids) => db.getCommentsForPosts(ids, 10)),
  };
}

export type Mode = 'naive' | 'batched';

interface PostNode extends Post {}
interface CommentNode extends Comment {}

// Builds the executable schema fresh per call so the naive and batched benchmarks (and
// every test) each get their own resolver closures over a specific db/loaders pair,
// never sharing DataLoader's per-request cache across runs by accident.
export function buildFeedSchema(db: MockDb, mode: Mode, loaders?: Loaders): GraphQLSchema {
  if (mode === 'batched' && !loaders) throw new Error('batched mode requires loaders');

  const getUser = (id: string) => (mode === 'naive' ? db.getUserById(id) : loaders!.user.load(id));
  const getLikeCount = (postId: string) =>
    mode === 'naive' ? db.getLikeCount(postId) : loaders!.likeCount.load(postId);
  const getComments = (postId: string) =>
    mode === 'naive' ? db.getCommentsForPost(postId, 10) : loaders!.comments.load(postId);

  const UserType = new GraphQLObjectType({
    name: 'User',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      name: { type: new GraphQLNonNull(GraphQLString) },
      avatarUrl: { type: new GraphQLNonNull(GraphQLString) },
    }),
  });

  const CommentType = new GraphQLObjectType({
    name: 'Comment',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      text: { type: new GraphQLNonNull(GraphQLString) },
      author: {
        type: new GraphQLNonNull(UserType),
        resolve: (c: CommentNode) => getUser(c.authorId),
      },
    }),
  });

  const CommentEdgeType = new GraphQLObjectType({
    name: 'CommentEdge',
    fields: () => ({ node: { type: new GraphQLNonNull(CommentType) } }),
  });

  const CommentConnectionType = new GraphQLObjectType({
    name: 'CommentConnection',
    fields: () => ({
      edges: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(CommentEdgeType))) },
    }),
  });

  const PostType = new GraphQLObjectType({
    name: 'Post',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      text: { type: new GraphQLNonNull(GraphQLString) },
      createdAt: { type: new GraphQLNonNull(GraphQLFloat) },
      author: { type: new GraphQLNonNull(UserType), resolve: (p: PostNode) => getUser(p.authorId) },
      likeCount: { type: new GraphQLNonNull(GraphQLInt), resolve: (p: PostNode) => getLikeCount(p.id) },
      comments: {
        type: new GraphQLNonNull(CommentConnectionType),
        args: { first: { type: new GraphQLNonNull(GraphQLInt) } },
        resolve: async (p: PostNode) => {
          const comments = await getComments(p.id);
          return { edges: comments.map((c) => ({ node: c })) };
        },
      },
    }),
  });

  const FeedEdgeType = new GraphQLObjectType({
    name: 'FeedEdge',
    fields: () => ({
      cursor: { type: new GraphQLNonNull(GraphQLString) },
      node: { type: new GraphQLNonNull(PostType) },
    }),
  });

  const PageInfoType = new GraphQLObjectType({
    name: 'PageInfo',
    fields: () => ({
      hasNextPage: { type: new GraphQLNonNull(GraphQLBoolean) },
      endCursor: { type: GraphQLString },
    }),
  });

  const FeedConnectionType = new GraphQLObjectType({
    name: 'FeedConnection',
    fields: () => ({
      edges: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(FeedEdgeType))) },
      pageInfo: { type: new GraphQLNonNull(PageInfoType) },
    }),
  });

  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: () => ({
      feed: {
        type: new GraphQLNonNull(FeedConnectionType),
        args: {
          first: { type: new GraphQLNonNull(GraphQLInt) },
          after: { type: GraphQLString },
        },
        resolve: (_src, args: { first: number; after?: string | null }) => {
          const posts = db.getFeedPage(args.first, args.after ?? null);
          const lastPost = posts[posts.length - 1];
          const nextPage = lastPost ? db.getFeedPage(1, encodeCursor(lastPost)) : [];
          return {
            edges: posts.map((p) => ({ cursor: encodeCursor(p), node: p })),
            pageInfo: {
              hasNextPage: nextPage.length > 0,
              endCursor: lastPost ? encodeCursor(lastPost) : null,
            },
          };
        },
      },
    }),
  });

  return new GraphQLSchema({ query: QueryType });
}
