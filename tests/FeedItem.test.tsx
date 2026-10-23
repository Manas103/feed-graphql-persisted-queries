import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedItem } from '../components/FeedItem.js';

describe('FeedItem (colocated-fragment component)', () => {
  it('renders the fields its own fragment declares', () => {
    const post = {
      id: 'p1',
      text: 'hello feed',
      createdAt: 1_700_000_000_000,
      likeCount: 42,
      author: { id: 'u1', name: 'Ada', avatarUrl: '/a.png' },
      comments: {
        edges: [
          {
            node: {
              id: 'c1',
              text: 'nice post',
              author: { id: 'u2', name: 'Grace', avatarUrl: '/g.png' },
            },
          },
        ],
      },
    };

    render(<FeedItem post={post} />);

    expect(screen.getByText('hello feed')).toBeTruthy();
    expect(screen.getByText('42 likes')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('nice post')).toBeTruthy();
    expect(screen.getByText('Grace')).toBeTruthy();
  });
});
