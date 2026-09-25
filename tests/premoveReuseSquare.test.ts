import { Chessground } from '../src/chessground';
import * as board from '../src/board';
import { fullPremovePieces } from '../src/premove';
import { stageAt } from '../src/premovePieces';
import { defaults, type HeadlessState } from '../src/state';
import type * as cg from '../src/types';

// Regression: a square that was already used as the *origin* of an earlier
// queued item (the knight leaving h4) gets re-occupied by a different piece
// later in the chain (the queen landing on h4). Premoving that second piece
// off the square must extend the chain, not truncate back to the knight's hop.
//   ...Nf5 ...Nh4 ...Nf3+ ...Qh4 ...Qxh2#

const rect = { top: 0, left: 0, width: 400, height: 400, right: 400, bottom: 400 };
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
});
beforeEach(() => {
  document.body.innerHTML = '';
});

const makeState = (): HeadlessState => {
  const state = defaults();
  state.pieces = new Map<cg.Key, cg.Piece>([
    ['e7', { role: 'knight', color: 'black' }],
    ['d8', { role: 'queen', color: 'black' }],
    ['g8', { role: 'king', color: 'black' }],
    ['g1', { role: 'king', color: 'white' }],
    ['h2', { role: 'pawn', color: 'white' }],
  ]);
  state.turnColor = 'white';
  state.movable.color = 'black';
  state.premovable.multiple = true;
  state.premovable.maxQueueLength = 10;
  return state;
};

const CHAIN: [cg.Key, cg.Key][] = [
  ['e7', 'f5'],
  ['f5', 'h4'],
  ['h4', 'f3'],
  ['d8', 'h4'],
  ['h4', 'h2'],
];

test('premoving a piece off a square that an earlier item already left extends the chain', () => {
  const state = makeState();
  for (const [o, d] of CHAIN) expect(board.userMove(state, o, d)).toBe(true);
  expect(state.premovable.queue).toEqual(CHAIN.map(([orig, dest]) => ({ orig, dest })));
  const v = fullPremovePieces(state);
  expect(v.get('h2')).toEqual({ role: 'queen', color: 'black' });
  expect(v.get('f3')).toEqual({ role: 'knight', color: 'black' });
  expect(v.has('h4')).toBe(false);
});

test('re-routing the latest arrival on a reused square only replaces from its own hop', () => {
  const state = makeState();
  for (const [o, d] of CHAIN) board.userMove(state, o, d);
  // The queen is now virtually on h2; moving the *knight* again from f3 is a
  // plain extension, and re-routing the original knight square e7 truncates all.
  expect(board.userMove(state, 'f3', 'g5')).toBe(true);
  expect(state.premovable.queue).toHaveLength(6);
  expect(board.userMove(state, 'e7', 'g6')).toBe(true);
  expect(state.premovable.queue).toEqual([{ orig: 'e7', dest: 'g6' }]);
});

test('stageAt / virtual layer resolve a reused square to its latest occupant', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ground = Chessground(el as any, {
    fen: '3q2k1/4n3/8/8/8/8/7P/6K1 w - - 0 1',
    turnColor: 'white',
    movable: { color: 'black', dests: new Map() },
    premovable: { enabled: true, multiple: true },
  });
  for (const [o, d] of CHAIN.slice(0, 4)) board.userMove(ground.state, o, d);
  ground.redrawAll();
  // h4 is first the knight's (stage 1, superseded) then the queen's (stage 3).
  expect(stageAt(ground.state, 'h4')).toBe(3);
  const nodes = [...el.querySelectorAll('.premove-piece')] as cg.PieceNode[];
  const byKey = nodes.map(n => `${n.cgKey}:${n.cgPiece}`).sort();
  expect(byKey).toEqual(['f3:black knight', 'h4:black queen']);
});

test('a same-role piece capturing its own piece still gets a virtual node', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ground = Chessground(el as any, {
    fen: '4k3/8/8/8/8/8/R7/R3K3 b - - 0 1',
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: true },
  });
  // Defensive premove: Ra1xa2 expecting the opponent to take on a2 first.
  ground.state.premovable.queue = [{ orig: 'a1', dest: 'a2' }];
  ground.redrawAll();
  const nodes = [...el.querySelectorAll('.premove-piece')] as cg.PieceNode[];
  expect(nodes.map(n => n.cgKey)).toEqual(['a2']);
  expect(stageAt(ground.state, 'a2')).toBe(0);
});
