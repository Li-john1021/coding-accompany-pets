'use strict';

class V2pPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.samples = [];
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        if (this.count) this.samples.push(this.sum / this.count);
        this.sum = 0; this.count = 0;
        this.sendSamples();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  sendSamples() {
    if (!this.samples.length) return;
    const samples = Float32Array.from(this.samples);
    this.samples = [];
    this.port.postMessage({ type: 'pcm', samples }, [samples.buffer]);
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (output) output.fill(0);
    if (!input) return true;
    let energy = 0;
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.samples.push(this.sum / this.count);
        this.phase -= sampleRate;
        this.sum = 0;
        this.count = 0;
      }
      energy += sample * sample;
    }
    if (this.samples.length >= 4096) this.sendSamples();
    this.port.postMessage({ type: 'level', rms: Math.sqrt(energy / input.length) });
    return true;
  }
}

registerProcessor('v2p-pcm-capture', V2pPcmCapture);
