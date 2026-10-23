import React from 'react';
import { Comment } from './Comment.js';

export const CommentListFragment = `
  fragment CommentListFields on Post {
    comments(first: 10) {
      edges {
        node { ...CommentFields }
      }
    }
  }
`;

export interface CommentListProps {
  post: { comments: { edges: Array<{ node: Parameters<typeof Comment>[0]['comment'] }> } };
}

export function CommentList({ post }: CommentListProps) {
  return (
    <div className="comment-list">
      {post.comments.edges.map((e) => (
        <Comment key={e.node.id} comment={e.node} />
      ))}
    </div>
  );
}
