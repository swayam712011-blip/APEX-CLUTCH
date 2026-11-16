export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private initialized = false;

  public unlock() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.48;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Generate shared white noise buffer (2 seconds)
    const sampleRate = ctx.sampleRate;
    const bufferSize = sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;

    // Engine multi-oscillator stack
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 260;
    engFilter.Q.value = 3.2;

    const engGain = ctx.createGain();
    engGain.gain.value = 0;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 45;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 90;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 22.5;

    const g1 = ctx.createGain();
    g1.gain.value = 0.45;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    const gSub = ctx.createGain();
    gSub.gain.value = 0.55;

    osc1.connect(g1);
    osc2.connect(g2);
    sub.connect(gSub);
    g1.connect(engFilter);
    g2.connect(engFilter);
    gSub.connect(engFilter);
    engFilter.connect(engGain);
    engGain.connect(master);

    osc1.start();
    osc2.start();
    sub.start();

    this.engineOsc1 = osc1;
    this.engineOsc2 = osc2;
    this.engineSubOsc = sub;
    this.engineFilter = engFilter;
    this.engineGain = engGain;

    // Continuous tire screech noise loop
    const tireSrc = ctx.createBufferSource();
    tireSrc.buffer = buffer;
    tireSrc.loop = true;

    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 1150;
    tireFilter.Q.value = 5.5;

    const tireGain = ctx.createGain();
    tireGain.gain.value = 0;

    tireSrc.connect(tireFilter);
    tireFilter.connect(tireGain);
    tireGain.connect(master);
    tireSrc.start();

    this.tireFilter = tireFilter;
    this.tireGain = tireGain;

    // Continuous rain / storm ambiance loop
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = buffer;
    rainSrc.loop = true;

    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 1400;
    rainFilter.Q.value = 0.7;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;

    rainSrc.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    rainSrc.start();

    this.rainFilter = rainFilter;
    this.rainGain = rainGain;

    this.initialized = true;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.48, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateContinuous(
    rpm: number,
    throttle: number,
    ignitionOn: boolean,
    stalled: boolean,
    wheelSlip: number,
    speedKmh: number,
    rainIntensity = 0,
  ) {
    if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (this.rainGain && this.rainFilter) {
      const targetRain = rainIntensity > 0 ? 0.06 + rainIntensity * 0.12 : 0;
      this.rainGain.gain.setTargetAtTime(targetRain, now, 0.18);
      this.rainFilter.frequency.setTargetAtTime(1100 + rainIntensity * 1400, now, 0.2);
    }

    if (
      this.engineOsc1 &&
      this.engineOsc2 &&
      this.engineSubOsc &&
      this.engineFilter &&
      this.engineGain
    ) {
      if (!ignitionOn || stalled || rpm < 120) {
        this.engineGain.gain.setTargetAtTime(0, now, 0.05);
      } else {
        // 6-cyl/8-cyl fundamental firing frequency ~ (rpm / 60) * 1.5
        const baseFreq = Math.max(22, (rpm / 60) * 1.55);
        this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.025);
        this.engineOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.025);
        this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.025);

        const cutoff = 180 + (rpm / 8000) * 1850 + throttle * 950;
        this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.03);

        const vol = 0.14 + throttle * 0.15 + (rpm / 8000) * 0.1;
        this.engineGain.gain.setTargetAtTime(vol, now, 0.03);
      }
    }

    if (this.tireGain && this.tireFilter) {
      const slipLevel = speedKmh > 6 ? Math.max(0, wheelSlip - 0.14) : 0;
      const targetVol = Math.min(0.24, slipLevel * 0.34);
      this.tireGain.gain.setTargetAtTime(targetVol, now, 0.04);
      this.tireFilter.frequency.setTargetAtTime(980 + slipLevel * 650, now, 0.05);
    }
  }

  public playGearShiftClack() {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Two crisp metallic clicks 35ms apart for H-gate throw
    [0, 0.038].forEach((offset, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(idx === 0 ? 420 : 290, now + offset);
      osc.frequency.exponentialRampToValueAtTime(90, now + offset + 0.045);

      gain.gain.setValueAtTime(0.28, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.05);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.055);
    });
  }

  public playGearGrind() {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) {
      return;
    }
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(640, now);
    filter.Q.value = 4;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    src.connect(filter);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    src.start(now);
    osc.start(now);
    src.stop(now + 0.25);
    osc.stop(now + 0.25);
  }

  public playStarterCrank() {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.085;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(115, t);
      osc.frequency.linearRampToValueAtTime(155, t + 0.06);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.08);
    }
  }

  public playStallChug() {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(75, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.22);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playBackfire() {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) {
      return;
    }
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.14);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.16);
  }

  public playCollision(intensity: number) {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) {
      return;
    }
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.18);

    gain.gain.setValueAtTime(0.36 * Math.min(1, intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playThunder() {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) {
      return;
    }
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(160, now);
    filter.frequency.exponentialRampToValueAtTime(42, now + 1.4);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 1.65);
  }

  public dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
