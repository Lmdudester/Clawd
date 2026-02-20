import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './skills.js';

describe('parseFrontmatter', () => {
  it('parses standard frontmatter', () => {
    const content = `---
name: Test Skill
description: A test skill
---
body content`;
    expect(parseFrontmatter(content)).toEqual({
      name: 'Test Skill',
      description: 'A test skill',
    });
  });

  it('returns empty object when no frontmatter', () => {
    expect(parseFrontmatter('just content')).toEqual({});
  });

  it('returns empty object for empty frontmatter block', () => {
    expect(parseFrontmatter('---\n---')).toEqual({});
  });

  it('splits only on first colon for values containing colons', () => {
    const content = `---
description: A skill: for testing
---`;
    expect(parseFrontmatter(content)).toEqual({
      description: 'A skill: for testing',
    });
  });

  it('parses user-invocable key', () => {
    const content = `---
name: My Skill
user-invocable: true
---`;
    expect(parseFrontmatter(content)).toEqual({
      name: 'My Skill',
      'user-invocable': 'true',
    });
  });

  it('trims whitespace from keys and values', () => {
    const content = `---
  name  :  Spaced Out
---`;
    expect(parseFrontmatter(content)).toEqual({
      name: 'Spaced Out',
    });
  });
});
