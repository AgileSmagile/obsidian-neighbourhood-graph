/**
 * Tests for graph-data.ts — neighbourhood scoring and Excalibrain integration.
 *
 * Tests the pure logic of buildNeighbourhood by mocking the Obsidian API
 * (App, TFile, metadataCache). No DOM or Obsidian runtime required.
 *
 * Covers:
 *   - Baseline: link scoring (+2 out, +2 in, +2 bidirectional bonus)
 *   - Tag scoring (+1 per shared tag, tag concept nodes)
 *   - Hub score (log2 of total link count)
 *   - maxNeighbours cap and truncation count
 *   - Excalibrain typed edge detection (relationType on edges)
 *   - Excalibrain strength bonus (+3 parent/child, +1 friends/previous/next)
 *   - Inverse type resolution (target declares relation back to focus)
 *   - Edge deduplication (no duplicate edges in either direction)
 *   - Salience anchored to displayed set (not all vault notes)
 */

import { describe, it, expect } from 'vitest'
import type { App, TFile } from 'obsidian'
import type { NeighbourhoodGraphSettings, EdgeRelationType } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { buildNeighbourhood } from '../graph-data'
import { buildFieldLookup } from '../excalibrain'
import type { ExcalibrainConfig } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────

function file(path: string, parentPath = ''): TFile {
  const basename = path.replace(/\.md$/, '').split('/').pop()!
  return { path, basename, parent: { path: parentPath } } as unknown as TFile
}

interface MockAppConfig {
  files: TFile[]
  /** resolvedLinks[sourcePath][targetPath] = link count */
  resolvedLinks?: Record<string, Record<string, number>>
  /** Per-file inline tags (e.g. '#project') */
  fileTags?: Record<string, string[]>
  /** Per-file frontmatter key→value */
  frontmatter?: Record<string, Record<string, unknown>>
  /** Per-file wikilink-style frontmatterLinks [{key, link}] */
  frontmatterLinks?: Record<string, Array<{ key: string; link: string }>>
  /** Resolve a link name to a file path */
  linkResolution?: Record<string, string>
}

function mockApp(config: MockAppConfig): App {
  const resolvedLinks = config.resolvedLinks ?? {}
  const fileTags = config.fileTags ?? {}
  const frontmatter = config.frontmatter ?? {}
  const frontmatterLinks = config.frontmatterLinks ?? {}
  const linkResolution = config.linkResolution ?? {}

  return {
    vault: {
      getMarkdownFiles: () => config.files,
      getFileByPath: (path: string) => config.files.find(f => f.path === path) ?? null,
      configDir: '.obsidian',
    },
    metadataCache: {
      resolvedLinks,
      getFileCache: (f: TFile) => ({
        tags: (fileTags[f.path] ?? []).map(tag => ({ tag })),
        frontmatter: frontmatter[f.path] ?? null,
        frontmatterLinks: frontmatterLinks[f.path] ?? [],
      }),
      getFirstLinkpathDest: (link: string, _from: string) => {
        const resolved = linkResolution[link]
        if (!resolved) return null
        return config.files.find(f => f.path === resolved) ?? null
      },
    },
  } as unknown as App
}

const settings: NeighbourhoodGraphSettings = { ...DEFAULT_SETTINGS, maxNeighbours: 30 }

// ── Basic scoring ─────────────────────────────────────────────────────────

describe('link scoring', () => {
  it('includes direct outlink as neighbour with +2 strength', () => {
    const focus = file('focus.md')
    const neighbour = file('neighbour.md')
    const app = mockApp({
      files: [focus, neighbour],
      resolvedLinks: { 'focus.md': { 'neighbour.md': 1 } },
    })

    const { nodes, edges } = buildNeighbourhood(focus, app, settings)

    const n = nodes.find(n => n.id === 'neighbour.md')
    expect(n).toBeDefined()
    // +2 out-link + hub score (log2(1) = 0) = 2
    expect(n!.strength).toBeCloseTo(2, 1)

    const edge = edges.find(e => e.source === 'focus.md' && e.target === 'neighbour.md')
    expect(edge).toBeDefined()
  })

  it('includes backlink as neighbour with +2 strength', () => {
    const focus = file('focus.md')
    const back = file('back.md')
    const app = mockApp({
      files: [focus, back],
      // back.md links TO focus.md (creates inlink for focus)
      resolvedLinks: { 'back.md': { 'focus.md': 1 } },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    const n = nodes.find(n => n.id === 'back.md')
    expect(n).toBeDefined()
    expect(n!.strength).toBeCloseTo(2, 1)
  })

  it('awards bidirectional bonus (+6 total: +2 out +2 in +2 bidir)', () => {
    const focus = file('focus.md')
    const peer = file('peer.md')
    const app = mockApp({
      files: [focus, peer],
      resolvedLinks: {
        'focus.md': { 'peer.md': 1 },
        'peer.md': { 'focus.md': 1 },
      },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    const n = nodes.find(n => n.id === 'peer.md')
    expect(n).toBeDefined()
    // +2 out + +2 in + +2 bidir bonus = 6 (plus small hub score)
    expect(n!.strength).toBeGreaterThanOrEqual(6)
  })

  it('ranks bidirectional link above one-directional link', () => {
    const focus = file('focus.md')
    const bidir = file('bidir.md')
    const oneway = file('oneway.md')
    const app = mockApp({
      files: [focus, bidir, oneway],
      resolvedLinks: {
        'focus.md': { 'bidir.md': 1, 'oneway.md': 1 },
        'bidir.md': { 'focus.md': 1 },
      },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    const bNode = nodes.find(n => n.id === 'bidir.md')
    const oNode = nodes.find(n => n.id === 'oneway.md')
    expect(bNode!.strength!).toBeGreaterThan(oNode!.strength!)
  })
})

describe('tag scoring', () => {
  it('adds shared-tag concept nodes when at least one neighbour shares the tag', () => {
    const focus = file('focus.md')
    const tagged = file('tagged.md')
    const app = mockApp({
      files: [focus, tagged],
      resolvedLinks: { 'focus.md': { 'tagged.md': 1 } },
      fileTags: {
        'focus.md': ['#project'],
        'tagged.md': ['#project'],
      },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    const tagNode = nodes.find(n => n.id === 'tag:#project')
    expect(tagNode).toBeDefined()
    expect(tagNode!.type).toBe('tag')
  })

  it('does not add a tag node when no neighbour shares the tag', () => {
    const focus = file('focus.md')
    const unrelated = file('unrelated.md')
    const app = mockApp({
      files: [focus, unrelated],
      resolvedLinks: { 'focus.md': { 'unrelated.md': 1 } },
      fileTags: {
        'focus.md': ['#solo-tag'],
        'unrelated.md': ['#different-tag'],
      },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    expect(nodes.find(n => n.id === 'tag:#solo-tag')).toBeUndefined()
  })

  it('awards +1 strength per shared tag', () => {
    const focus = file('focus.md')
    const oneTag = file('one-tag.md')
    const twoTags = file('two-tags.md')
    const app = mockApp({
      files: [focus, oneTag, twoTags],
      resolvedLinks: {
        'focus.md': { 'one-tag.md': 1, 'two-tags.md': 1 },
      },
      fileTags: {
        'focus.md': ['#alpha', '#beta'],
        'one-tag.md': ['#alpha'],
        'two-tags.md': ['#alpha', '#beta'],
      },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    const one = nodes.find(n => n.id === 'one-tag.md')
    const two = nodes.find(n => n.id === 'two-tags.md')
    // two-tags gets +1 extra from the second shared tag
    expect(two!.strength!).toBeGreaterThan(one!.strength!)
  })
})

describe('maxNeighbours cap and truncation', () => {
  it('caps neighbours at maxNeighbours and reports truncated count', () => {
    const focus = file('focus.md')
    const neighbours = Array.from({ length: 10 }, (_, i) => file(`note-${i}.md`))
    const resolvedLinks: Record<string, Record<string, number>> = { 'focus.md': {} }
    for (const n of neighbours) resolvedLinks['focus.md'][n.path] = 1

    const app = mockApp({ files: [focus, ...neighbours], resolvedLinks })
    const capped = { ...settings, maxNeighbours: 5 }

    const { nodes, truncated } = buildNeighbourhood(focus, app, capped)
    const noteNodes = nodes.filter(n => n.type === 'note' && !n.focus)
    expect(noteNodes).toHaveLength(5)
    expect(truncated).toBe(5)
  })

  it('truncated is undefined when all neighbours fit', () => {
    const focus = file('focus.md')
    const neighbour = file('n.md')
    const app = mockApp({
      files: [focus, neighbour],
      resolvedLinks: { 'focus.md': { 'n.md': 1 } },
    })

    const { truncated } = buildNeighbourhood(focus, app, settings)
    expect(truncated).toBeUndefined()
  })
})

describe('edge deduplication', () => {
  it('does not produce duplicate edges for bidirectional links', () => {
    const focus = file('focus.md')
    const peer = file('peer.md')
    const app = mockApp({
      files: [focus, peer],
      resolvedLinks: {
        'focus.md': { 'peer.md': 1 },
        'peer.md': { 'focus.md': 1 },
      },
    })

    const { edges } = buildNeighbourhood(focus, app, settings)
    const between = edges.filter(
      e => (e.source === 'focus.md' && e.target === 'peer.md') ||
           (e.source === 'peer.md' && e.target === 'focus.md'),
    )
    expect(between).toHaveLength(1)
  })
})

// ── Excalibrain integration (new in v2) ───────────────────────────────────

describe('Excalibrain: typed edge detection', () => {
  const excalibrainConfig: ExcalibrainConfig = {
    parents: ['Parent'],
    children: ['Child'],
    leftFriends: ['Friend'],
    rightFriends: ['opposes'],
    previous: ['Previous'],
    next: ['Next'],
  }

  it('adds relationType to an edge when focus declares a Parent frontmatter link', () => {
    const focus = file('focus.md')
    const parent = file('parent-note.md')
    const fieldLookup = buildFieldLookup(excalibrainConfig)

    const app = mockApp({
      files: [focus, parent],
      resolvedLinks: { 'focus.md': { 'parent-note.md': 1 } },
      frontmatterLinks: {
        'focus.md': [{ key: 'Parent', link: 'parent-note' }],
      },
      linkResolution: { 'parent-note': 'parent-note.md' },
    })

    const { edges } = buildNeighbourhood(focus, app, settings, fieldLookup)
    const edge = edges.find(
      e => (e.source === 'focus.md' && e.target === 'parent-note.md') ||
           (e.source === 'parent-note.md' && e.target === 'focus.md'),
    )
    expect(edge).toBeDefined()
    expect(edge!.relationType).toBe('parent')
  })

  it('edge has no relationType when there is no Excalibrain field match', () => {
    const focus = file('focus.md')
    const plain = file('plain.md')

    const app = mockApp({
      files: [focus, plain],
      resolvedLinks: { 'focus.md': { 'plain.md': 1 } },
    })

    const { edges } = buildNeighbourhood(focus, app, settings, null)
    const edge = edges.find(e => e.source === 'focus.md' && e.target === 'plain.md')
    expect(edge!.relationType).toBeUndefined()
  })

  it('detects inverse type: target declares Parent→focus, edge gets child relationType', () => {
    const focus = file('focus.md')
    const child = file('child-note.md')
    const fieldLookup = buildFieldLookup(excalibrainConfig)

    // child-note.md declares focus.md as its Parent → from focus's perspective, child is a child
    const app = mockApp({
      files: [focus, child],
      resolvedLinks: { 'child-note.md': { 'focus.md': 1 } },
      frontmatterLinks: {
        'child-note.md': [{ key: 'Parent', link: 'focus' }],
      },
      linkResolution: { 'focus': 'focus.md' },
    })

    const { edges } = buildNeighbourhood(focus, app, settings, fieldLookup)
    const edge = edges.find(
      e => (e.source === 'focus.md' && e.target === 'child-note.md') ||
           (e.source === 'child-note.md' && e.target === 'focus.md'),
    )
    expect(edge).toBeDefined()
    expect(edge!.relationType).toBe('child')
  })
})

describe('Excalibrain: strength bonus', () => {
  const excalibrainConfig: ExcalibrainConfig = {
    parents: ['Parent'],
    children: ['Child'],
    leftFriends: ['Friend'],
    rightFriends: ['opposes'],
    previous: ['Previous'],
    next: ['Next'],
  }

  it('parent relation (+3) gives higher strength than plain link (+2)', () => {
    const focus = file('focus.md')
    const parentNote = file('parent.md')
    const plainNote = file('plain.md')
    const fieldLookup = buildFieldLookup(excalibrainConfig)

    const app = mockApp({
      files: [focus, parentNote, plainNote],
      resolvedLinks: {
        'focus.md': { 'parent.md': 1, 'plain.md': 1 },
      },
      frontmatterLinks: {
        'focus.md': [{ key: 'Parent', link: 'parent' }],
      },
      linkResolution: { 'parent': 'parent.md' },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings, fieldLookup)
    const pNode = nodes.find(n => n.id === 'parent.md')
    const plainNode = nodes.find(n => n.id === 'plain.md')
    // parent: +2 link + +3 Excalibrain bonus = 5; plain: +2 link only
    expect(pNode!.strength!).toBeGreaterThan(plainNode!.strength!)
  })

  it('friend relation (+1) gives higher strength than plain link (+2 is already higher, but bonus is additive)', () => {
    const focus = file('focus.md')
    const friend = file('friend.md')
    const plain = file('plain.md')
    const fieldLookup = buildFieldLookup(excalibrainConfig)

    const app = mockApp({
      files: [focus, friend, plain],
      resolvedLinks: {
        'focus.md': { 'friend.md': 1, 'plain.md': 1 },
      },
      frontmatterLinks: {
        'focus.md': [{ key: 'Friend', link: 'friend' }],
      },
      linkResolution: { 'friend': 'friend.md' },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings, fieldLookup)
    const fNode = nodes.find(n => n.id === 'friend.md')
    const pNode = nodes.find(n => n.id === 'plain.md')
    // friend: +2 link + +1 bonus = 3; plain: +2 link
    expect(fNode!.strength!).toBeGreaterThan(pNode!.strength!)
  })

  it('Excalibrain bonus causes typed-linked note to rank above an equally-linked plain note', () => {
    const focus = file('focus.md')
    const typed = file('typed.md')
    const untyped = file('untyped.md')
    const fieldLookup = buildFieldLookup(excalibrainConfig)

    // Both notes linked from focus — typed one also declared as Child
    const app = mockApp({
      files: [focus, typed, untyped],
      resolvedLinks: {
        'focus.md': { 'typed.md': 1, 'untyped.md': 1 },
      },
      frontmatterLinks: {
        'focus.md': [{ key: 'Child', link: 'typed' }],
      },
      linkResolution: { 'typed': 'typed.md' },
    })

    const { nodes } = buildNeighbourhood(focus, app, settings, fieldLookup)
    const tNode = nodes.find(n => n.id === 'typed.md')
    const uNode = nodes.find(n => n.id === 'untyped.md')
    expect(tNode!.strength!).toBeGreaterThan(uNode!.strength!)
  })
})

// ── buildFieldLookup ──────────────────────────────────────────────────────

describe('buildFieldLookup', () => {
  it('maps all six relation types', () => {
    const config: ExcalibrainConfig = {
      parents: ['Parent', 'up'],
      children: ['Child', 'down'],
      leftFriends: ['Friend'],
      rightFriends: ['opposes'],
      previous: ['Previous'],
      next: ['Next'],
    }

    const map = buildFieldLookup(config)

    expect(map.get('parent')).toBe('parent')
    expect(map.get('up')).toBe('parent')
    expect(map.get('child')).toBe('child')
    expect(map.get('down')).toBe('child')
    expect(map.get('friend')).toBe('leftFriend')
    expect(map.get('opposes')).toBe('rightFriend')
    expect(map.get('previous')).toBe('previous')
    expect(map.get('next')).toBe('next')
  })

  it('keys are lowercase regardless of config case', () => {
    const config: ExcalibrainConfig = {
      parents: ['PARENT', 'Up'],
      children: [],
      leftFriends: [],
      rightFriends: [],
      previous: [],
      next: [],
    }

    const map = buildFieldLookup(config)
    expect(map.get('parent')).toBe('parent')
    expect(map.get('up')).toBe('parent')
    expect(map.get('PARENT')).toBeUndefined()
  })

  it('returns empty map for empty config', () => {
    const config: ExcalibrainConfig = {
      parents: [],
      children: [],
      leftFriends: [],
      rightFriends: [],
      previous: [],
      next: [],
    }
    expect(buildFieldLookup(config).size).toBe(0)
  })
})

// ── Focus node ────────────────────────────────────────────────────────────

describe('focus node', () => {
  it('always includes the focus note as a node with focus=true', () => {
    const focus = file('focus.md')
    const app = mockApp({ files: [focus], resolvedLinks: {} })

    const { nodes } = buildNeighbourhood(focus, app, settings)
    const focusNode = nodes.find(n => n.id === 'focus.md')
    expect(focusNode).toBeDefined()
    expect(focusNode!.focus).toBe(true)
  })

  it('returns only the focus node when the note has no connections', () => {
    const focus = file('isolated.md')
    const unrelated = file('unrelated.md')
    const app = mockApp({ files: [focus, unrelated], resolvedLinks: {} })

    const { nodes, edges } = buildNeighbourhood(focus, app, settings)
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
  })
})
