// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PluginSummary } from '@scripts/plugins';
import {
    parsePluginQuery,
    damerauLevenshtein,
    maxDistanceFor,
    bestTokenScore,
    pluginSearchScore,
} from '@scripts/features/settingsPluginSearch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
    return {
        id: 'test-plugin',
        name: 'Test Plugin',
        description: 'A plugin for testing',
        category: 'vcs',
        tags: ['git', 'test'],
        author: 'jane',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// parsePluginQuery
// ---------------------------------------------------------------------------

describe('parsePluginQuery', () => {
    it('returns empty query for empty string', () => {
        expect(parsePluginQuery('')).toEqual({ terms: [], authors: [], tags: [] });
    });

    it('returns empty query for whitespace-only input', () => {
        expect(parsePluginQuery('   \t  \n  ')).toEqual({ terms: [], authors: [], tags: [] });
    });

    it('parses simple space-separated terms', () => {
        const q = parsePluginQuery('hello world');
        expect(q.terms).toEqual(['hello', 'world']);
        expect(q.authors).toEqual([]);
        expect(q.tags).toEqual([]);
    });

    it('lowercases terms', () => {
        const q = parsePluginQuery('HELLO World');
        expect(q.terms).toEqual(['hello', 'world']);
    });

    it('parses @author notation', () => {
        const q = parsePluginQuery('@jane');
        expect(q.terms).toEqual([]);
        expect(q.authors).toEqual(['jane']);
        expect(q.tags).toEqual([]);
    });

    it('parses #tag notation', () => {
        const q = parsePluginQuery('#git');
        expect(q.terms).toEqual([]);
        expect(q.tags).toEqual(['git']);
        expect(q.authors).toEqual([]);
    });

    it('parses mixed terms, authors and tags', () => {
        const q = parsePluginQuery('awesome @jane #git #vcs tool');
        expect(q.terms).toEqual(['awesome', 'tool']);
        expect(q.authors).toEqual(['jane']);
        expect(q.tags).toEqual(['git', 'vcs']);
    });

    it('parses double-quoted strings as single terms', () => {
        const q = parsePluginQuery('"hello world" "foo bar" extra');
        expect(q.terms).toEqual(['hello world', 'foo bar', 'extra']);
    });

    it('parses single-quoted strings as single terms', () => {
        const q = parsePluginQuery("'hello world' 'foo bar'");
        expect(q.terms).toEqual(['hello world', 'foo bar']);
    });

    it('handles empty @ reference', () => {
        const q = parsePluginQuery('@');
        expect(q.terms).toEqual([]);
        expect(q.authors).toEqual([]);
    });

    it('handles empty # reference', () => {
        const q = parsePluginQuery('#');
        expect(q.terms).toEqual([]);
        expect(q.tags).toEqual([]);
    });

    it('strips leading/trailing punctuation from tokens via normalizeQueryToken', () => {
        const q = parsePluginQuery('"hello," ...world!');
        expect(q.terms).toEqual(['hello', 'world']);
    });

    it('handles unicode characters in terms', () => {
        const q = parsePluginQuery('café résumé');
        expect(q.terms).toEqual(['café', 'résumé']);
    });

    it('handles @author with mixed case', () => {
        const q = parsePluginQuery('@JaneDoe');
        expect(q.authors).toEqual(['janedoe']);
    });

    it('handles #tag with mixed case', () => {
        const q = parsePluginQuery('#GitHub');
        expect(q.tags).toEqual(['github']);
    });
});

// ---------------------------------------------------------------------------
// damerauLevenshtein
// ---------------------------------------------------------------------------

describe('damerauLevenshtein', () => {
    it('returns 0 for identical strings', () => {
        expect(damerauLevenshtein('hello', 'hello')).toBe(0);
    });

    it('returns 0 for both empty strings', () => {
        expect(damerauLevenshtein('', '')).toBe(0);
    });

    it('returns the length of the non-empty string when the other is empty', () => {
        expect(damerauLevenshtein('', 'abc')).toBe(3);
        expect(damerauLevenshtein('abc', '')).toBe(3);
    });

    it('counts a single substitution', () => {
        expect(damerauLevenshtein('kitten', 'sitten')).toBe(1);
    });

    it('counts a single insertion', () => {
        expect(damerauLevenshtein('kitten', 'kittens')).toBe(1);
    });

    it('counts a single deletion', () => {
        expect(damerauLevenshtein('kitten', 'kitte')).toBe(1);
    });

    it('counts a transposition of adjacent characters', () => {
        expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    });

    it('counts multiple transpositions', () => {
        expect(damerauLevenshtein('abcd', 'badc')).toBe(2);
    });

    it('handles completely different strings', () => {
        expect(damerauLevenshtein('abc', 'xyz')).toBe(3);
    });

    it('handles unicode characters correctly', () => {
        expect(damerauLevenshtein('café', 'cafe')).toBe(1);
    });

    it('is case-sensitive', () => {
        expect(damerauLevenshtein('Hello', 'hello')).toBe(1);
    });

    it('computes distance for longer strings', () => {
        const dist = damerauLevenshtein('javascript', 'typescript');
        expect(dist).toBeGreaterThan(0);
        expect(dist).toBeLessThan(10);
    });

    it('handles null/undefined gracefully via String coercion', () => {
        expect(damerauLevenshtein(null as unknown as string, 'a')).toBe(1);
        expect(damerauLevenshtein('a', undefined as unknown as string)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// maxDistanceFor
// ---------------------------------------------------------------------------

describe('maxDistanceFor', () => {
    it.each([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 1],
        [5, 1],
        [6, 2],
        [7, 2],
        [8, 2],
        [9, 2],
        [10, 3],
        [20, 3],
        [100, 3],
    ])('returns %i for input length %i', (length, expected) => {
        expect(maxDistanceFor(length)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// bestTokenScore
// ---------------------------------------------------------------------------

describe('bestTokenScore', () => {
    it('returns 0 for empty needle', () => {
        expect(bestTokenScore('', ['hello'])).toBe(0);
    });

    it('returns 0 for empty hayTokens array', () => {
        expect(bestTokenScore('hello', [])).toBe(0);
    });

    it('returns 1 when short needle (<=3) is included in a hay token', () => {
        expect(bestTokenScore('hel', ['hello', 'world'])).toBe(1);
    });

    it('returns 0 when short needle (<=3) is not in any hay token', () => {
        expect(bestTokenScore('xyz', ['hello', 'world'])).toBe(0);
    });

    it('returns 1 for exact inclusion in longer needle', () => {
        expect(bestTokenScore('hello', ['hello', 'world'])).toBe(1);
    });

    it('returns fuzzy score for a close-but-not-exact match', () => {
        const score = bestTokenScore('helo', ['hello']);
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });

    it('returns 0 when the edit distance exceeds the maximum', () => {
        expect(bestTokenScore('xyzabc', ['hello'])).toBe(0);
    });

    it('handles punctuation in needle via normalizeQueryToken', () => {
        expect(bestTokenScore('hello!', ['hello'])).toBe(1);
    });

    it('skips empty tokens in hayTokens', () => {
        expect(bestTokenScore('hello', ['', 'hello', ''])).toBe(1);
    });

    it('returns the best score among multiple candidates', () => {
        const score = bestTokenScore('helo', ['hello', 'help']);
        expect(score).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// pluginSearchScore
// ---------------------------------------------------------------------------

describe('pluginSearchScore', () => {
    it('returns null when plugin id is empty or whitespace', () => {
        expect(pluginSearchScore(makePlugin({ id: '' }), { terms: ['test'], authors: [], tags: [] })).toBeNull();
        expect(pluginSearchScore(makePlugin({ id: '  ' }), { terms: ['test'], authors: [], tags: [] })).toBeNull();
    });

    it('returns null when plugin name is empty or whitespace', () => {
        expect(pluginSearchScore(makePlugin({ name: '' }), { terms: ['test'], authors: [], tags: [] })).toBeNull();
    });

    it('returns null when no terms match and no authors/tags are specified', () => {
        const plugin = makePlugin({ description: 'some irrelevant text' });
        expect(pluginSearchScore(plugin, { terms: ['zzzzzz'], authors: [], tags: [] })).toBeNull();
    });

    it('returns null when one of multiple terms does not match', () => {
        const plugin = makePlugin({ name: 'Hello' });
        expect(pluginSearchScore(plugin, { terms: ['hello', 'nope'], authors: [], tags: [] })).toBeNull();
    });

    it('scores a plugin matching by name', () => {
        const plugin = makePlugin({ name: 'My Amazing Plugin' });
        const score = pluginSearchScore(plugin, { terms: ['amazing'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('scores a plugin matching by id', () => {
        const plugin = makePlugin({ id: 'my-plugin', name: 'Plugin' });
        const score = pluginSearchScore(plugin, { terms: ['my-plugin'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('scores a plugin matching by author', () => {
        const plugin = makePlugin({ author: 'jane doe' });
        const score = pluginSearchScore(plugin, { terms: [], authors: ['jane'], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('returns null when author does not match', () => {
        const plugin = makePlugin({ author: 'jane' });
        expect(pluginSearchScore(plugin, { terms: [], authors: ['bob'], tags: [] })).toBeNull();
    });

    it('scores a plugin matching by tag', () => {
        const plugin = makePlugin({ tags: ['git', 'vcs'] });
        const score = pluginSearchScore(plugin, { terms: [], authors: [], tags: ['vcs'] });
        expect(score).toBeGreaterThan(0);
    });

    it('returns null when tag does not match', () => {
        const plugin = makePlugin({ tags: ['git'] });
        expect(pluginSearchScore(plugin, { terms: [], authors: [], tags: ['other'] })).toBeNull();
    });

    it('scores a plugin matching by category', () => {
        const plugin = makePlugin({ category: 'vcs' });
        const score = pluginSearchScore(plugin, { terms: ['vcs'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('scores a plugin matching by description', () => {
        const plugin = makePlugin({ description: 'version control tool' });
        const score = pluginSearchScore(plugin, { terms: ['control'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('gives higher weight to name matches than description matches', () => {
        const nameScore = pluginSearchScore(
            makePlugin({ name: 'target', description: '' }),
            { terms: ['target'], authors: [], tags: [] },
        );
        const descScore = pluginSearchScore(
            makePlugin({ name: 'plugin', description: 'target description' }),
            { terms: ['target'], authors: [], tags: [] },
        );
        expect(nameScore).toBeGreaterThan(descScore!);
    });

    it('gives higher weight to id matches than description matches', () => {
        const idScore = pluginSearchScore(
            makePlugin({ id: 'target-id', name: 'plugin' }),
            { terms: ['target-id'], authors: [], tags: [] },
        );
        const descScore = pluginSearchScore(
            makePlugin({ id: 'p', name: 'plugin', description: 'target-id description' }),
            { terms: ['target-id'], authors: [], tags: [] },
        );
        expect(idScore).toBeGreaterThan(descScore!);
    });

    it('accumulates score from matching author + tag + terms', () => {
        const plugin = makePlugin({
            name: 'Awesome',
            author: 'jane doe',
            tags: ['git'],
            description: 'version control',
        });
        const score = pluginSearchScore(plugin, {
            terms: ['awesome', 'control'],
            authors: ['jane'],
            tags: ['git'],
        });
        expect(score).toBeGreaterThan(0);
    });

    it('handles empty tags array', () => {
        const plugin = makePlugin({ tags: [] });
        const score = pluginSearchScore(plugin, { terms: ['test'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('handles missing author gracefully', () => {
        const plugin = makePlugin({ author: '' });
        const score = pluginSearchScore(plugin, { terms: ['test'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });

    it('handles undefined/null tags gracefully', () => {
        const plugin = makePlugin({ tags: undefined });
        const score = pluginSearchScore(plugin, { terms: ['test'], authors: [], tags: [] });
        expect(score).toBeGreaterThan(0);
    });
});
