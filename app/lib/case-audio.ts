let context: AudioContext | null = null;

export function primeCaseAudio() {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  context ||= new AudioContextClass();
  void context.resume();
}

export function playCaseTick(progress: number, muted: boolean, landing = false) {
  if (muted || !context || context.state !== "running") return;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(landing ? 210 : 690 - Math.min(1, progress) * 250, now);
  gain.gain.setValueAtTime(landing ? 0.045 : 0.018, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (landing ? 0.07 : 0.025));
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (landing ? 0.075 : 0.03));
}
