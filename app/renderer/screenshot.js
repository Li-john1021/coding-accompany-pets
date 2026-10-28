(() => {
  const bridge = window.screenshot;
  const image = document.getElementById('screen');
  const selectionNode = document.getElementById('selection');
  const editor = document.getElementById('editor');
  const canvas = document.getElementById('preview');
  const context = canvas.getContext('2d');
  const textInput = document.getElementById('annotation-text');
  const tools = {
    pen: document.getElementById('pen-tool'), text: document.getElementById('text-tool'),
    undo: document.getElementById('undo-tool'), cancel: document.getElementById('cancel-tool'), done: document.getElementById('done-tool')
  };
  let init = null;
  let token = '';
  let mode = 'select';
  let tool = 'pen';
  let baseImage = null;
  let annotations = [];
  let activeStroke = null;
  let finalizing = false;

  function sendPointer(event, type) {
    if (!init || mode !== 'select') return;
    const bounds = init.screen.selectionBounds || init.screen.bounds;
    const scaleX = init.screen.selectionBounds ? bounds.width / window.innerWidth : 1;
    const scaleY = init.screen.selectionBounds ? bounds.height / window.innerHeight : 1;
    bridge.pointer({ token, type, x: bounds.x + event.clientX * scaleX, y: bounds.y + event.clientY * scaleY });
  }

  function paint() {
    if (!baseImage) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(baseImage, 0, 0);
    window.screenshotAnnotation.drawAnnotations(context, annotations, canvas.width);
  }

  function setTool(next) {
    tool = next;
    tools.pen.setAttribute('aria-pressed', String(next === 'pen'));
    tools.text.setAttribute('aria-pressed', String(next === 'text'));
    canvas.style.cursor = next === 'pen' ? 'crosshair' : 'text';
  }

  function cropPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))
    };
  }

  function finish(ok) {
    if (!init || mode !== 'edit' || finalizing) return;
    finalizing = true;
    if (ok) {
      paint();
      bridge.composed({ token, ok: true, dataUrl: canvas.toDataURL('image/png') });
    } else {
      bridge.cancel({ token });
    }
  }

  bridge.onInit(async (payload) => {
    init = payload;
    token = payload.token;
    mode = 'select';
    tool = 'pen';
    baseImage = null;
    annotations = [];
    activeStroke = null;
    finalizing = false;
    editor.classList.remove('open');
    document.body.classList.remove('editing');
    selectionNode.style.display = 'none';
    image.src = payload.screen.dataUrl;
    try {
      await image.decode();
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      if (token === payload.token) bridge.ready({ token });
    } catch {
      bridge.cancel({ token: payload.token });
    }
  });

  bridge.onSelection((rect) => {
    if (!rect || mode !== 'select') { selectionNode.style.display = 'none'; return; }
    const local = init.screen.selectionBounds || init.screen.bounds;
    const scaleX = init.screen.selectionBounds ? window.innerWidth / local.width : 1;
    const scaleY = init.screen.selectionBounds ? window.innerHeight / local.height : 1;
    Object.assign(selectionNode.style, {
      display: 'block', left: `${(rect.x - local.x) * scaleX}px`, top: `${(rect.y - local.y) * scaleY}px`,
      width: `${rect.width * scaleX}px`, height: `${rect.height * scaleY}px`
    });
  });

  bridge.onCompose(async ({ token: requestToken, plan }) => {
    if (!init || requestToken !== token || mode !== 'select') return;
    try {
      const dataUrl = await window.screenshotCompose.composeScreens(init.screens, plan);
      if (requestToken !== token || mode !== 'select') return;
      baseImage = new Image();
      baseImage.src = dataUrl;
      await baseImage.decode();
      canvas.width = plan.width;
      canvas.height = plan.height;
      annotations = [];
      mode = 'edit';
      document.body.classList.add('editing');
      editor.classList.add('open');
      setTool('pen');
      paint();
    } catch {
      bridge.composed({ token: requestToken, ok: false });
    }
  });

  tools.pen.addEventListener('click', () => setTool('pen'));
  tools.text.addEventListener('click', () => setTool('text'));
  tools.undo.addEventListener('click', () => { if (annotations.length) { annotations.pop(); paint(); } });
  tools.cancel.addEventListener('click', () => finish(false));
  tools.done.addEventListener('click', () => finish(true));
  canvas.addEventListener('pointerdown', (event) => {
    if (mode !== 'edit' || event.button !== 0) return;
    event.preventDefault();
    const point = cropPoint(event);
    if (tool === 'pen') {
      activeStroke = { type: 'pen', points: [point] };
      annotations.push(activeStroke);
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      paint();
    } else if (textInput.value.trim()) {
      annotations.push({ type: 'text', ...point, text: textInput.value.trim() });
      paint();
    } else textInput.focus();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (mode !== 'edit' || !activeStroke) return;
    activeStroke.points.push(cropPoint(event));
    paint();
  });
  const endStroke = () => { activeStroke = null; };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  window.addEventListener('keydown', (event) => {
    if (!init) return;
    if (event.key === 'Escape') { event.preventDefault(); mode === 'edit' ? finish(false) : bridge.cancel({ token }); }
    else if (mode === 'edit' && event.key === 'Enter') { event.preventDefault(); finish(true); }
    else if (mode === 'edit' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); if (annotations.length) { annotations.pop(); paint(); }
    }
  });
  window.addEventListener('mousedown', (event) => { if (event.button === 0) sendPointer(event, 'down'); });
  window.addEventListener('mousemove', (event) => sendPointer(event, 'move'));
  window.addEventListener('mouseup', (event) => { if (event.button === 0) sendPointer(event, 'up'); });
})();
