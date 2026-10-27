(() => {
  const bridge = window.screenshot;
  const image = document.getElementById('screen');
  const selectionNode = document.getElementById('selection');
  let init = null;
  let token = '';

  function sendPointer(event, type) {
    if (!init) return;
    bridge.pointer({ token, type, x: init.screen.bounds.x + event.clientX, y: init.screen.bounds.y + event.clientY });
  }

  bridge.onInit((payload) => {
    init = payload;
    token = payload.token;
    image.src = payload.screen.dataUrl;
  });
  bridge.onSelection((rect) => {
    if (!rect) { selectionNode.style.display = 'none'; return; }
    const local = init.screen.bounds;
    Object.assign(selectionNode.style, {
      display: 'block', left: `${rect.x - local.x}px`, top: `${rect.y - local.y}px`,
      width: `${rect.width}px`, height: `${rect.height}px`
    });
  });
  bridge.onCompose(async ({ token: requestToken, selection, plan }) => {
    try {
      const dataUrl = await window.screenshotCompose.composeScreens(init.screens, plan);
      bridge.composed({ token: requestToken, ok: true, dataUrl });
    } catch {
      bridge.composed({ token: requestToken, ok: false });
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && init) { event.preventDefault(); bridge.cancel({ token }); }
  });
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !init) return;
    sendPointer(event, 'down');
  });
  window.addEventListener('mousemove', (event) => sendPointer(event, 'move'));
  window.addEventListener('mouseup', (event) => {
    if (event.button !== 0 || !init) return;
    sendPointer(event, 'up');
  });
})();
