function createPetActionWorkflow(deps) {
  let busy = false;

  async function run(mode) {
    if (busy) return { ok: false, error: '已有文本操作正在进行' };
    if (mode !== 'structure' && mode !== 'optimize') return { ok: false, error: '不支持的文本操作' };
    if (deps.isVoiceBusy()) {
      deps.capture.cancel('voice-busy');
      return { ok: false, error: '录音或转写期间不可操作', capture: { kind: 'rejected', reason: 'voice-busy' } };
    }

    busy = true;
    try {
      const captured = await deps.capture.click(mode, deps.isVoiceBusy);
      if (captured.kind !== 'authorized') return deps.onCaptureResult(captured);
      if (deps.isVoiceBusy() || captured.mode !== mode || typeof captured.token !== 'string' ||
          !captured.token || typeof captured.text !== 'string' || !captured.text.trim()) {
        return deps.onCaptureResult({ kind: 'cancelled', reason: 'authorization-invalid' });
      }

      const source = captured.text;
      let result;
      try {
        result = await deps.processText(source, mode);
      } catch {
        return { ok: false, capture: { kind: 'authorized' }, error: '文本处理失败，源文本仍保留在剪贴板' };
      }

      const output = result && typeof result.text === 'string' ? result.text : '';
      if (!output.trim() || result.degraded || result.mode !== mode) {
        return {
          ok: false,
          capture: { kind: 'authorized' },
          error: (result && result.note) || '文本处理未生成有效结果，源文本仍保留在剪贴板'
        };
      }

      let copied = false;
      try {
        const current = await deps.getClipboardSnapshot();
        if (current && current.sequence === captured.clipboardSequence) {
          deps.writeClipboardText(output);
          copied = true;
        }
      } catch { /* Keep the result available through the explicit copy preview. */ }

      if (copied) return { ok: true, capture: { kind: 'authorized' }, copied: true };
      deps.showResult(output, mode);
      return { ok: true, capture: { kind: 'authorized' }, copied: false, preview: true,
        message: '剪贴板已变化或不可写，结果已打开，可显式复制' };
    } finally {
      busy = false;
    }
  }

  return { run, get busy() { return busy; } };
}

module.exports = { createPetActionWorkflow };
