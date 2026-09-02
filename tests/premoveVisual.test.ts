import { Chessground } from '../src/chessground';
import type * as cg from '../src/types';

const rect = { top: 0, left: 0, width: 400, height: 400, right: 400, bottom: 400 };
type RfCb = FrameRequestCallback;
const queue: RfCb[] = [];

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
  (window as any).requestAnimationFrame = (cb: RfCb) => (queue.push(cb), queue.length);
});

function flushFrames(max = 50) {
  let n = 0;
  while (queue.length && n++ < max) {
    const cb = queue.shift()!;
    cb(0);
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
});

const centerOf = (key: cg.Key): cg.NumberPair => {
  const [f, r] = [key.charCodeAt(0) - 97, key.charCodeAt(1) - 49];
  return [((f + 0.5) * 400) / 8, ((7 - r + 0.5) * 400) / 8];
};

const makeBoard = (config: Record<string, any>) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.className = 'cg-wrap';
  return Chessground(el as any, config);
};

const mdoc = (type: string, clientX: number, clientY: number, init: Partial<MouseEventInit> = {}) =>
  new MouseEvent(type, {
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
    isTrusted: true,
    ...init,
  } as MouseEventInit);

const click = (key: cg.Key) => {
  const [x, y] = centerOf(key);
  const b = document.querySelector('cg-board')!;
  b.dispatchEvent(mdoc('mousedown', x, y));
  document.dispatchEvent(mdoc('mouseup', x, y));
};

const drag = (orig: cg.Key, dest: cg.Key, init: Partial<MouseEventInit> = {}) => {
  const [x0, y0] = centerOf(orig);
  const [x1, y1] = centerOf(dest);
  const b = document.querySelector('cg-board')!;
  b.dispatchEvent(mdoc('mousedown', x0, y0));
  document.dispatchEvent(mdoc('mousemove', x1, y1, init));
  flushFrames();
  document.dispatchEvent(mdoc('mouseup', x1, y1, init));
  flushFrames();
};

const pieceKeys = (ground: ReturnType<typeof Chessground>): string[] =>
  Array.from(ground.state.dom.elements.board.querySelectorAll('piece'))
    .map(el => (el as any).cgKey)
    .sort();

const squareClasses = (ground: ReturnType<typeof Chessground>, key: cg.Key): string[] => {
  const sq = Array.from(ground.state.dom.elements.board.querySelectorAll('square')).find(
    el => (el as any).cgKey === key,
  );
  return sq ? Array.from(sq.classList) : [];
};

const BOARD_FEN = '8/8/8/4k3/8/8/4P3/4K1N1 w - - 0 1'; // e2 pawn, g1 knight, e5 black king

test('single premove renders the piece at its destination and hides its origin', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: false, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  ground.state.dom.redrawNow();

  expect(ground.state.premovable.current).toEqual(['e2', 'e4']);
  expect(pieceKeys(ground)).toContain('e4');
  expect(pieceKeys(ground)).not.toContain('e2');
  expect(squareClasses(ground, 'e4')).toEqual(expect.arrayContaining(['current-premove', 'premove-dest']));
  // The real FEN must stay untouched while the premove is only queued.
  expect(ground.getFen()).toBe('8/8/8/4k3/8/8/4P3/4K1N1');
});

test('multi-premove renders every stage at its queued destination', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: true, maxQueueLength: 5, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  click('g1');
  click('f3');
  ground.state.dom.redrawNow();

  const keys = pieceKeys(ground);
  expect(keys).toContain('e4');
  expect(keys).toContain('f3');
  expect(keys).not.toContain('e2');
  expect(keys).not.toContain('g1');
  expect(squareClasses(ground, 'e4')).toEqual(expect.arrayContaining(['premove-queue-1', 'premove-dest']));
  expect(squareClasses(ground, 'f3')).toEqual(expect.arrayContaining(['premove-queue-2', 'premove-dest']));
});

test('re-dragging the displayed premove piece reroutes a single premove', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: false, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  ground.state.dom.redrawNow();
  drag('e4', 'e5');
  ground.state.dom.redrawNow();

  expect(ground.state.premovable.current).toEqual(['e2', 'e5']);
  expect(pieceKeys(ground)).toContain('e5');
  expect(pieceKeys(ground)).not.toContain('e4');
  expect(pieceKeys(ground)).not.toContain('e2');
});

test('re-dragging a later multi-premove stage reroutes only that stage', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: true, maxQueueLength: 5, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  click('g1');
  click('f3');
  ground.state.dom.redrawNow();
  drag('f3', 'h2');
  ground.state.dom.redrawNow();

  expect(ground.state.premovable.queue).toEqual([
    { orig: 'e2', dest: 'e4' },
    { orig: 'g1', dest: 'h2' },
  ]);
  expect(pieceKeys(ground)).toContain('e4');
  expect(pieceKeys(ground)).toContain('h2');
  expect(pieceKeys(ground)).not.toContain('f3');
});

test('clicking the displayed premove piece then a new square reroutes it', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: false, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  ground.state.dom.redrawNow();
  click('e4');
  click('e5');
  ground.state.dom.redrawNow();

  expect(ground.state.premovable.current).toEqual(['e2', 'e5']);
  expect(pieceKeys(ground)).toContain('e5');
  expect(pieceKeys(ground)).not.toContain('e4');
  expect(pieceKeys(ground)).not.toContain('e2');
});

test('Ctrl/Shift-drag from a queued destination appends a chain stage', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: true, maxQueueLength: 5, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  ground.state.dom.redrawNow();
  drag('e4', 'e5', { ctrlKey: true });
  ground.state.dom.redrawNow();

  expect(ground.state.premovable.queue).toEqual([
    { orig: 'e2', dest: 'e4' },
    { orig: 'e4', dest: 'e5' },
  ]);
});

test('cancelling a single premove restores the original board rendering', () => {
  const ground = makeBoard({
    fen: BOARD_FEN,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: false, showDests: true },
    trustAllEvents: true,
  });
  click('e2');
  click('e4');
  expect(ground.state.premovable.current).toEqual(['e2', 'e4']);

  ground.cancelPremove();
  ground.state.dom.redrawNow();

  expect(ground.state.premovable.current).toBeUndefined();
  expect(pieceKeys(ground)).toContain('e2');
  expect(pieceKeys(ground)).not.toContain('e4');
});
