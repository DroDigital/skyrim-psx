// Fully procedural audio: every sound is synthesised with WebAudio at runtime —
// no sample files. A generated impulse response gives the whole mix a cold, cavernous reverb,
// and a slow generative drone + pentatonic motif plays as ambient score.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.sfx.connect(this.reverbSend);

    this.noiseBuf = this._noise(2);
    this._startWind();
    this._startMusic();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  _noise(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(bp.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.03;
    lfo2.connect(lfo2G).connect(g.gain);
    src.connect(bp).connect(g).connect(this.master);
    src.start(); lfo.start(); lfo2.start();
    this.windGain = g;
  }
  setWind(level) { if (this.windGain) this.windGain.gain.setTargetAtTime(0.03 + level * 0.12, this.ctx.currentTime, 0.8); }

  _startMusic() {
    const ctx = this.ctx;
    this.music = ctx.createGain(); this.music.gain.value = 0.0;
    this.music.connect(this.master); this.music.connect(this.reverbSend);
    this.music.gain.setTargetAtTime(0.16, ctx.currentTime, 4);
    // drone: D2 + A2 detuned saws through a slow lowpass
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03; const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(lp.frequency); lfo.start();
    for (const [f, det] of [[73.42, -6], [73.42, 7], [110, 3], [146.83, -4]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.18; o.connect(g).connect(lp); o.start();
    }
    lp.connect(this.music);
    // sparse pentatonic motif
    const scale = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46];
    const play = () => {
      if (!this.ctx) return;
      if (this.musicOn) {
        const n = 1 + Math.floor(Math.random() * 3);
        let t = ctx.currentTime + 0.1;
        for (let i = 0; i < n; i++) {
          this._pluck(scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 0.5 : 1), t, 0.07);
          t += 0.6 + Math.random() * 0.9;
        }
      }
      setTimeout(play, 6000 + Math.random() * 9000);
    };
    setTimeout(play, 4000);
  }
  _pluck(freq, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o.connect(g); o2.connect(g2).connect(g); g.connect(this.music);
    o.start(t); o2.start(t); o.stop(t + 3.6); o2.stop(t + 3.6);
  }

  // ---------- one-shot helpers ----------
  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _noiseBurst({ freq = 1000, q = 1, type = 'bandpass', vol = 0.3, a = 0.005, d = 0.2, sweep = 0, pan = 0, rate = 1 }) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + a + d);
    const g = ctx.createGain(); this._env(g, t, a, vol, d);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(f).connect(g);
    if (p) { p.pan.value = pan; g.connect(p).connect(this.sfx); } else g.connect(this.sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + a + d + 0.05);
  }
  _tone({ freq = 440, type = 'sine', vol = 0.2, a = 0.01, d = 0.3, slide = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + a + d);
    const g = ctx.createGain(); this._env(g, t, a, vol, d);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + a + d + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    const v = opts.vol ?? 1, pan = opts.pan ?? 0;
    switch (name) {
      case 'swing': this._noiseBurst({ freq: 900, q: 1.4, vol: 0.25 * v, a: 0.04, d: 0.18, sweep: 2.8, pan }); break;
      case 'swingHeavy': this._noiseBurst({ freq: 500, q: 1.2, vol: 0.35 * v, a: 0.08, d: 0.3, sweep: 3, pan }); break;
      case 'hit':
        this._noiseBurst({ freq: 300, q: 0.7, type: 'lowpass', vol: 0.55 * v, a: 0.002, d: 0.16, pan });
        this._tone({ freq: 140, type: 'square', vol: 0.12 * v, d: 0.12, slide: 0.5 });
        break;
      case 'clang':
        this._tone({ freq: 1240, type: 'triangle', vol: 0.12 * v, d: 0.5 });
        this._tone({ freq: 1873, type: 'sine', vol: 0.08 * v, d: 0.4 });
        this._noiseBurst({ freq: 3000, q: 2, vol: 0.2 * v, d: 0.08, pan });
        break;
      case 'hurt': this._tone({ freq: 220, type: 'sawtooth', vol: 0.18, d: 0.25, slide: 0.6 }); this._noiseBurst({ freq: 400, vol: 0.3, d: 0.2, type: 'lowpass' }); break;
      case 'step': this._noiseBurst({ freq: opts.snow ? 2400 : 700, q: 0.8, type: opts.snow ? 'highpass' : 'bandpass', vol: 0.06 * v, a: 0.002, d: 0.07, pan }); break;
      case 'jump': this._noiseBurst({ freq: 500, vol: 0.08, d: 0.1 }); break;
      case 'cast':
        this._tone({ freq: 180, type: 'sawtooth', vol: 0.12, a: 0.02, d: 0.35, slide: 3 });
        this._noiseBurst({ freq: 1500, q: 0.6, vol: 0.25, a: 0.03, d: 0.35, sweep: 0.3 });
        break;
      case 'boom':
        this._noiseBurst({ freq: 900, type: 'lowpass', vol: 0.7 * v, a: 0.003, d: 0.8, sweep: 0.12, pan });
        this._tone({ freq: 70, type: 'sine', vol: 0.4 * v, d: 0.6, slide: 0.4 });
        break;
      case 'burst':
        this._tone({ freq: 90, type: 'sine', vol: 0.5, d: 0.9, slide: 0.4 });
        this._noiseBurst({ freq: 200, type: 'lowpass', vol: 0.6, a: 0.01, d: 1.0, sweep: 6 });
        this._tone({ freq: 587, type: 'triangle', vol: 0.08, d: 1.4 });
        break;
      case 'dash': this._noiseBurst({ freq: 1400, q: 0.9, vol: 0.2, a: 0.02, d: 0.2, sweep: 0.4 }); break;
      case 'pickup': this._tone({ freq: 880, type: 'triangle', vol: 0.12, d: 0.12 }); setTimeout(() => this._tone({ freq: 1320, type: 'triangle', vol: 0.1, d: 0.2 }), 70); break;
      case 'coins': for (let i = 0; i < 4; i++) setTimeout(() => this._tone({ freq: 2000 + Math.random() * 900, type: 'square', vol: 0.03, d: 0.06 }), i * 45); break;
      case 'chest': this._noiseBurst({ freq: 200, q: 3, vol: 0.3, a: 0.05, d: 0.4, sweep: 1.8 }); this._tone({ freq: 90, type: 'square', vol: 0.05, d: 0.3, slide: 1.5 }); break;
      case 'drink': for (let i = 0; i < 3; i++) setTimeout(() => this._tone({ freq: 400 + i * 80, type: 'sine', vol: 0.1, d: 0.12, slide: 1.6 }), i * 120); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'triangle', vol: 0.14, d: 0.9 }), i * 110)); break;
      case 'quest': [392, 523, 659].forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'sine', vol: 0.14, d: 1.4 }), i * 160)); break;
      case 'ui': this._tone({ freq: 660, type: 'square', vol: 0.03, d: 0.05 }); break;
      case 'growl': this._tone({ freq: 90, type: 'sawtooth', vol: 0.12 * v, a: 0.05, d: 0.5, slide: 0.7 }); this._noiseBurst({ freq: 260, vol: 0.18 * v, a: 0.05, d: 0.5, pan }); break;
      case 'howl': {
        if (!this.ctx) break;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(380, t); o.frequency.linearRampToValueAtTime(620, t + 0.6); o.frequency.linearRampToValueAtTime(560, t + 2.2); o.frequency.linearRampToValueAtTime(330, t + 3.2);
        const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg).connect(o.frequency);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + 0.5); g.gain.linearRampToValueAtTime(0.0001, t + 3.3);
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        o.connect(g).connect(p).connect(this.sfx); o.start(t); vib.start(t); o.stop(t + 3.4); vib.stop(t + 3.4);
        break;
      }
      case 'wight': this._tone({ freq: 60, type: 'sawtooth', vol: 0.12 * v, a: 0.2, d: 1.2, slide: 1.3 }); this._noiseBurst({ freq: 900, q: 6, vol: 0.12 * v, a: 0.3, d: 1, pan, sweep: 0.5 }); break;
      case 'death': this._tone({ freq: 160, type: 'sawtooth', vol: 0.2, d: 1.6, slide: 0.25 }); break;
      case 'shrine': [294, 440, 587, 880].forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'sine', vol: 0.1, d: 2 }), i * 90)); break;
      case 'arrow': this._noiseBurst({ freq: 2500, q: 4, vol: 0.12 * v, a: 0.01, d: 0.25, sweep: 0.5, pan }); break;
    }
  }
}

export const audio = new Audio();
