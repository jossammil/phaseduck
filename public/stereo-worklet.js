class StereoScope extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(64);
    this.right = new Float32Array(64);
    this.index = 0;
    this.frames = 0;
    this.stride = 0;
  }

  process(inputs) {
    const [left, right = left] = inputs[0] || [];
    if (!left?.length) return true;
    for (let sample = this.stride; sample < left.length; sample += 32) {
      this.left[this.index] = Math.max(-1, Math.min(1, left[sample]));
      this.right[this.index] = Math.max(-1, Math.min(1, right[sample]));
      this.index = (this.index + 1) % this.left.length;
    }
    this.stride = (this.stride - left.length % 32 + 32) % 32;
    this.frames += left.length;
    const interval = Math.round(sampleRate / 16);
    if (this.frames >= interval) {
      this.frames %= interval;
      const ordered = (channel) => Array.from(channel, (_, i) => channel[(this.index + i) % channel.length]);
      this.port.postMessage({ left: ordered(this.left), right: ordered(this.right) });
    }
    // The connected output remains silent. The existing playback branch owns sound.
    return true;
  }
}

registerProcessor("phase-stereo-scope", StereoScope);
