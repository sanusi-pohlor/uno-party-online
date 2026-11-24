// Lightweight Web Audio API sound synthesizer (zero external audio files)
window.UnoSound = (() => {
  let ctx = null;
  let muted = localStorage.getItem('uno_muted') === '1';

  function ensureContext() {
    if (muted) return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, duration, type = 'triangle', gainVal = 0.12, delay = 0) {
    const audio = ensureContext();
    if (!audio) return;
    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  return {
    isMuted: () => muted,
    toggleMute: () => {
      muted = !muted;
      localStorage.setItem('uno_muted', muted ? '1' : '0');
      return muted;
    },
    playCard: () => {
      tone(340, 0.09, 'triangle', 0.12);
      tone(520, 0.08, 'sine', 0.08, 0.03);
    },
    playDraw: () => {
      tone(240, 0.1, 'sine', 0.09);
      tone(190, 0.08, 'sine', 0.07, 0.04);
    },
    playSpecial: () => {
      tone(440, 0.12, 'triangle', 0.12);
      tone(660, 0.14, 'triangle', 0.12, 0.06);
    },
    playUno: () => {
      tone(587.33, 0.14, 'sawtooth', 0.11);
      tone(880, 0.24, 'triangle', 0.14, 0.1);
    },
    playWin: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((n, idx) => {
        tone(n, 0.22, 'triangle', 0.13, idx * 0.1);
      });
    },
    playError: () => {
      tone(180, 0.14, 'square', 0.07);
    }
  };
})();
