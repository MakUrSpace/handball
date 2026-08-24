/**
 * Procedural Web Audio API sound synthesizer for VR Handball.
 * Generates instant, zero-latency physical impact sounds and match chimes.
 */

export class SpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  public enabled: boolean = true;

  constructor() {
    // Initialized lazily on first user gesture / VR session
  }

  public init() {
    if (this.ctx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  public resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Front Wall impact sound: Deep rubber handball thud with court reverberation
   */
  public playFrontWallHit(speedMps: number) {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const intensity = Math.min(Math.max(speedMps / 25, 0.2), 1.0);
    const now = this.ctx.currentTime;

    // Body Oscillator (deep rubber punch)
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    const startFreq = 160 + intensity * 60;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.12);

    gain.gain.setValueAtTime(0.7 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.17);

    // Wall slap noise transient
    this.playNoiseTransient(now, 0.04, 800, 0.4 * intensity);
  }

  /**
   * Side wall / Ceiling hit sound: Lighter acoustic slap
   */
  public playSideWallHit(speedMps: number) {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const intensity = Math.min(Math.max(speedMps / 20, 0.2), 1.0);
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.09);

    gain.gain.setValueAtTime(0.5 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * Floor bounce sound: Snappy rebound click on hardwood court
   */
  public playFloorBounce(speedMps: number) {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const intensity = Math.min(Math.max(speedMps / 18, 0.15), 0.9);
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.06);

    gain.gain.setValueAtTime(0.45 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.08);

    this.playNoiseTransient(now, 0.02, 1400, 0.25 * intensity);
  }

  /**
   * Hand Strike sound: Fleshy glove/palm on rubber pop with dynamic power
   */
  public playHandStrike(speedMps: number, quality: string = 'Solid') {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const intensity = Math.min(Math.max(speedMps / 20, 0.3), 1.2);
    const now = this.ctx.currentTime;

    // Strike punch
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const isKillShot = quality === 'KillShot';
    osc.type = isKillShot ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isKillShot ? 360 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.14);

    gain.gain.setValueAtTime((isKillShot ? 0.9 : 0.65) * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.16);

    // Palm slap crack
    this.playNoiseTransient(now, 0.05, 1600, 0.5 * intensity);
  }

  /**
   * Referee Whistle
   */
  public playWhistle(isDouble: boolean = false) {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const playChirp = (delay: number) => {
      const now = (this.ctx?.currentTime || 0) + delay;
      const osc1 = this.ctx!.createOscillator();
      const osc2 = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(2850, now);
      osc2.frequency.setValueAtTime(2950, now);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain!);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.16);
      osc2.stop(now + 0.16);
    };

    playChirp(0);
    if (isDouble) playChirp(0.18);
  }

  /**
   * Fault Buzzer
   */
  public playFaultBuzzer() {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, now);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * Point Scored Chime (Major triad arpeggio)
   */
  public playPointScored() {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const now = this.ctx!.currentTime + i * 0.08;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  /**
   * Match Won Fanfare
   */
  public playGameWon() {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const chords = [
      [523.25, 659.25, 783.99],  // C
      [587.33, 739.99, 880.00],  // D
      [659.25, 830.61, 987.77],  // E
      [1046.50, 1318.51, 1567.98] // High C
    ];

    chords.forEach((chord, step) => {
      chord.forEach(freq => {
        const now = this.ctx!.currentTime + step * 0.18;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        gain.connect(this.masterGain!);

        osc.start(now);
        osc.stop(now + 0.45);
      });
    });
  }

  private playNoiseTransient(time: number, duration: number, cutoff: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    whiteNoise.start(time);
    whiteNoise.stop(time + duration);
  }
}

export const soundEngine = new SpatialAudioEngine();
