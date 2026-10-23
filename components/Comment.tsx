import React from 'react';
import { Author } from './Author.js';

// Spreads AuthorFields but does not inline its text: the compiler
// (src/persisted_queries.ts) collects every component's fragment once from its own
// registry and deduplicates by name, so a fragment never embeds its dependencies'
// source directly (that would duplicate `fragment AuthorFields on User { ... }` once
// per spreader and fail to parse as one document).
export const CommentFragment = `
  fragment CommentFields on Comment {
    id
    text
    author { ...AuthorFields }
  }
`;

export interface CommentProps {
  comment: { id: string; text: string; author: { id: string; name: string; avatarUrl: string } };
}

export function Comment({ comment }: CommentProps) {
  return (
    <div className="comment">
      <Author author={comment.author} />
      <p>{comment.text}</p>
    </div>
  );
}
