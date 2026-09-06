/** A quiet procedural music bed whose only audible pitch is 444 Hz. */
export class ToneBed {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: OscillatorNode[] = [];
  private enabled = true;

  async start() {
    if (!this.context) this.createGraph();
    if (!this.context || !this.master) return;
    await this.context.resume();
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.075 : 0, this.context.currentTime + 1.2);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(enabled ? 0.075 : 0, now + 0.35);
  }

  isEnabled() {
    return this.enabled;
  }

  private createGraph() {
    const AudioContextClass = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    // Three slowly breathing sine voices all remain at exactly 444 Hz. The
    // sub-audible LFOs only shape amplitude and never reach the output.
    [-0.55, 0, 0.55].forEach((pan, index) => {
      const voice = this.context!.createOscillator();
      const voiceGain = this.context!.createGain();
      const lfo = this.context!.createOscillator();
      const lfoDepth = this.context!.createGain();
      voice.type = 'sine';
      voice.frequency.value = 444;
      voiceGain.gain.value = 0.23;
      lfo.frequency.value = 0.045 + index * 0.017;
      lfoDepth.gain.value = 0.08;
      lfo.connect(lfoDepth);
      lfoDepth.connect(voiceGain.gain);
      voice.connect(voiceGain);

      if ('createStereoPanner' in this.context!) {
        const panner = this.context!.createStereoPanner();
        panner.pan.value = pan;
        voiceGain.connect(panner);
        panner.connect(this.master!);
      } else {
        voiceGain.connect(this.master!);
      }

      voice.start(this.context!.currentTime + index * 0.12);
      lfo.start();
      this.voices.push(voice);
    });
  }
}

export const toneBed = new ToneBed();
