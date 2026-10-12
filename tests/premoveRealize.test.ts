import { vi } from 'vitest';
import { Chessground } from '../src/chessground';
import type * as cg from '../src/types';

// A queued premove is only drawn by the virtual layer. Once the host plays it
// and syncs the new position, the queue must retire it in the same step and the
// piece must not slide again from its origin to the square it was already shown
// on. These tests cover that hand-over, plus the matching highlight layers.

const rect = { top: 0, left: 0, width: 400, height: 400, right: 400, bottom: 400 };
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
});
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

const mdoc = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true, isTrusted: true } as MouseEventInit);

const click = (key: cg.Key) => {
  const [x, y] = centerOf(key);
  document.querySelector('cg-board')!.dispatchEvent(mdoc('mousedown', x, y));
  document.dispatchEvent(mdoc('mouseup', x, y));
};

const flush = () => new Promise(r => setTimeout(r, 5));

const animatedKeys = (ground: ReturnType<typeof makeBoard>): cg.Key[] => [
  ...(ground.state.animation.current?.plan.anims.keys() ?? []),
];

// White to premove, black to move. `fen` is the position before the premoves.
const premoveBoard = (fen: string, events: Record<string, any> = {}) =>
  makeBoard({
    fen,
    turnColor: 'black',
    movable: { color: 'white', dests: new Map() },
    premovable: { enabled: true, multiple: true, events },
    trustAllEvents: true,
  });

const BISHOP = '4k3/8/8/8/8/8/8/4KB2 w - - 0 1';
const BISHOP_ON_C4 = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';

describe('a premove the virtual layer already showed is not animated again', () => {
  test('control: without a queued premove the same position change does animate', () => {
    const ground = makeBoard({ fen: BISHOP });
    ground.set({ fen: BISHOP_ON_C4 });
    expect(animatedKeys(ground)).toEqual(['c4']);
  });

  test('playing the front premove retires it with no animation', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');
    expect(ground.state.premovable.queue).toEqual([{ orig: 'f1', dest: 'c4' }]);

    ground.set({ fen: BISHOP_ON_C4 });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.premovable.current).toBeUndefined();
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('an opponent move still animates, and does not retire an unplayed premove', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');

    ground.set({ fen: '3k4/8/8/8/8/8/8/4KB2 w - - 0 1' }); // ...Kd8

    expect(ground.state.premovable.queue).toEqual([{ orig: 'f1', dest: 'c4' }]);
    expect(animatedKeys(ground)).toEqual(['d8']);
  });

  test('opponent move and premove arriving in one position: only the opponent slides', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');

    ground.set({ fen: '3k4/8/8/8/2B5/8/8/4K3 w - - 0 1' });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(animatedKeys(ground)).toEqual(['d8']);
  });

  test('a chain keeps its remaining items, and the next hop is retired the same way', async () => {
    const queueSet = vi.fn(),
      queueUnset = vi.fn();
    const ground = premoveBoard(BISHOP, { queueSet, queueUnset });
    click('f1');
    click('c4');
    click('c4');
    click('b5');
    expect(ground.state.premovable.queue).toEqual([
      { orig: 'f1', dest: 'c4' },
      { orig: 'c4', dest: 'b5' },
    ]);
    await flush();
    queueSet.mockClear();

    ground.set({ fen: BISHOP_ON_C4 });
    expect(ground.state.premovable.queue).toEqual([{ orig: 'c4', dest: 'b5' }]);
    expect(ground.state.premovable.current).toEqual(['c4', 'b5']);
    expect(ground.state.animation.current).toBeUndefined();
    await flush();
    expect(queueSet).toHaveBeenCalledTimes(1);
    expect(queueSet).toHaveBeenCalledWith([{ orig: 'c4', dest: 'b5' }]);
    expect(queueUnset).not.toHaveBeenCalled();

    ground.set({ fen: '4k3/8/8/1B6/8/8/8/4K3 w - - 0 1' });
    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
    await flush();
    expect(queueUnset).toHaveBeenCalledTimes(1);
  });

  test('a capture neither slides the capturer nor fades the captured piece', () => {
    const ground = premoveBoard('4k3/8/8/8/2p5/8/8/4KB2 w - - 0 1');
    click('f1');
    click('c4');

    ground.set({ fen: BISHOP_ON_C4 });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('castling moves neither the king nor the rook again', () => {
    const ground = premoveBoard('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    click('e1');
    click('g1');
    expect(ground.state.premovable.queue).toEqual([{ orig: 'e1', dest: 'g1' }]);

    ground.set({ fen: 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1' });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('castling premoved by dragging the king onto its rook is realized as castling', () => {
    const ground = premoveBoard('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    click('e1');
    click('h1');
    expect(ground.state.premovable.queue).toEqual([{ orig: 'e1', dest: 'h1' }]);

    ground.set({ fen: 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1' });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('en passant removes the victim without a fade', () => {
    const ground = premoveBoard('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    click('e5');
    click('d6');
    expect(ground.state.premovable.queue).toEqual([{ orig: 'e5', dest: 'd6' }]);

    ground.set({ fen: '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1' });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('a promotion is realized whichever piece the host promotes to', () => {
    const ground = premoveBoard('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    click('a7');
    click('a8');
    expect(ground.state.premovable.queue).toEqual([{ orig: 'a7', dest: 'a8' }]);

    ground.set({ fen: 'N3k3/8/8/8/8/8/8/4K3 b - - 0 1' });

    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('a position where the mover is gone but the destination is not filled retires nothing', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');

    ground.set({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' }); // bishop captured

    expect(ground.state.premovable.queue).toEqual([{ orig: 'f1', dest: 'c4' }]);
  });

  test('works with animations disabled as well', () => {
    const ground = premoveBoard(BISHOP);
    ground.set({ animation: { enabled: false } });
    click('f1');
    click('c4');

    ground.set({ fen: BISHOP_ON_C4 });

    expect(ground.state.premovable.queue).toEqual([]);
  });

  test('playPremove() plays the front item without animating it', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');
    ground.set({ turnColor: 'white', movable: { color: 'white', dests: new Map([['f1', ['c4']]]) } });

    expect(ground.playPremove()).toBe(true);

    expect(ground.getFen()).toBe('4k3/8/8/8/2B5/8/8/4K3');
    expect(ground.state.premovable.queue).toEqual([]);
    expect(ground.state.animation.current).toBeUndefined();
  });

  test('a drag grabbed from a virtual piece is dropped when its stage is retired', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');
    ground.state.draggable.current = {
      orig: 'c4',
      piece: { role: 'bishop', color: 'white' },
      origPos: [0, 0],
      pos: [0, 0],
      started: false,
      element: document.createElement('piece') as cg.PieceNode,
      originTarget: null,
      keyHasChanged: false,
      premoveStage: 0,
    };

    ground.set({ fen: BISHOP_ON_C4 });

    expect(ground.state.draggable.current).toBeUndefined();
  });
});

describe('premove highlight layers', () => {
  const lit = (ground: ReturnType<typeof makeBoard>, key: cg.Key): string | undefined => {
    ground.state.dom.redrawNow();
    const sq = Array.from(ground.state.dom.elements.board.querySelectorAll('square')).find(
      s => (s as any).cgKey === key && (s as HTMLElement).style.display !== 'none',
    );
    return Array.from(sq?.classList ?? []).find(c => /^premove-hl-\d$/.test(c));
  };

  test('a square touched by two queued moves is one layer darker than its neighbours', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');
    click('c4');
    click('b5');

    expect(lit(ground, 'f1')).toBe('premove-hl-1');
    expect(lit(ground, 'c4')).toBe('premove-hl-2'); // destination of one, origin of the next
    expect(lit(ground, 'b5')).toBe('premove-hl-1');
    expect(lit(ground, 'e1')).toBeUndefined();
  });

  test('playing the first move removes only its layers; the shared square drops to plain red', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');
    click('c4');
    click('b5');

    ground.set({ fen: BISHOP_ON_C4 });

    expect(lit(ground, 'f1')).toBeUndefined();
    expect(lit(ground, 'c4')).toBe('premove-hl-1');
    expect(lit(ground, 'b5')).toBe('premove-hl-1');
  });

  test('the highlight is cleared when the last queued move is played', () => {
    const ground = premoveBoard(BISHOP);
    click('f1');
    click('c4');

    ground.set({ fen: BISHOP_ON_C4 });

    expect(lit(ground, 'f1')).toBeUndefined();
    expect(lit(ground, 'c4')).toBeUndefined();
  });

  test('layers are capped at the darkest level the stylesheet defines', () => {
    const ground = premoveBoard('4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
    // d1 is touched by seven queued moves (destination, then origin, ...).
    ground.state.premovable.queue = [
      { orig: 'a1', dest: 'd1' },
      { orig: 'd1', dest: 'd2' },
      { orig: 'd2', dest: 'd1' },
      { orig: 'd1', dest: 'd3' },
      { orig: 'd3', dest: 'd1' },
      { orig: 'd1', dest: 'd4' },
      { orig: 'd4', dest: 'd1' },
    ];
    expect(lit(ground, 'd1')).toBe('premove-hl-6');
  });
});

describe('a piece hopping back and forth between two squares', () => {
  const KNIGHT_G1 = '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1';
  const KNIGHT_F3 = '4k3/8/8/8/8/5N2/8/4K3 w - - 0 1';
  const queueHops = (ground: ReturnType<typeof makeBoard>, hops: number) => {
    for (let i = 0; i < hops; i++) {
      const [from, to] = i % 2 === 0 ? (['g1', 'f3'] as const) : (['f3', 'g1'] as const);
      click(from);
      click(to);
    }
  };
  const layersOf = (ground: ReturnType<typeof makeBoard>) => {
    ground.state.dom.redrawNow();
    const out: Record<string, string> = {};
    for (const sq of Array.from(ground.state.dom.elements.board.querySelectorAll('square'))) {
      if ((sq as HTMLElement).style.display === 'none') continue;
      const cls = Array.from(sq.classList).find(c => /^premove-hl-\d$/.test(c));
      if (cls) out[(sq as any).cgKey] = cls;
    }
    return out;
  };

  test('every hop is queued and exactly one virtual piece is drawn, on the last square', () => {
    const ground = premoveBoard(KNIGHT_G1);
    queueHops(ground, 5);
    expect(ground.state.premovable.queue.map(m => m.orig + m.dest)).toEqual(['g1f3', 'f3g1', 'g1f3', 'f3g1', 'g1f3']);
    ground.state.dom.redrawNow();
    const nodes = Array.from(ground.state.dom.elements.premovePieces!.querySelectorAll('piece')) as cg.PieceNode[];
    expect(nodes.map(n => n.cgKey)).toEqual(['f3']);
  });

  test('each played hop retires one item, without animation, and lightens both squares', () => {
    const ground = premoveBoard(KNIGHT_G1);
    queueHops(ground, 5);
    expect(layersOf(ground)).toEqual({ g1: 'premove-hl-5', f3: 'premove-hl-5' });

    ground.set({ fen: KNIGHT_F3 });
    expect(ground.state.premovable.queue.map(m => m.orig + m.dest)).toEqual(['f3g1', 'g1f3', 'f3g1', 'g1f3']);
    expect(ground.state.animation.current).toBeUndefined();
    expect(layersOf(ground)).toEqual({ g1: 'premove-hl-4', f3: 'premove-hl-4' });

    ground.set({ fen: KNIGHT_G1 });
    expect(ground.state.premovable.queue.map(m => m.orig + m.dest)).toEqual(['g1f3', 'f3g1', 'g1f3']);
    expect(ground.state.animation.current).toBeUndefined();
    expect(layersOf(ground)).toEqual({ g1: 'premove-hl-3', f3: 'premove-hl-3' });
  });

  test('re-sending the same position never retires a hop that was not played', () => {
    const ground = premoveBoard(KNIGHT_G1);
    queueHops(ground, 4);

    ground.set({ fen: KNIGHT_G1 });
    ground.set({ fen: KNIGHT_G1 });

    expect(ground.state.premovable.queue.length).toBe(4);
  });
});

describe('a selection made while waiting for the opponent', () => {
  // The user picks up a piece during the opponent's turn so they can click its
  // destination the moment the move lands. A premove selection must survive the
  // opponent's move and turn into a normal move selection.
  const selectedBoard = () => {
    const ground = makeBoard({
      fen: '4k3/8/8/8/8/8/8/4KB2 w - - 0 1',
      turnColor: 'black',
      movable: { color: 'white', dests: new Map() },
      premovable: { enabled: true, multiple: true },
      trustAllEvents: true,
    });
    click('f1');
    expect(ground.state.selected).toBe('f1');
    return ground;
  };
  const visibleClasses = (ground: ReturnType<typeof makeBoard>, key: cg.Key) => {
    ground.state.dom.redrawNow();
    const sq = Array.from(ground.state.dom.elements.board.querySelectorAll('square')).filter(
      s => (s as any).cgKey === key && (s as HTMLElement).style.display !== 'none',
    );
    return sq.flatMap(s => Array.from(s.classList));
  };

  test('survives the opponent move, shows the real destinations, and moves on the next click', async () => {
    const after = vi.fn();
    const ground = selectedBoard();
    ground.set({ movable: { events: { after } } });

    // ...Kd8, then the host hands over the legal moves of the new position.
    ground.set({
      fen: '3k4/8/8/8/8/8/8/4KB2 w - - 0 1',
      turnColor: 'white',
      movable: { color: 'white', dests: new Map([['f1', ['c4', 'b5']]]) },
    });

    expect(ground.state.selected).toBe('f1');
    expect(visibleClasses(ground, 'c4')).toContain('move-dest');
    expect(visibleClasses(ground, 'f1')).toContain('selected');

    click('c4');
    await flush();
    expect(ground.getFen()).toBe('3k4/8/8/8/2B5/8/8/4K3');
    expect(after).toHaveBeenCalledWith('f1', 'c4', expect.objectContaining({ premove: false }));
  });

  test('is dropped when the opponent captures the selected piece', () => {
    const ground = selectedBoard();

    ground.set({
      fen: '4k3/8/8/8/8/8/8/4Kb2 w - - 0 1', // ...Bxf1 style: a black piece now sits on f1
      turnColor: 'white',
      movable: { color: 'white', dests: new Map() },
    });

    expect(ground.state.selected).toBeUndefined();
    expect(visibleClasses(ground, 'f1')).not.toContain('selected');
  });

  test('is dropped when the selected piece disappears', () => {
    const ground = selectedBoard();

    ground.set({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });

    expect(ground.state.selected).toBeUndefined();
  });

  test('is kept when the selected piece is still there but nothing else matters', () => {
    const ground = selectedBoard();

    ground.set({ fen: '3k4/8/8/8/8/8/8/4KB2 w - - 0 1' });

    expect(ground.state.selected).toBe('f1');
  });
});
