'use strict';

const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTIONS = ['skip', 'reverse', 'draw2'];
const BOT_NAMES = ['บอทโมจิ', 'บอทข้าวปั้น', 'บอทสายฟ้า', 'บอทโกโก้', 'บอทปังปอนด์', 'บอทมิ้นท์', 'บอทส้มจี๊ด'];
const AVATARS = ['🦊', '🐼', '🐸', '🐯', '🐙', '🦄', '🐝', '🐨'];

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createDeck() {
  const deck = [];
  let seq = 0;
  const make = (color, value) => ({ id: `c_${seq++}`, color, value });

  for (const color of COLORS) {
    deck.push(make(color, '0'));
    for (let n = 1; n <= 9; n++) {
      deck.push(make(color, String(n)));
      deck.push(make(color, String(n)));
    }
    for (const act of ACTIONS) {
      deck.push(make(color, act));
      deck.push(make(color, act));
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(make('wild', 'wild'));
    deck.push(make('wild', 'wild4'));
  }
  return shuffle(deck);
}

function cardPoints(card) {
  if (card.color === 'wild') return 50;
  if (card.value === 'skip' || card.value === 'reverse' || card.value === 'draw2') return 20;
  return Number(card.value) || 0;
}

function handPoints(hand) {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

class UnoRoom {
  constructor(code) {
    this.code = code;
    this.status = 'lobby'; // 'lobby' | 'playing' | 'finished'
    this.players = []; // { id, socketId, name, avatar, isBot, isHost, connected, hand, score, unoSafe, unoVulnerable }
    this.settings = {
      stackDraw: true,
      maxPlayers: 8
    };
    this.drawPile = [];
    this.discardPile = [];
    this.activeColor = 'red';
    this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
    this.currentTurnIndex = 0;
    this.pendingDraw = 0;
    this.pendingDrawType = null; // 'draw2' | 'wild4' | null
    this.drawnCardId = null; // If current player drew 1 playable card and can play or pass
    this.roundNumber = 0;
    this.winnerId = null;
    this.lastEvent = null;
    this.eventSeq = 0;
    this.chat = [];
    this.updatedAt = Date.now();
  }

  touch() {
    this.updatedAt = Date.now();
  }

  setLastEvent(type, text, meta = {}) {
    this.eventSeq += 1;
    this.lastEvent = { seq: this.eventSeq, type, text, ...meta };
    this.touch();
  }

  getPlayer(playerId) {
    return this.players.find((p) => p.id === playerId) || null;
  }

  getPlayerBySocket(socketId) {
    return this.players.find((p) => p.socketId === socketId) || null;
  }

  getCurrentPlayer() {
    if (this.players.length === 0) return null;
    return this.players[this.currentTurnIndex] || null;
  }

  getTopDiscard() {
    return this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null;
  }

  addPlayer({ id, socketId, name, isBot = false }) {
    if (this.status !== 'lobby') {
      return { ok: false, error: 'เกมกำลังดำเนินอยู่ ไม่สามารถเข้าห้องระหว่างรอบได้' };
    }
    if (this.players.length >= this.settings.maxPlayers) {
      return { ok: false, error: 'ห้องเต็มแล้ว (สูงสุด 8 คน)' };
    }
    const cleanName = String(name || '').trim().slice(0, 18) || (isBot ? 'บอท' : 'ผู้เล่น');
    const isHost = !isBot && this.players.every((p) => p.isBot);
    const avatar = AVATARS[this.players.length % AVATARS.length];
    const player = {
      id,
      socketId: isBot ? null : socketId,
      name: cleanName,
      avatar,
      isBot,
      isHost,
      connected: true,
      hand: [],
      score: 0,
      unoSafe: false,
      unoVulnerable: false
    };
    this.players.push(player);
    this.setLastEvent('join', `${player.name} เข้าห้องแล้ว`, { playerId: player.id });
    return { ok: true, player };
  }

  addBot(requesterId) {
    const requester = this.getPlayer(requesterId);
    if (!requester || !requester.isHost) {
      return { ok: false, error: 'เฉพาะหัวหน้าห้องเท่านั้นที่เพิ่มบอทได้' };
    }
    if (this.status !== 'lobby') {
      return { ok: false, error: 'เพิ่มบอทได้เฉพาะในหน้าล็อบบี้เท่านั้น' };
    }
    if (this.players.length >= this.settings.maxPlayers) {
      return { ok: false, error: 'ห้องเต็มแล้ว (สูงสุด 8 คน)' };
    }
    const usedNames = new Set(this.players.map((p) => p.name));
    const botName =
      BOT_NAMES.find((n) => !usedNames.has(n)) || `บอท #${this.players.filter((p) => p.isBot).length + 1}`;
    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    return this.addPlayer({ id: botId, socketId: null, name: botName, isBot: true });
  }

  removePlayer(playerId, requesterId = null) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return { ok: false, error: 'ไม่พบผู้เล่น' };

    const target = this.players[idx];
    if (requesterId && requesterId !== playerId) {
      const req = this.getPlayer(requesterId);
      if (!req || !req.isHost) {
        return { ok: false, error: 'เฉพาะหัวหน้าห้องเท่านั้นที่ลบผู้เล่นได้' };
      }
    }

    // If playing, return cards to draw pile
    if (this.status === 'playing' && target.hand.length > 0) {
      this.drawPile.unshift(...target.hand);
      this.drawPile = shuffle(this.drawPile);
    }

    this.players.splice(idx, 1);

    // Reassign host if needed
    if (target.isHost) {
      const nextHuman = this.players.find((p) => !p.isBot);
      if (nextHuman) {
        nextHuman.isHost = true;
      }
    }

    if (this.status === 'playing') {
      if (this.players.length < 2) {
        this.status = 'lobby';
        this.resetRoundState();
        this.setLastEvent('info', `${target.name} ออกจากห้อง — กลับสู่ล็อบบี้เนื่องจากผู้เล่นไม่พอ`);
      } else {
        if (idx < this.currentTurnIndex) {
          this.currentTurnIndex -= 1;
        }
        this.currentTurnIndex = ((this.currentTurnIndex % this.players.length) + this.players.length) % this.players.length;
        this.drawnCardId = null;
        this.setLastEvent('leave', `${target.name} ออกจากเกมแล้ว`);
      }
    } else {
      this.setLastEvent('leave', `${target.name} ออกจากห้องแล้ว`);
    }

    return { ok: true, removed: target };
  }

  updateSettings(requesterId, patch) {
    const req = this.getPlayer(requesterId);
    if (!req || !req.isHost) {
      return { ok: false, error: 'เฉพาะหัวหน้าห้องเท่านั้นที่ตั้งค่าห้องได้' };
    }
    if (typeof patch.stackDraw === 'boolean') {
      this.settings.stackDraw = patch.stackDraw;
    }
    this.touch();
    return { ok: true };
  }

  resetRoundState() {
    this.drawPile = [];
    this.discardPile = [];
    this.pendingDraw = 0;
    this.pendingDrawType = null;
    this.drawnCardId = null;
    this.winnerId = null;
    this.direction = 1;
    this.currentTurnIndex = 0;
    for (const p of this.players) {
      p.hand = [];
      p.unoSafe = false;
      p.unoVulnerable = false;
    }
  }

  startGame(requesterId) {
    const req = this.getPlayer(requesterId);
    if (!req || !req.isHost) {
      return { ok: false, error: 'เฉพาะหัวหน้าห้องเท่านั้นที่เริ่มเกมได้' };
    }
    if (this.players.length < 2) {
      return { ok: false, error: 'ต้องมีผู้เล่นอย่างน้อย 2 คน (หรือเพิ่มบอท)' };
    }

    this.resetRoundState();
    this.status = 'playing';
    this.roundNumber += 1;
    this.drawPile = createDeck();

    // Deal 7 cards each
    for (let i = 0; i < 7; i++) {
      for (const player of this.players) {
        player.hand.push(this.drawPile.pop());
      }
    }

    // Pick first starting number card so turn 1 is always clean & fair
    let starterIdx = this.drawPile.findIndex(
      (c) => c.color !== 'wild' && NUMBERS.includes(c.value)
    );
    if (starterIdx === -1) starterIdx = this.drawPile.length - 1;
    const [starterCard] = this.drawPile.splice(starterIdx, 1);
    this.discardPile.push(starterCard);
    this.activeColor = starterCard.color === 'wild' ? COLORS[0] : starterCard.color;
    this.currentTurnIndex = Math.floor(Math.random() * this.players.length);

    const firstPlayer = this.getCurrentPlayer();
    this.setLastEvent('start', `เริ่มรอบที่ ${this.roundNumber}! ตาแรกของ ${firstPlayer.name}`, {
      playerId: firstPlayer.id
    });
    return { ok: true };
  }

  returnToLobby(requesterId) {
    const req = this.getPlayer(requesterId);
    if (!req || !req.isHost) {
      return { ok: false, error: 'เฉพาะหัวหน้าห้องเท่านั้นที่กลับหน้าล็อบบี้ได้' };
    }
    this.status = 'lobby';
    this.resetRoundState();
    this.setLastEvent('lobby', 'กลับสู่ห้องล็อบบี้แล้ว');
    return { ok: true };
  }

  drawFromPile(count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) {
        if (this.discardPile.length <= 1) break;
        const top = this.discardPile.pop();
        this.drawPile = shuffle(this.discardPile);
        this.discardPile = [top];
      }
      if (this.drawPile.length > 0) {
        drawn.push(this.drawPile.pop());
      }
    }
    return drawn;
  }

  canPlayCard(card, playerId) {
    if (this.status !== 'playing') return false;
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return false;
    const top = this.getTopDiscard();
    if (!top) return true;

    if (this.drawnCardId) {
      return card.id === this.drawnCardId && this._matchesTop(card, top);
    }

    if (this.pendingDraw > 0) {
      if (!this.settings.stackDraw) return false;
      if (this.pendingDrawType === 'draw2') {
        return card.value === 'draw2' || card.value === 'wild4';
      }
      if (this.pendingDrawType === 'wild4') {
        return card.value === 'wild4';
      }
      return false;
    }

    return this._matchesTop(card, top);
  }

  _matchesTop(card, top) {
    if (card.color === 'wild') return true;
    if (card.color === this.activeColor) return true;
    if (card.value === top.value) return true;
    return false;
  }

  _clearOthersUnoVulnerable(exceptId = null) {
    for (const p of this.players) {
      if (p.id !== exceptId) {
        p.unoVulnerable = false;
      }
    }
  }

  _advanceTurn(steps = 1) {
    const n = this.players.length;
    this.currentTurnIndex = (((this.currentTurnIndex + this.direction * steps) % n) + n) % n;
    this.drawnCardId = null;
  }

  playCard(playerId, cardId, chosenColor = null) {
    if (this.status !== 'playing') {
      return { ok: false, error: 'เกมยังไม่ได้เริ่ม' };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'ยังไม่ถึงตาของคุณ' };
    }

    const cardIdx = player.hand.findIndex((c) => c.id === cardId);
    if (cardIdx === -1) {
      return { ok: false, error: 'ไม่พบการ์ดใบนี้ในมือ' };
    }

    const card = player.hand[cardIdx];
    if (!this.canPlayCard(card, playerId)) {
      return { ok: false, error: 'ไม่สามารถลงการ์ดใบนี้ได้' };
    }

    if (card.color === 'wild') {
      if (!COLORS.includes(chosenColor)) {
        return { ok: false, error: 'กรุณาเลือกสีสำหรับการ์ด Wild' };
      }
    }

    // Previous players who survived without being caught are safe now
    this._clearOthersUnoVulnerable(player.id);

    // Play the card
    player.hand.splice(cardIdx, 1);
    this.discardPile.push(card);
    this.drawnCardId = null;
    this.activeColor = card.color === 'wild' ? chosenColor : card.color;

    // Check UNO state
    if (player.hand.length === 1) {
      if (!player.unoSafe) {
        player.unoVulnerable = true;
      }
    } else {
      player.unoSafe = false;
      player.unoVulnerable = false;
    }

    // Check win!
    if (player.hand.length === 0) {
      this.status = 'finished';
      this.winnerId = player.id;
      this.pendingDraw = 0;
      this.pendingDrawType = null;
      const roundPoints = this.players
        .filter((p) => p.id !== player.id)
        .reduce((sum, p) => sum + handPoints(p.hand), 0);
      player.score += roundPoints;
      this.setLastEvent('win', `🎉 ${player.name} ชนะรอบที่ ${this.roundNumber}! (+${roundPoints} คะแนน)`, {
        playerId: player.id,
        points: roundPoints,
        card
      });
      return { ok: true, won: true, card };
    }

    // Apply special card effects
    let step = 1;
    let eventType = 'play';
    let message = `${player.name} ลงการ์ด ${formatCardLabel(card, this.activeColor)}`;

    if (card.value === 'skip') {
      step = 2;
      eventType = 'skip';
      const skippedIdx = (((this.currentTurnIndex + this.direction) % this.players.length) + this.players.length) % this.players.length;
      const skipped = this.players[skippedIdx];
      message = `${player.name} ใช้ ข้ามตา! (${skipped.name} โดนข้าม)`;
    } else if (card.value === 'reverse') {
      eventType = 'reverse';
      if (this.players.length === 2) {
        step = 2;
        message = `${player.name} ใช้ ย้อนทิศ! (2 คน = เล่นต่อทันที)`;
      } else {
        this.direction *= -1;
        step = 1;
        message = `${player.name} ใช้ ย้อนทิศทาง!`;
      }
    } else if (card.value === 'draw2') {
      eventType = 'draw2';
      if (this.settings.stackDraw) {
        this.pendingDraw += 2;
        this.pendingDrawType = 'draw2';
        step = 1;
        message = `${player.name} ลง +2! (สะสมเป็น +${this.pendingDraw})`;
      } else {
        const victimIdx = (((this.currentTurnIndex + this.direction) % this.players.length) + this.players.length) % this.players.length;
        const victim = this.players[victimIdx];
        const drawn = this.drawFromPile(2);
        victim.hand.push(...drawn);
        victim.unoSafe = false;
        victim.unoVulnerable = false;
        step = 2;
        message = `${player.name} ลง +2! ${victim.name} จั่ว 2 ใบและโดนข้ามตา`;
      }
    } else if (card.value === 'wild4') {
      eventType = 'wild4';
      if (this.settings.stackDraw) {
        this.pendingDraw += 4;
        this.pendingDrawType = 'wild4';
        step = 1;
        message = `${player.name} ลง +4 เปลี่ยนเป็นสี${thaiColor(this.activeColor)}! (สะสมเป็น +${this.pendingDraw})`;
      } else {
        const victimIdx = (((this.currentTurnIndex + this.direction) % this.players.length) + this.players.length) % this.players.length;
        const victim = this.players[victimIdx];
        const drawn = this.drawFromPile(4);
        victim.hand.push(...drawn);
        victim.unoSafe = false;
        victim.unoVulnerable = false;
        step = 2;
        message = `${player.name} ลง +4 เปลี่ยนเป็นสี${thaiColor(this.activeColor)}! ${victim.name} จั่ว 4 ใบและโดนข้ามตา`;
      }
    } else if (card.value === 'wild') {
      eventType = 'wild';
      message = `${player.name} เปลี่ยนสีเป็นสี${thaiColor(this.activeColor)}`;
    }

    this._advanceTurn(step);
    this.setLastEvent(eventType, message, { playerId: player.id, card, color: this.activeColor });
    return { ok: true, won: false, card };
  }

  drawCard(playerId) {
    if (this.status !== 'playing') {
      return { ok: false, error: 'เกมยังไม่ได้เริ่ม' };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'ยังไม่ถึงตาของคุณ' };
    }
    if (this.drawnCardId) {
      return { ok: false, error: 'คุณจั่วไปแล้ว สามารถลงใบที่จั่วหรือกดผ่านตาได้' };
    }

    this._clearOthersUnoVulnerable();

    // Penalty draw
    if (this.pendingDraw > 0) {
      const count = this.pendingDraw;
      const drawn = this.drawFromPile(count);
      player.hand.push(...drawn);
      player.unoSafe = false;
      player.unoVulnerable = false;
      this.pendingDraw = 0;
      this.pendingDrawType = null;
      this._advanceTurn(1);
      this.setLastEvent('penalty_draw', `${player.name} จั่วการ์ดโทษ ${drawn.length} ใบ`, {
        playerId: player.id,
        count: drawn.length
      });
      return { ok: true, drawn, mustPassOrPlay: false };
    }

    // Normal draw 1
    const drawn = this.drawFromPile(1);
    if (drawn.length === 0) {
      this._advanceTurn(1);
      this.setLastEvent('pass', `กองจั่วหมด — ${player.name} ผ่านตา`, { playerId: player.id });
      return { ok: true, drawn: [], mustPassOrPlay: false };
    }

    const newCard = drawn[0];
    player.hand.push(newCard);
    player.unoSafe = false;
    player.unoVulnerable = false;

    const top = this.getTopDiscard();
    if (top && this._matchesTop(newCard, top)) {
      this.drawnCardId = newCard.id;
      this.setLastEvent('draw_playable', `${player.name} จั่ว 1 ใบ (ลงต่อได้หรือกดผ่าน)`, {
        playerId: player.id
      });
      return { ok: true, drawn, mustPassOrPlay: true, drawnCard: newCard };
    }

    this._advanceTurn(1);
    this.setLastEvent('draw', `${player.name} จั่ว 1 ใบแล้วผ่านตา`, { playerId: player.id });
    return { ok: true, drawn, mustPassOrPlay: false };
  }

  passTurn(playerId) {
    if (this.status !== 'playing') {
      return { ok: false, error: 'เกมยังไม่ได้เริ่ม' };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'ยังไม่ถึงตาของคุณ' };
    }
    if (!this.drawnCardId) {
      return { ok: false, error: 'ต้องจั่วการ์ดก่อนจึงจะผ่านตาได้' };
    }
    this.drawnCardId = null;
    this._advanceTurn(1);
    this.setLastEvent('pass', `${player.name} เลือกผ่านตา`, { playerId: player.id });
    return { ok: true };
  }

  shoutUno(playerId) {
    if (this.status !== 'playing') return { ok: false, error: 'เกมยังไม่ได้เริ่ม' };
    const player = this.getPlayer(playerId);
    if (!player) return { ok: false, error: 'ไม่พบผู้เล่น' };

    const current = this.getCurrentPlayer();
    const canPreShout = current && current.id === playerId && player.hand.length === 2;
    const canPostShout = player.hand.length === 1 && player.unoVulnerable;

    if (!canPreShout && !canPostShout) {
      return { ok: false, error: 'ตะโกน UNO ได้เมื่อเหลือการ์ด 1–2 ใบเท่านั้น' };
    }

    player.unoSafe = true;
    player.unoVulnerable = false;
    this.setLastEvent('uno', `🔥 ${player.name} ตะโกน UNO!!`, { playerId: player.id });
    return { ok: true };
  }

  catchUno(catcherId, targetId) {
    if (this.status !== 'playing') return { ok: false, error: 'เกมยังไม่ได้เริ่ม' };
    const catcher = this.getPlayer(catcherId);
    const target = this.getPlayer(targetId);
    if (!catcher || !target || catcher.id === target.id) {
      return { ok: false, error: 'ไม่สามารถจับ UNO ได้' };
    }
    if (!target.unoVulnerable || target.hand.length !== 1) {
      return { ok: false, error: `${target.name} ตะโกน UNO ไปแล้วหรือไม่ได้เหลือ 1 ใบ` };
    }

    const drawn = this.drawFromPile(2);
    target.hand.push(...drawn);
    target.unoVulnerable = false;
    target.unoSafe = false;
    this.setLastEvent('catch_uno', `🚨 ${catcher.name} จับได้! ${target.name} ลืมตะโกน UNO โดนจั่ว +2`, {
      catcherId: catcher.id,
      targetId: target.id
    });
    return { ok: true };
  }

  addChatMessage(playerId, text) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) return null;
    const msg = {
      id: `m_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      playerId: player.id,
      name: player.name,
      avatar: player.avatar,
      text: clean,
      at: Date.now()
    };
    this.chat.push(msg);
    if (this.chat.length > 40) this.chat.shift();
    this.touch();
    return msg;
  }

  chooseBotAction(botId) {
    const bot = this.getCurrentPlayer();
    if (!bot || !bot.isBot || bot.id !== botId || this.status !== 'playing') {
      return null;
    }

    // If bot just drew a playable card, play it
    if (this.drawnCardId) {
      const drawnCard = bot.hand.find((c) => c.id === this.drawnCardId);
      if (drawnCard && this.canPlayCard(drawnCard, bot.id)) {
        const chosenColor = drawnCard.color === 'wild' ? this._bestColorFor(bot.hand) : null;
        return { action: 'play', cardId: drawnCard.id, chosenColor, shoutUno: bot.hand.length === 2 && Math.random() < 0.85 };
      }
      return { action: 'pass' };
    }

    const playable = bot.hand.filter((c) => this.canPlayCard(c, bot.id));
    if (playable.length === 0) {
      return { action: 'draw' };
    }

    // Check if next player is close to winning
    const nextIdx = (((this.currentTurnIndex + this.direction) % this.players.length) + this.players.length) % this.players.length;
    const nextPlayer = this.players[nextIdx];
    const nextDanger = nextPlayer && nextPlayer.hand.length <= 2;

    const scored = playable.map((card) => {
      let weight = 0;
      if (card.color !== 'wild') weight += 30; // save wilds
      if (nextDanger && (card.value === 'draw2' || card.value === 'skip' || card.value === 'wild4')) {
        weight += 45;
      } else if (card.value === 'wild4') {
        weight -= 15;
      } else if (card.value === 'wild') {
        weight -= 10;
      } else if (ACTIONS.includes(card.value)) {
        weight += 12;
      } else {
        weight += Number(card.value) || 0;
      }
      return { card, weight };
    });

    scored.sort((a, b) => b.weight - a.weight);
    const chosen = scored[0].card;
    const chosenColor = chosen.color === 'wild' ? this._bestColorFor(bot.hand.filter((c) => c.id !== chosen.id)) : null;
    const shouldShout = bot.hand.length === 2 && Math.random() < 0.85;

    return { action: 'play', cardId: chosen.id, chosenColor, shoutUno: shouldShout };
  }

  _bestColorFor(hand) {
    const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (const c of hand) {
      if (counts[c.color] !== undefined) counts[c.color] += 1;
    }
    let best = COLORS[0];
    let max = -1;
    for (const col of COLORS) {
      if (counts[col] > max) {
        max = counts[col];
        best = col;
      }
    }
    return best;
  }

  getStateForPlayer(viewerId) {
    const viewer = this.getPlayer(viewerId);
    const current = this.getCurrentPlayer();
    const isViewerTurn = Boolean(this.status === 'playing' && current && current.id === viewerId);

    const playableIds = isViewerTurn && viewer
      ? viewer.hand.filter((c) => this.canPlayCard(c, viewerId)).map((c) => c.id)
      : [];

    const canShoutUno = Boolean(
      this.status === 'playing' &&
      viewer &&
      ((isViewerTurn && viewer.hand.length === 2 && !viewer.unoSafe) ||
        (viewer.hand.length === 1 && viewer.unoVulnerable))
    );

    const catchablePlayerIds = this.status === 'playing'
      ? this.players
          .filter((p) => p.id !== viewerId && p.unoVulnerable && p.hand.length === 1)
          .map((p) => p.id)
      : [];

    return {
      code: this.code,
      status: this.status,
      roundNumber: this.roundNumber,
      settings: { ...this.settings },
      activeColor: this.activeColor,
      direction: this.direction,
      currentPlayerId: current ? current.id : null,
      drawPileCount: this.drawPile.length,
      topCard: this.getTopDiscard(),
      pendingDraw: this.pendingDraw,
      pendingDrawType: this.pendingDrawType,
      drawnCardId: isViewerTurn ? this.drawnCardId : null,
      winnerId: this.winnerId,
      lastEvent: this.lastEvent,
      me: viewer
        ? {
            id: viewer.id,
            name: viewer.name,
            avatar: viewer.avatar,
            isHost: viewer.isHost,
            hand: viewer.hand,
            playableIds,
            canShoutUno,
            canPass: Boolean(isViewerTurn && this.drawnCardId)
          }
        : null,
      catchablePlayerIds,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        isHost: p.isHost,
        connected: p.connected,
        cardCount: p.hand.length,
        score: p.score,
        roundHandPoints: this.status === 'finished' ? handPoints(p.hand) : null,
        unoSafe: p.unoSafe && p.hand.length === 1,
        unoVulnerable: p.unoVulnerable && p.hand.length === 1
      })),
      chat: this.chat
    };
  }
}

function thaiColor(color) {
  switch (color) {
    case 'red': return 'แดง';
    case 'blue': return 'น้ำเงิน';
    case 'green': return 'เขียว';
    case 'yellow': return 'เหลือง';
    default: return color;
  }
}

function formatCardLabel(card, activeColor) {
  const valMap = {
    skip: 'ข้ามตา',
    reverse: 'ย้อนทิศ',
    draw2: '+2',
    wild: 'เปลี่ยนสี',
    wild4: '+4'
  };
  const label = valMap[card.value] || card.value;
  if (card.color === 'wild') return `${label} (สี${thaiColor(activeColor)})`;
  return `สี${thaiColor(card.color)} ${label}`;
}

module.exports = {
  UnoRoom,
  COLORS,
  createDeck,
  cardPoints,
  handPoints
};
