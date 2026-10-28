function createImageWorkflow(deps) {
  let busy = false;
  let disposed = false;
  let activeController = null;
  let stage = 'idle';
  let error = '';
  function conflicting() { try { return !!deps.isConflicting(); } catch { return true; } }

  function state() {
    let provider = null;
    try { provider = deps.getProviderStatus ? deps.getProviderStatus() : deps.getProvider(); } catch { }
    const ready = !!provider && !!String(provider.baseUrl || '').trim() && !!String(provider.model || '').trim();
    let hasImage = false;
    try { hasImage = !!deps.hasImage(); } catch { }
    const available = !disposed && !busy && !conflicting();
    const reason = !available ? '已有操作正在进行，请稍后识图' : !ready ? '请先在设置中配置识图模型' : !hasImage ? '请先截图或复制图片' : '';
    return { eligible: available && ready && hasImage, canScreenshot: available,
      hasImage, providerReady: ready, busy, stage, error, reason };
  }
  function publish() { try { deps.onState?.(state()); } catch { /* A closed UI must not strand the operation lock. */ } }
  function admitted() { return !disposed && !busy && !conflicting(); }

  async function runScreenshot() {
    if (!admitted()) return { ok: false, reason: 'busy', error: '已有操作正在进行' };
    busy = true; stage = 'capturing'; error = '';
    const controller = new AbortController(); activeController = controller; publish();
    try {
      const result = await deps.capture({ signal: controller.signal });
      if (disposed || controller.signal.aborted) return { ok: false, reason: 'cancelled' };
      return result;
    } catch (failure) {
      error = String(failure.message || failure).slice(0, 200);
      return { ok: false, reason: 'capture-failed', error };
    } finally { if (activeController === controller) activeController = null; busy = false; stage = 'idle'; publish(); }
  }

  async function recognize() {
    if (!admitted()) return { ok: false, error: '已有操作正在进行' };
    busy = true; stage = 'recognizing'; error = '';
    const controller = new AbortController(); activeController = controller;
    let provider, png;
    try {
      const selected = deps.getProvider();
      provider = selected ? { ...selected } : null;
      if (!provider || !String(provider.baseUrl || '').trim() || !String(provider.model || '').trim()) throw new Error('当前识图模型未配置');
      const image = deps.readImage();
      if (!image || !image.length) throw new Error('剪贴板中没有图片');
      png = Buffer.from(image);
    } catch (e) {
      busy = false; stage = 'idle'; error = String(e.message || e); activeController = null; publish();
      return { ok: false, error };
    }
    publish();
    try {
      const text = await deps.transcribeImage(provider, png, { signal: controller.signal });
      if (disposed || controller.signal.aborted) return { ok: false, error: '识图已取消' };
      if (typeof text !== 'string' || !text.trim()) throw new Error('识图未生成有效正文');
      deps.writeText(text);
      error = '';
      return { ok: true, text };
    } catch (e) {
      if (!disposed && !controller.signal.aborted) error = String(e.message || e).slice(0, 200);
      return { ok: false, error: error || '识图已取消' };
    } finally { if (activeController === controller) activeController = null; busy = false; stage = 'idle'; publish(); }
  }

  function dispose() { disposed = true; activeController?.abort(); }
  return { runScreenshot, recognize, state, refresh: publish, dispose, get busy() { return busy; } };
}

module.exports = { createImageWorkflow };
