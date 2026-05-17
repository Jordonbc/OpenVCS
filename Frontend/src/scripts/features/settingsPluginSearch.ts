// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PluginSummary } from '../plugins';

/** Parsed plugin search query with terms, authors, and tags. */
export interface ParsedPluginQuery {
    terms: string[];
    authors: string[];
    tags: string[];
}

/** Tokenizes a string into lowercase alphanumeric fragments. */
function tokenize(value: string): string[] {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9._-]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Normalizes a query token by trimming, lowercasing, and stripping leading/trailing punctuation. */
function normalizeQueryToken(value: string): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^[,.;:!?]+/g, '')
        .replace(/[,.;:!?]+$/g, '');
}

/** Parses a raw search string into a {@link ParsedPluginQuery} with terms, @authors, and #tags. */
export function parsePluginQuery(raw: string): ParsedPluginQuery {
    const parsed: ParsedPluginQuery = { terms: [], authors: [], tags: [] };
    const input = String(raw || '').trim();
    if (!input) return parsed;

    const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
    for (const match of input.matchAll(re)) {
        const token = normalizeQueryToken(match[1] ?? match[2] ?? match[3] ?? '');
        if (!token) continue;
        if (token.startsWith('@')) {
            const author = normalizeQueryToken(token.slice(1));
            if (author) parsed.authors.push(author);
            continue;
        }
        if (token.startsWith('#')) {
            const tag = normalizeQueryToken(token.slice(1));
            if (tag) parsed.tags.push(tag);
            continue;
        }
        parsed.terms.push(token);
    }
    return parsed;
}

/** Computes the Damerau-Levenshtein distance between two strings (capped at 64 chars). */
export function damerauLevenshtein(aRaw: string, bRaw: string): number {
    const a = String(aRaw || '');
    const b = String(bRaw || '');
    if (a === b) return 0;
    const aLen = a.length;
    const bLen = b.length;
    if (!aLen) return bLen;
    if (!bLen) return aLen;

    const da: Record<string, number> = {};
    const maxDist = aLen + bLen;
    const score: number[][] = Array.from({ length: aLen + 2 }, () => new Array(bLen + 2).fill(0));
    score[0][0] = maxDist;
    for (let i = 0; i <= aLen; i++) {
        score[i + 1][0] = maxDist;
        score[i + 1][1] = i;
    }
    for (let j = 0; j <= bLen; j++) {
        score[0][j + 1] = maxDist;
        score[1][j + 1] = j;
    }

    for (let i = 1; i <= aLen; i++) {
        let db = 0;
        for (let j = 1; j <= bLen; j++) {
            const i1 = da[b[j - 1]] ?? 0;
            const j1 = db;
            let cost = 1;
            if (a[i - 1] === b[j - 1]) {
                cost = 0;
                db = j;
            }

            score[i + 1][j + 1] = Math.min(
                score[i][j] + cost, // substitution
                score[i + 1][j] + 1, // insertion
                score[i][j + 1] + 1, // deletion
                score[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1), // transposition
            );
        }
        da[a[i - 1]] = i;
    }
    return score[aLen + 1][bLen + 1];
}

/** Returns the max allowed edit distance for a given string length. */
export function maxDistanceFor(len: number): number {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    return 3;
}

/** Scores a single token against a set of tokens using inclusion and fuzzy matching. */
export function bestTokenScore(needleRaw: string, hayTokens: string[]): number {
    const needle = normalizeQueryToken(needleRaw);
    if (!needle) return 0;
    if (!hayTokens.length) return 0;
    if (needle.length <= 3) {
        for (const tok of hayTokens) {
            if (tok.includes(needle)) return 1;
        }
        return 0;
    }

    let best = 0;
    for (const tok of hayTokens) {
        if (!tok) continue;
        if (tok.includes(needle)) return 1;
        const maxLen = Math.max(needle.length, tok.length);
        const maxDist = maxDistanceFor(Math.min(maxLen, 64));
        if (maxDist <= 0) continue;
        const dist = damerauLevenshtein(needle.slice(0, 64), tok.slice(0, 64));
        if (dist > maxDist) continue;
        const sim = 1 - dist / maxLen;
        if (sim > best) best = sim;
    }
    return best;
}

/** Scores a plugin against a parsed query. Returns null if the plugin does not match. */
export function pluginSearchScore(plugin: PluginSummary, parsed: ParsedPluginQuery): number | null {
    const id = String(plugin?.id || '').trim();
    const name = String(plugin?.name || '').trim();
    if (!id || !name) return null;

    const author = String(plugin?.author || '').trim();
    const category = String(plugin?.category || '').trim();
    const description = String(plugin?.description || '').trim();
    const tags = Array.isArray(plugin?.tags) ? plugin.tags.map((t) => String(t || '').trim()).filter(Boolean) : [];

    const authorTokens = tokenize(author);
    const tagTokens = tags.flatMap((t) => tokenize(t));
    const fields: Array<{ weight: number; tokens: string[] }> = [
        { weight: 3.6, tokens: tokenize(name) },
        { weight: 3.0, tokens: tokenize(id) },
        { weight: 2.2, tokens: authorTokens },
        { weight: 2.0, tokens: tagTokens },
        { weight: 1.6, tokens: tokenize(category) },
        { weight: 1.0, tokens: tokenize(description) },
    ];

    let score = 0;

    for (const qAuthor of parsed.authors) {
        const s = bestTokenScore(qAuthor, authorTokens);
        if (!s) return null;
        score += s * 4.0;
    }

    for (const qTag of parsed.tags) {
        const s = bestTokenScore(qTag, tagTokens);
        if (!s) return null;
        score += s * 3.0;
    }

    for (const term of parsed.terms) {
        let best = 0;
        for (const field of fields) {
            const s = bestTokenScore(term, field.tokens);
            if (!s) continue;
            const weighted = s * field.weight;
            if (weighted > best) best = weighted;
        }
        if (!best) return null;
        score += best;
    }

    return score;
}
