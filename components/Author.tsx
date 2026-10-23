import React from 'react';

// Colocated fragment: this component declares exactly the User fields it reads, and
// nothing else. scripts/compile_persisted_queries.ts (and src/persisted_queries.ts,
// which it shares with the tests and the batching benchmark) walk every component's
// exported `*Fragment` constant to build the one query the feed render actually sends.
export const AuthorFragment = `
  fragment AuthorFields on User {
    id
    name
    avatarUrl
  }
`;

export interface AuthorProps {
  author: { id: string; name: string; avatarUrl: string };
}

export function Author({ author }: AuthorProps) {
  return (
    <span className="author">
      <img src={author.avatarUrl} alt={author.name} width={20} height={20} />
      {author.name}
    </span>
  );
}
