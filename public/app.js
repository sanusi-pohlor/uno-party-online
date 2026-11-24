(() => {
  'use strict';

  const socket = io({
    transports: ['websocket']
  });

  const els = {
    viewHome: document.getElementById('view-home'),
    viewLobby: document.getElementById('view-lobby'),
    viewGame: document.getElementById('view-game'),

    inputName: document.getElementById('input-player-name'),
    inputCode: document.getElementById('input-room-code'),
    btnCreate: document.getElementById('btn-create-room'),
    btnJoin: document.getElementById('btn-join-room'),
    homeError: document.getElementById('home-error'),

    lobbyRoomPill: document.getElementById('lobby-room-pill'),
    lobbyCodeBig: document.getElementById('lobby-code-big'),
    btnCopyCode: document.getElementById('btn-copy-code'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    lobbyPlayerCount: document.getElementById('lobby-player-count'),
    lobbyPlayerList: document.getElementById('lobby-player-list'),
    btnAddBot: document.getElementById('btn-add-bot'),
    toggleStackDraw: document.getElementById('toggle-stack-draw'),
    btnStartGame: document.getElementById('btn-start-game'),
    lobbyWaitMsg: document.getElementById('lobby-wait-msg'),
    btnLobbyLeave: document.getElementById('btn-lobby-leave'),
    btnLobbySound: document.getElementById('btn-lobby-sound'),
    lobbyChatLog: document.getElementById('lobby-chat-log'),
    lobbyChatForm: document.getElementById('lobby-chat-form'),
    lobbyChatInput: document.getElementById('lobby-chat-input'),

    gameRoomPill: document.getElementById('game-room-pill'),
    gameRoundChip: document.getElementById('game-round-chip'),
    gameDirChip: document.getElementById('game-dir-chip'),
    btnGameSound: document.getElementById('btn-game-sound'),
    btnToggleChat: document.getElementById('btn-toggle-chat'),
    chatUnreadDot: document.getElementById('chat-unread-dot'),
    btnGameLeave: document.getElementById('btn-game-leave'),
    opponentsRow: document.getElementById('opponents-row'),
    emoteLayer: document.getElementById('emote-layer'),
    eventBanner: document.getElementById('event-banner'),
    btnDrawPile: document.getElementById('btn-draw-pile'),
    pendingDrawBadge: document.getElementById('pending-draw-badge'),
    drawPileCount: document.getElementById('draw-pile-count'),
    activeColorRing: document.getElementById('active-color-ring'),
    discardCardMount: document.getElementById('discard-card-mount'),
    activeColorLabel: document.getElementById('active-color-label'),
    turnIndicator: document.getElementById('turn-indicator'),
    btnPassTurn: document.getElementById('btn-pass-turn'),
    btnShoutUno: document.getElementById('btn-shout-uno'),
    playerHand: document.getElementById('player-hand'),

    gameChatDrawer: document.getElementById('game-chat-drawer'),
    btnCloseChat: document.getElementById('btn-close-chat'),
    gameChatLog: document.getElementById('game-chat-log'),
    gameChatForm: document.getElementById('game-chat-form'),
    gameChatInput: document.getElementById('game-chat-input'),

    modalWild: document.getElementById('modal-wild'),
    btnCancelWild: document.getElementById('btn-cancel-wild'),
    modalWinner: document.getElementById('modal-winner'),
    winnerTitle: document.getElementById('winner-title'),
    winnerSubtitle: document.getElementById('winner-subtitle'),
    scoreboardBody: document.getElementById('scoreboard-body'),
    winnerHostActions: document.getElementById('winner-host-actions'),
    winnerGuestWait: document.getElementById('winner-guest-wait'),
    btnRematch: document.getElementById('btn-rematch'),
    btnBackLobby: document.getElementById('btn-back-lobby'),
    toast: document.getElementById('toast')
  };

  let state = null;
  let pendingWildCardId = null;
  let lastPlayedEventSeq = 0;
  let toastTimer = null;

  // Restore saved player name & pre-fill room code from ?room=XXXX
  els.inputName.value = localStorage.getItem('uno_player_name') || '';
  const urlRoom = new URLSearchParams(window.location.search).get('room');
  if (urlRoom) {
    els.inputCode.value = urlRoom.toUpperCase().slice(0, 6);
  }

  function updateSoundIcons() {
    const icon = window.UnoSound.isMuted() ? '🔇' : '🔊';
    els.btnLobbySound.textContent = icon;
    els.btnGameSound.textContent = icon;
  }
  updateSoundIcons();

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2400);
  }

  function showHomeError(msg) {
    if (!msg) {
      els.homeError.hidden = true;
      return;
    }
    els.homeError.textContent = msg;
    els.homeError.hidden = false;
    window.UnoSound.playError();
  }

  function switchView(name) {
    els.viewHome.classList.toggle('active', name === 'home');
    els.viewLobby.classList.toggle('active', name === 'lobby');
    els.viewGame.classList.toggle('active', name === 'game');
  }

  function getPlayerName() {
    const clean = els.inputName.value.trim().slice(0, 18);
    if (clean) localStorage.setItem('uno_player_name', clean);
    return clean;
  }

  function saveSession(code, playerId) {
    sessionStorage.setItem('uno_session', JSON.stringify({ code, playerId }));
  }

  function clearSession() {
    sessionStorage.removeItem('uno_session');
  }

  function colorThai(color) {
    switch (color) {
      case 'red': return 'แดง';
      case 'blue': return 'น้ำเงิน';
      case 'green': return 'เขียว';
      case 'yellow': return 'เหลือง';
      default: return '-';
    }
  }

  function cardSymbol(value) {
    switch (value) {
      case 'skip': return '⊘';
      case 'reverse': return '⇄';
      case 'draw2': return '+2';
      case 'wild': return '★';
      case 'wild4': return '+4';
      default: return value;
    }
  }

  function createCardElement(card) {
    const div = document.createElement('div');
    div.className = `card card-${card.color}`;
    const sym = cardSymbol(card.value);

    const tl = document.createElement('span');
    tl.className = 'card-corner tl';
    tl.textContent = sym;

    const oval = document.createElement('div');
    oval.className = card.color === 'wild' ? 'card-oval wild-oval' : 'card-oval';

    const center = document.createElement('span');
    center.className = 'card-center';
    center.textContent = sym;
    oval.appendChild(center);

    const br = document.createElement('span');
    br.className = 'card-corner br';
    br.textContent = sym;

    div.append(tl, oval, br);
    return div;
  }

  function renderChatList(container, messages) {
    container.innerHTML = '';
    messages.forEach((m) => appendChatItem(container, m));
    container.scrollTop = container.scrollHeight;
  }

  function appendChatItem(container, msg) {
    const row = document.createElement('div');
    row.className = 'chat-msg';
    const author = document.createElement('span');
    author.className = 'chat-msg-author';
    author.textContent = `${msg.avatar || ''} ${msg.name}:`;
    const body = document.createTextNode(' ' + msg.text);
    row.append(author, body);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  function renderState(nextState) {
    state = nextState;
    if (!state || !state.me) {
      switchView('home');
      return;
    }

    // Play event sound once per new event seq
    if (state.lastEvent && state.lastEvent.seq > lastPlayedEventSeq) {
      lastPlayedEventSeq = state.lastEvent.seq;
      const t = state.lastEvent.type;
      if (t === 'win') window.UnoSound.playWin();
      else if (t === 'uno' || t === 'catch_uno') window.UnoSound.playUno();
      else if (['skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(t)) window.UnoSound.playSpecial();
      else if (t === 'play') window.UnoSound.playCard();
      else if (['draw', 'draw_playable', 'penalty_draw'].includes(t)) window.UnoSound.playDraw();
    }

    if (state.status === 'lobby') {
      els.modalWinner.hidden = true;
      els.modalWild.hidden = true;
      switchView('lobby');
      renderLobby();
    } else {
      switchView('game');
      renderGame();
    }
  }

  function renderLobby() {
    const isHost = state.me.isHost;
    els.lobbyRoomPill.textContent = `ห้อง ${state.code}`;
    els.lobbyCodeBig.textContent = state.code;
    els.lobbyPlayerCount.textContent = String(state.players.length);

    els.btnAddBot.hidden = !isHost || state.players.length >= state.settings.maxPlayers;
    els.toggleStackDraw.checked = Boolean(state.settings.stackDraw);
    els.toggleStackDraw.disabled = !isHost;

    els.btnStartGame.hidden = !isHost;
    els.btnStartGame.disabled = state.players.length < 2;
    els.lobbyWaitMsg.hidden = isHost;

    els.lobbyPlayerList.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      li.className = 'player-item';

      const info = document.createElement('div');
      info.className = 'player-item-info';

      const av = document.createElement('span');
      av.className = 'player-avatar';
      av.textContent = p.avatar;

      const textWrap = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'player-name';
      nameEl.textContent = p.name + (p.id === state.me.id ? ' (คุณ)' : '');

      const badges = document.createElement('div');
      badges.className = 'player-badges';
      if (p.isHost) {
        const b = document.createElement('span');
        b.className = 'badge-tag badge-host';
        b.textContent = 'หัวหน้าห้อง';
        badges.appendChild(b);
      }
      if (p.isBot) {
        const b = document.createElement('span');
        b.className = 'badge-tag';
        b.textContent = 'AI Bot';
        badges.appendChild(b);
      }
      if (p.score > 0) {
        const b = document.createElement('span');
        b.className = 'badge-tag';
        b.textContent = `${p.score} แต้ม`;
        badges.appendChild(b);
      }

      textWrap.append(nameEl, badges);
      info.append(av, textWrap);
      li.appendChild(info);

      if (isHost && p.id !== state.me.id) {
        const kick = document.createElement('button');
        kick.className = 'kick-btn';
        kick.type = 'button';
        kick.title = 'นำออกจากห้อง';
        kick.textContent = '✕';
        kick.addEventListener('click', () => {
          socket.emit('room:removePlayer', { targetId: p.id });
        });
        li.appendChild(kick);
      }

      els.lobbyPlayerList.appendChild(li);
    }

    renderChatList(els.lobbyChatLog, state.chat || []);
  }

  function renderGame() {
    els.gameRoomPill.textContent = `ห้อง ${state.code}`;
    els.gameRoundChip.textContent = `รอบที่ ${state.roundNumber}`;
    els.gameDirChip.textContent = state.direction === 1 ? '↻ ตามเข็ม' : '↺ ทวนเข็ม';

    // Opponents strip (ordered starting after viewer)
    const myIdx = state.players.findIndex((p) => p.id === state.me.id);
    const orderedOthers = [];
    for (let i = 1; i < state.players.length; i++) {
      orderedOthers.push(state.players[(myIdx + i) % state.players.length]);
    }

    els.opponentsRow.innerHTML = '';
    for (const p of orderedOthers) {
      const seat = document.createElement('div');
      seat.className = 'seat-card';
      if (p.id === state.currentPlayerId && state.status === 'playing') seat.classList.add('is-turn');
      if (!p.connected) seat.classList.add('disconnected');

      const top = document.createElement('div');
      top.className = 'seat-top';
      const av = document.createElement('span');
      av.textContent = p.avatar;
      const nm = document.createElement('span');
      nm.className = 'seat-name';
      nm.textContent = p.name;
      top.append(av, nm);

      const pill = document.createElement('div');
      pill.className = 'seat-cards-pill';
      pill.textContent = `🃏 ${p.cardCount}`;

      seat.append(top, pill);

      if (p.unoSafe) {
        const tag = document.createElement('span');
        tag.className = 'seat-uno-tag';
        tag.textContent = 'UNO!';
        seat.appendChild(tag);
      } else if (state.catchablePlayerIds.includes(p.id)) {
        const catchBtn = document.createElement('button');
        catchBtn.className = 'btn-catch-uno';
        catchBtn.type = 'button';
        catchBtn.textContent = 'จับได้! (+2)';
        catchBtn.addEventListener('click', () => {
          socket.emit('game:catchUno', { targetId: p.id }, (res) => {
            if (res && !res.ok) showToast(res.error);
          });
        });
        seat.appendChild(catchBtn);
      }

      els.opponentsRow.appendChild(seat);
    }

    // Event banner
    if (state.lastEvent && state.lastEvent.text) {
      els.eventBanner.textContent = state.lastEvent.text;
    }

    // Piles
    els.drawPileCount.textContent = String(state.drawPileCount);
    const isMyTurn = state.status === 'playing' && state.currentPlayerId === state.me.id;
    const canDraw = isMyTurn && !state.me.canPass;
    els.btnDrawPile.disabled = !canDraw;
    els.btnDrawPile.classList.toggle(
      'highlight-draw',
      canDraw && (state.me.playableIds.length === 0 || state.pendingDraw > 0)
    );

    if (state.pendingDraw > 0) {
      els.pendingDrawBadge.textContent = `+${state.pendingDraw}`;
      els.pendingDrawBadge.hidden = false;
    } else {
      els.pendingDrawBadge.hidden = true;
    }

    // Active color ring & discard card
    els.activeColorRing.className = `active-color-ring color-${state.activeColor}`;
    els.activeColorLabel.textContent = colorThai(state.activeColor);
    els.discardCardMount.innerHTML = '';
    if (state.topCard) {
      els.discardCardMount.appendChild(createCardElement(state.topCard));
    }

    // Turn indicator & buttons
    const currentPlayer = state.players.find((p) => p.id === state.currentPlayerId);
    if (state.status === 'finished') {
      els.turnIndicator.textContent = 'จบรอบแล้ว!';
      els.turnIndicator.classList.remove('my-turn');
    } else if (isMyTurn) {
      if (state.pendingDraw > 0) {
        els.turnIndicator.textContent =
          state.me.playableIds.length > 0
            ? `ตาของคุณ! ต่อการ์ด + หรือแตะกองจั่ว (+${state.pendingDraw})`
            : `ตาของคุณ! แตะกองจั่วเพื่อรับการ์ด +${state.pendingDraw}`;
      } else if (state.me.canPass) {
        els.turnIndicator.textContent = 'จั่วได้การ์ดที่ลงได้! เลือกลงเลยหรือกดผ่านตา';
      } else {
        els.turnIndicator.textContent = 'ตาของคุณ! เลือกการ์ดลงหรือจั่วจากกอง';
      }
      els.turnIndicator.classList.add('my-turn');
    } else {
      els.turnIndicator.textContent = currentPlayer ? `รอตาของ ${currentPlayer.name}...` : 'รอตาต่อไป...';
      els.turnIndicator.classList.remove('my-turn');
    }

    els.btnPassTurn.hidden = !state.me.canPass;
    els.btnShoutUno.disabled = !state.me.canShoutUno;

    // Hand
    renderHand();

    // Chat log
    renderChatList(els.gameChatLog, state.chat || []);

    // Winner Modal
    if (state.status === 'finished') {
      renderWinnerModal();
    } else {
      els.modalWinner.hidden = true;
    }
  }

  function renderHand() {
    const playableSet = new Set(state.me.playableIds || []);
    const sortedHand = state.me.hand.slice().sort((a, b) => {
      const order = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
      if (order[a.color] !== order[b.color]) return order[a.color] - order[b.color];
      return a.value.localeCompare(b.value);
    });

    els.playerHand.innerHTML = '';
    for (const card of sortedHand) {
      const isPlayable = playableSet.has(card.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hand-card-btn ${isPlayable ? 'playable' : 'unplayable'}`;
      if (state.drawnCardId && state.drawnCardId === card.id) {
        btn.classList.add('drawn-focus');
      }
      btn.appendChild(createCardElement(card));

      if (isPlayable) {
        btn.addEventListener('click', () => onCardClick(card));
      }

      els.playerHand.appendChild(btn);
    }
  }

  function onCardClick(card) {
    if (card.color === 'wild') {
      pendingWildCardId = card.id;
      els.modalWild.hidden = false;
      return;
    }
    socket.emit('game:play', { cardId: card.id }, (res) => {
      if (res && !res.ok) {
        showToast(res.error);
        window.UnoSound.playError();
      }
    });
  }

  function renderWinnerModal() {
    const winner = state.players.find((p) => p.id === state.winnerId);
    els.winnerTitle.textContent = winner ? `${winner.avatar} ${winner.name} ชนะรอบที่ ${state.roundNumber}!` : 'จบรอบแล้ว!';
    els.winnerSubtitle.textContent = state.lastEvent ? state.lastEvent.text : '';

    const ranked = state.players.slice().sort((a, b) => b.score - a.score);
    els.scoreboardBody.innerHTML = '';
    for (const p of ranked) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = `${p.avatar} ${p.name}` + (p.id === state.winnerId ? ' 🏆' : '');
      const tdCards = document.createElement('td');
      tdCards.textContent = p.cardCount === 0 ? 'หมดมือ' : `${p.cardCount} ใบ (${p.roundHandPoints} แต้ม)`;
      const tdScore = document.createElement('td');
      tdScore.textContent = `${p.score} แต้ม`;
      tr.append(tdName, tdCards, tdScore);
      els.scoreboardBody.appendChild(tr);
    }

    els.winnerHostActions.hidden = !state.me.isHost;
    els.winnerGuestWait.hidden = state.me.isHost;
    els.modalWinner.hidden = false;
  }

  function spawnEmote(name, emoji) {
    const tag = document.createElement('div');
    tag.className = 'floating-emote';
    tag.style.left = `${28 + Math.random() * 44}%`;
    tag.innerHTML = `${emoji} <span></span>`;
    tag.querySelector('span').textContent = name;
    els.emoteLayer.appendChild(tag);
    setTimeout(() => tag.remove(), 2000);
  }

  // ==================== UI EVENT LISTENERS ====================

  els.btnCreate.addEventListener('click', () => {
    showHomeError('');
    const name = getPlayerName();
    if (!name) return showHomeError('กรุณาใส่ชื่อผู้เล่นก่อนสร้างห้อง');
    socket.emit('room:create', { name }, (res) => {
      if (!res || !res.ok) return showHomeError(res?.error || 'สร้างห้องไม่สำเร็จ');
      saveSession(res.code, res.playerId);
      window.history.replaceState({}, '', `?room=${res.code}`);
      renderState(res.state);
    });
  });

  els.btnJoin.addEventListener('click', () => {
    showHomeError('');
    const name = getPlayerName();
    const code = els.inputCode.value.trim().toUpperCase();
    if (!name) return showHomeError('กรุณาใส่ชื่อผู้เล่นก่อนเข้าห้อง');
    if (code.length < 4) return showHomeError('กรุณากรอกรหัสห้อง 4 ตัวอักษร');
    socket.emit('room:join', { code, name }, (res) => {
      if (!res || !res.ok) return showHomeError(res?.error || 'เข้าห้องไม่สำเร็จ');
      saveSession(res.code, res.playerId);
      window.history.replaceState({}, '', `?room=${res.code}`);
      renderState(res.state);
    });
  });

  els.inputCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnJoin.click();
  });

  els.btnCopyCode.addEventListener('click', () => {
    if (!state) return;
    navigator.clipboard?.writeText(state.code).then(() => showToast(`คัดลอกรหัสห้อง ${state.code} แล้ว`));
  });

  els.btnCopyLink.addEventListener('click', () => {
    if (!state) return;
    const invite = `${window.location.origin}/?room=${state.code}`;
    navigator.clipboard?.writeText(invite).then(() => showToast('คัดลอกลิงก์ชวนเพื่อนแล้ว!'));
  });

  els.btnAddBot.addEventListener('click', () => {
    socket.emit('room:addBot', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  els.toggleStackDraw.addEventListener('change', () => {
    socket.emit('room:settings', { stackDraw: els.toggleStackDraw.checked });
  });

  els.btnStartGame.addEventListener('click', () => {
    socket.emit('game:start', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  function leaveRoom() {
    socket.emit('room:leave');
    clearSession();
    state = null;
    els.modalWinner.hidden = true;
    els.modalWild.hidden = true;
    els.gameChatDrawer.hidden = true;
    window.history.replaceState({}, '', '/');
    switchView('home');
  }

  els.btnLobbyLeave.addEventListener('click', leaveRoom);
  els.btnGameLeave.addEventListener('click', leaveRoom);

  const toggleSound = () => {
    const muted = window.UnoSound.toggleMute();
    updateSoundIcons();
    showToast(muted ? 'ปิดเสียงเอฟเฟกต์แล้ว' : 'เปิดเสียงเอฟเฟกต์แล้ว');
  };
  els.btnLobbySound.addEventListener('click', toggleSound);
  els.btnGameSound.addEventListener('click', toggleSound);

  els.btnDrawPile.addEventListener('click', () => {
    socket.emit('game:draw', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  els.btnPassTurn.addEventListener('click', () => {
    socket.emit('game:pass', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  els.btnShoutUno.addEventListener('click', () => {
    socket.emit('game:uno', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  document.querySelectorAll('.color-pick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const chosenColor = btn.dataset.color;
      const cardId = pendingWildCardId;
      pendingWildCardId = null;
      els.modalWild.hidden = true;
      if (!cardId) return;
      socket.emit('game:play', { cardId, chosenColor }, (res) => {
        if (res && !res.ok) {
          showToast(res.error);
          window.UnoSound.playError();
        }
      });
    });
  });

  els.btnCancelWild.addEventListener('click', () => {
    pendingWildCardId = null;
    els.modalWild.hidden = true;
  });

  els.btnRematch.addEventListener('click', () => {
    socket.emit('game:start', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  els.btnBackLobby.addEventListener('click', () => {
    socket.emit('game:returnLobby', {}, (res) => {
      if (res && !res.ok) showToast(res.error);
    });
  });

  function bindChatForm(form, input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      socket.emit('room:chat', { text });
      input.value = '';
    });
  }
  bindChatForm(els.lobbyChatForm, els.lobbyChatInput);
  bindChatForm(els.gameChatForm, els.gameChatInput);

  els.btnToggleChat.addEventListener('click', () => {
    const opening = els.gameChatDrawer.hidden;
    els.gameChatDrawer.hidden = !opening;
    if (opening) {
      els.chatUnreadDot.hidden = true;
      els.gameChatLog.scrollTop = els.gameChatLog.scrollHeight;
    }
  });

  els.btnCloseChat.addEventListener('click', () => {
    els.gameChatDrawer.hidden = true;
  });

  document.querySelectorAll('.emote-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('room:emote', { emoji: btn.dataset.emoji });
    });
  });

  // ==================== SOCKET LISTENERS ====================

  socket.on('connect', () => {
    const raw = sessionStorage.getItem('uno_session');
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved.code && saved.playerId) {
          socket.emit('room:join', {
            code: saved.code,
            playerId: saved.playerId,
            name: getPlayerName()
          }, (res) => {
            if (res && res.ok) {
              renderState(res.state);
            } else {
              clearSession();
            }
          });
        }
      } catch {
        clearSession();
      }
    }
  });

  socket.on('room:state', (nextState) => {
    renderState(nextState);
  });

  socket.on('room:chatMessage', (msg) => {
    if (state) {
      state.chat = state.chat || [];
      state.chat.push(msg);
    }
    appendChatItem(els.lobbyChatLog, msg);
    appendChatItem(els.gameChatLog, msg);
    if (state && state.status !== 'lobby' && els.gameChatDrawer.hidden) {
      els.chatUnreadDot.hidden = false;
    }
  });

  socket.on('room:emoteBroadcast', ({ name, emoji }) => {
    spawnEmote(name, emoji);
  });

  socket.on('room:kicked', ({ message }) => {
    clearSession();
    state = null;
    switchView('home');
    showToast(message || 'คุณถูกนำออกจากห้อง');
  });
})();
