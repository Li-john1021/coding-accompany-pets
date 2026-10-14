function createPetActionWorkflow(deps) {
  let busy = false;
  let voiceEpoch = 0;

  function voiceStarted() {
    voiceEpoch++;
  }

  async function run(mode) {
    if (busy) return { ok: false, error: '已有文本操作正在进行' };
    if (mode !== 'structure' && mode !== 'optimize') return { ok: false, error: '不支持的文本操作' };
    if (deps.isVoiceBusy()) {
      deps.capture.cancel('voice-busy');
      return { ok: false, error: '录音或转写期间不可操作', capture: { kind: 'rejected', reason: 'voice-busy' } };
    }

    busy = true;
    const operationVoiceEpoch = voiceEpoch;
    const voiceSuperseded = () => operationVoiceEpoch !== voiceEpoch || deps.isVoiceBusy();
    const voiceCancelled = () => ({ ok: false, capture: { kind: 'cancelled', reason: 'voice-busy' }, voiceSuperseded: true });
    try {
      const captured = await deps.capture.click(mode, deps.isVoiceBusy);
      if (captured.kind !== 'authorized') return deps.onCaptureResult(captured);
      if (voiceSuperseded()) return voiceCancelled();
      if (typeof captured.text !== 'string' || !captured.text.trim()) {
        return deps.onCaptureResult({ kind: 'cancelled', reason: 'authorization-invalid' });
      }

      const source = captured.text;
      let result;
      try {
        result = await deps.processText(source, mode);
      } catch {
        if (voiceSuperseded()) return voiceCancelled();
        return { ok: false, capture: { kind: 'authorized' }, error: '文本处理失败，源文本仍保留在剪贴板' };
      }
      if (voiceSuperseded()) return voiceCancelled();

      const output = result && typeof result.text === 'string' ? result.text : '';
      if (voiceSuperseded()) return voiceCancelled();
      if (!output.trim()) return { ok: false, capture: { kind: 'authorized' }, error: '文本处理未生成有效结果' };

      let delivery = {};
      try {
        if (deps.deliver) delivery = await deps.deliver({ original: source, text: output, target: captured.target, isCurrent: () => !voiceSuperseded() });
        else await deps.writeClipboard(output);
      }
      catch {
        return { ok: false, capture: { kind: 'authorized' }, error: '结果未能写入剪贴板' };
      }
      if (voiceSuperseded()) return voiceCancelled();
      return { ok: true, capture: { kind: 'authorized' }, copied: true, ...delivery, note: [result.note, delivery.note].filter(Boolean).join('；') };
    } finally {
      busy = false;
    }
  }

  return { run, voiceStarted, get busy() { return busy; } };
}

module.exports = { createPetActionWorkflow };
