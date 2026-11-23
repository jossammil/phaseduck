export function stereoFixture(kind, seconds = 8) {
  const rate = 16000;
  const frames = rate * seconds;
  const channels = kind === "mono" ? 1 : 2;
  const align = channels * 2;
  const buffer = Buffer.alloc(44 + frames * align);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * align, 28);
  buffer.writeUInt16LE(align, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * align, 40);
  for (let i = 0; i < frames; i++) {
    const angle = 2 * Math.PI * 173 * i / rate;
    const sample = Math.round(12000 * Math.sin(angle));
    const offset = 44 + i * align;
    buffer.writeInt16LE(kind === "right" ? 0 : sample, offset);
    if (channels === 2) {
      const right = kind === "left" ? 0 : kind === "opposite" ? -sample : sample;
      buffer.writeInt16LE(right, offset + 2);
    }
  }
  return { name: kind + ".wav", mimeType: "audio/wav", buffer };
}
