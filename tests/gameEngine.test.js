'use strict';

const assert = require('assert');
const { UnoRoom, createDeck } = require('../server/gameEngine');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test('standard deck has 108 unique cards', () => {
  const deck = createDeck();
  assert.strictEqual(deck.length, 108);
  const ids = new Set(deck.map((c) => c.id));
  assert.strictEqual(ids.size, 108);
  const wilds = deck.filter((c) => c.color === 'wild');
  assert.strictEqual(wilds.length, 8);
});

test('2-player reverse acts as skip so current player plays again', () => {
  const room = new UnoRoom('TEST');
  room.addPlayer({ id: 'p1', socketId: 's1', name: 'A' });
  room.addPlayer({ id: 'p2', socketId: 's2', name: 'B' });
  room.startGame('p1');

  room.currentTurnIndex = 0;
  room.activeColor = 'red';
  room.discardPile = [{ id: 'top', color: 'red', value: '5' }];
  room.players[0].hand = [
    { id: 'rev', color: 'red', value: 'reverse' },
    { id: 'keep', color: 'blue', value: '3' },
    { id: 'keep2', color: 'green', value: '4' }
  ];

  const res = room.playCard('p1', 'rev');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(room.getCurrentPlayer().id, 'p1');
});

test('stacking +2 onto +2 accumulates pendingDraw and victim draws all', () => {
  const room = new UnoRoom('STCK');
  room.addPlayer({ id: 'p1', socketId: 's1', name: 'A' });
  room.addPlayer({ id: 'p2', socketId: 's2', name: 'B' });
  room.addPlayer({ id: 'p3', socketId: 's3', name: 'C' });
  room.startGame('p1');

  room.currentTurnIndex = 0;
  room.activeColor = 'blue';
  room.discardPile = [{ id: 'top', color: 'blue', value: '2' }];
  room.players[0].hand = [
    { id: 'd1', color: 'blue', value: 'draw2' },
    { id: 'x1', color: 'red', value: '1' }
  ];
  room.players[1].hand = [
    { id: 'd2', color: 'green', value: 'draw2' },
    { id: 'x2', color: 'red', value: '9' }
  ];
  const p3InitialCount = room.players[2].hand.length;

  assert.strictEqual(room.playCard('p1', 'd1').ok, true);
  assert.strictEqual(room.pendingDraw, 2);
  assert.strictEqual(room.getCurrentPlayer().id, 'p2');

  assert.strictEqual(room.playCard('p2', 'd2').ok, true);
  assert.strictEqual(room.pendingDraw, 4);
  assert.strictEqual(room.getCurrentPlayer().id, 'p3');

  const drawRes = room.drawCard('p3');
  assert.strictEqual(drawRes.ok, true);
  assert.strictEqual(room.pendingDraw, 0);
  assert.strictEqual(room.players[2].hand.length, p3InitialCount + 4);
  assert.strictEqual(room.getCurrentPlayer().id, 'p1');
});

test('UNO shout prevents catch; forgetting UNO allows opponent to catch for +2', () => {
  const room = new UnoRoom('UNO1');
  room.addPlayer({ id: 'p1', socketId: 's1', name: 'A' });
  room.addPlayer({ id: 'p2', socketId: 's2', name: 'B' });
  room.startGame('p1');

  room.currentTurnIndex = 0;
  room.activeColor = 'yellow';
  room.discardPile = [{ id: 'top', color: 'yellow', value: '4' }];
  room.players[0].hand = [
    { id: 'y5', color: 'yellow', value: '5' },
    { id: 'b9', color: 'blue', value: '9' }
  ];

  // Forget to shout UNO before playing down to 1 card
  assert.strictEqual(room.playCard('p1', 'y5').ok, true);
  assert.strictEqual(room.players[0].unoVulnerable, true);

  const catchRes = room.catchUno('p2', 'p1');
  assert.strictEqual(catchRes.ok, true);
  assert.strictEqual(room.players[0].hand.length, 3);
  assert.strictEqual(room.players[0].unoVulnerable, false);
});

test('sanitized state never exposes other players hands', () => {
  const room = new UnoRoom('PRIV');
  room.addPlayer({ id: 'p1', socketId: 's1', name: 'A' });
  room.addPlayer({ id: 'p2', socketId: 's2', name: 'B' });
  room.startGame('p1');

  const view1 = room.getStateForPlayer('p1');
  assert.strictEqual(view1.me.hand.length, 7);
  for (const p of view1.players) {
    assert.strictEqual(p.hand, undefined);
    assert.strictEqual(p.cardCount, 7);
  }
});

test('full 4-bot match completes cleanly with a winner and positive score', () => {
  const room = new UnoRoom('BOTS');
  room.addPlayer({ id: 'host', socketId: 's1', name: 'Host' });
  room.addBot('host');
  room.addBot('host');
  room.addBot('host');
  // Turn host into bot for automated simulation
  room.players[0].isBot = true;
  assert.strictEqual(room.startGame('host').ok, true);

  let steps = 0;
  while (room.status === 'playing' && steps < 1000) {
    const cur = room.getCurrentPlayer();
    const action = room.chooseBotAction(cur.id);
    assert.ok(action, 'bot must always return an action');
    if (action.action === 'play') {
      if (action.shoutUno) room.shoutUno(cur.id);
      assert.strictEqual(room.playCard(cur.id, action.cardId, action.chosenColor).ok, true);
    } else if (action.action === 'draw') {
      assert.strictEqual(room.drawCard(cur.id).ok, true);
    } else if (action.action === 'pass') {
      assert.strictEqual(room.passTurn(cur.id).ok, true);
    }
    steps++;
  }

  assert.strictEqual(room.status, 'finished', `Expected finished game within 1000 steps (ran ${steps})`);
  const winner = room.getPlayer(room.winnerId);
  assert.ok(winner);
  assert.strictEqual(winner.hand.length, 0);
  assert.ok(winner.score > 0);
});
