import { type HeadlessState } from './state.js';
import type * as cg from './types.js';
import { type Mobility, type MobilityContext } from './types.js';
import * as util from './util.js';

const pawn: Mobility = (ctx: MobilityContext) =>
  util.diff(ctx.orig.pos[0], ctx.dest.pos[0]) <= 1 &&
  (util.diff(ctx.orig.pos[0], ctx.dest.pos[0]) === 1
    ? ctx.dest.pos[1] === ctx.orig.pos[1] + (ctx.color === 'white' ? 1 : -1)
    : util.pawnDirAdvance(...ctx.orig.pos, ...ctx.dest.pos, ctx.color === 'white'));

const knight: Mobility = (ctx: MobilityContext) => util.knightDir(...ctx.orig.pos, ...ctx.dest.pos);

const bishop: Mobility = (ctx: MobilityContext) => util.bishopDir(...ctx.orig.pos, ...ctx.dest.pos);

const rook: Mobility = (ctx: MobilityContext) => util.rookDir(...ctx.orig.pos, ...ctx.dest.pos);

const queen: Mobility = (ctx: MobilityContext) => bishop(ctx) || rook(ctx);

const king: Mobility = (ctx: MobilityContext) =>
  util.kingDirNonCastling(...ctx.orig.pos, ...ctx.dest.pos) ||
  (ctx.orig.pos[1] === ctx.dest.pos[1] &&
    ctx.orig.pos[1] === (ctx.color === 'white' ? 0 : 7) &&
    ((ctx.orig.pos[0] === 4 &&
      ((ctx.dest.pos[0] === 2 && ctx.rookFilesFriendlies.includes(0)) ||
        (ctx.dest.pos[0] === 6 && ctx.rookFilesFriendlies.includes(7)))) ||
      ctx.rookFilesFriendlies.includes(ctx.dest.pos[0])));

const mobilityByRole = { pawn, knight, bishop, rook, queen, king };

/**
 * Virtually applies a single move to a pieces map and returns a new map.
 * The moved piece is relocated and any piece on the destination square is
 * captured (overwritten). Like the rest of premove logic, this intentionally
 * ignores promotion, en-passant and castling-rights details — it only needs to
 * be good enough to compute legal destination squares for the next queued
 * premove on a hypothetical board.
 */
export function applyMoveToPieces(pieces: cg.Pieces, orig: cg.Key, dest: cg.Key): cg.Pieces {
  const piece = pieces.get(orig);
  if (!piece) return pieces;
  const entries: [cg.Key, cg.Piece][] = [];
  for (const [key, p] of pieces) if (key !== orig) entries.push([key, p]);
  entries.push([dest, piece]);
  return new Map(entries);
}

/**
 * The ordered premove list used by the current mode:
 * - `multiple` mode uses the queue.
 * - single mode mirrors the single `current` as a one-element list.
 */
export function premoveItems(state: HeadlessState): cg.Premove[] {
  if (state.premovable.multiple) return state.premovable.queue;
  const cur = state.premovable.current;
  return cur ? [{ orig: cur[0], dest: cur[1] }] : [];
}

/**
 * Returns the index of the queued item that should be edited/replaced when the
 * user re-drags the piece currently displayed on `key`.
 *
 * Priority:
 * 1. If `key` is an origin of a queued item, that item is edited (the chain
 *    continues from that stage's start, replacing the item and everything after).
 * 2. Otherwise, if `key` is the destination of an item, the item that placed the
 *    piece there is edited (this is the chess.com-style "drag the premoved piece
 *    again to reroute it" gesture).
 * 3. In single mode, a destination matches the single premove.
 */
export function premoveRerouteIndex(state: HeadlessState, key: cg.Key): number | undefined {
  if (state.premovable.multiple) {
    const queue = state.premovable.queue;
    const byOrig = queue.findIndex(item => item.orig === key);
    if (byOrig !== -1) return byOrig;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].dest === key) return i;
    return undefined;
  }
  return state.premovable.current?.[1] === key && state.premovable.current?.[0] !== key ? 0 : undefined;
}

function applyItems(pieces: cg.Pieces, items: cg.Premove[]): cg.Pieces {
  let result = pieces;
  for (const item of items) result = applyMoveToPieces(result, item.orig, item.dest);
  return result;
}

/**
 * The board shown to the user while premoves are queued: the real board with
 * every queued premove applied on top. When `showMovedPieces` is disabled this
 * returns the real board (legacy highlight-only rendering).
 *
 * The real `state.pieces` is never mutated by this function; it is only a
 * rendering/interaction overlay.
 */
export function visiblePieces(state: HeadlessState): cg.Pieces {
  if (!state.premovable.showMovedPieces) return state.pieces;
  const items = premoveItems(state);
  if (!items.length) return state.pieces;
  return applyItems(state.pieces, items);
}

/**
 * The pieces map that should be used to compute premove destinations for `orig`:
 * the real board with the queued premoves already applied on top.
 *
 * When `orig` is an origin already used by an earlier queued item, re-queueing
 * from it replaces that item and everything queued after it, so the hypothetical
 * board only applies the items before that one. When `orig` is the destination
 * of an item (the piece is being re-dragged to reroute that move), the board
 * applies items through that item so the piece is visible on `orig`.
 */
export function premovePieces(state: HeadlessState, orig?: cg.Key): cg.Pieces {
  const items = premoveItems(state);
  if (!items.length) return state.pieces;
  if (orig === undefined) return applyItems(state.pieces, items);
  const idx = premoveRerouteIndex(state, orig);
  if (idx === undefined) return applyItems(state.pieces, items);
  if (state.premovable.multiple) {
    const byOrig = state.premovable.queue.findIndex(item => item.orig === orig);
    if (byOrig !== -1) return applyItems(state.pieces, state.premovable.queue.slice(0, byOrig));
    // Destination-based reroute: the piece is on `orig` after the item at `idx`
    // has been applied, so include that item (and stop before later items).
    return applyItems(state.pieces, state.premovable.queue.slice(0, idx + 1));
  }
  // Single mode reroute: the premove is already applied on the visible board.
  return applyItems(state.pieces, items);
}

function premoveFromState(state: HeadlessState, pieces: cg.Pieces, key: cg.Key): cg.Key[] {
  const piece = pieces.get(key);
  if (!piece || piece.color === state.turnColor) return [];
  const color = piece.color,
    friendlies = new Map([...pieces].filter(([_, p]) => p.color === color)),
    enemies = new Map([...pieces].filter(([_, p]) => p.color === util.opposite(color))),
    orig = { key, pos: util.key2pos(key) },
    mobility: Mobility = (ctx: MobilityContext) =>
      mobilityByRole[piece.role](ctx) && state.premovable.additionalPremoveRequirements(ctx),
    partialCtx = {
      orig,
      role: piece.role,
      allPieces: pieces,
      friendlies,
      enemies,
      color,
      rookFilesFriendlies: Array.from(pieces)
        .filter(
          ([k, p]) => k[1] === (color === 'white' ? '1' : '8') && p.color === color && p.role === 'rook',
        )
        .map(([k]) => util.key2pos(k)[0]),
      lastMove: state.lastMove,
    };
  // todo - remove more properties from MobilityContext that aren't used in this file, and adjust as needed in lila.
  return util.allPosAndKey.filter(dest => mobility({ ...partialCtx, dest })).map(pk => pk.key);
}

export function premove(state: HeadlessState, key: cg.Key): cg.Key[] {
  return premoveFromState(state, premovePieces(state, key), key);
}
