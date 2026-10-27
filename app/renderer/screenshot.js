(() => {
  const bridge = window.screenshot;
  const image = document.getElementById('screen');
  const selectionNode = document.getElementById('selection');
  let init = null;
  let token = '';

  function sendPointer(event, type) {
    if (!init) return;
    const bounds = init.screen.selectionBounds || init.screen.bounds;
    const scaleX = init.screen.selectionBounds ? bounds.width / window.innerWidth : 1;
    const scaleY = init.screen.selectionBounds ? bounds.height / window.innerHeight : 1;
    bridge.pointer({ token, type, x: bounds.x + event.clientX * scaleX, y: bounds.y + event.clientY * scaleY });
  }

  bridge.onInit((payload) => {
    init = payload;
    token = payload.token;
    image.src = payload.screen.dataUrl;
  });
  bridge.onSelection((rect) => {
    if (!rect) { selectionNode.style.display = 'none'; return; }
    const local = init.screen.selectionBounds || init.screen.bounds;
    const scaleX = init.screen.selectionBounds ? window.innerWidth / local.width : 1;
    const scaleY = init.screen.selectionBounds ? window.innerHeight / local.height : 1;
    Object.assign(selectionNode.style, {
      display: 'block', left: `${(rect.x - local.x) * scaleX}px`, top: `${(rect.y - local.y) * scaleY}px`,
      width: `${rect.width * scaleX}px`, height: `${rect.height * scaleY}px`
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
