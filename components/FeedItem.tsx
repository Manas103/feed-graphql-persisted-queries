import React from 'react';
import { Author } from './Author.js';
import { CommentList } from './CommentList.js';

export const FeedItemFragment = `
  fragment FeedItemFields on Post {
    id
    text
    createdAt
    likeCount
    author { ...AuthorFields }
    ...CommentListFields
  }
`;

export interface FeedItemProps {
  post: {
    id: string;
    text: string;
    createdAt: number;
    likeCount: number;
    author: { id: string; name: string; avatarUrl: string };
  } & Parameters<typeof CommentList>[0]['post'];
}

export function FeedItem({ post }: FeedItemProps) {
  return (
    <article className="feed-item">
      <Author author={post.author} />
      <p>{post.text}</p>
      <span>{post.likeCount} likes</span>
      <CommentList post={post} />
    </article>
  );
}
