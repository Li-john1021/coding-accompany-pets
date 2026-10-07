// One process-lifetime registration, shared with the existing mouse side key.
function createInputDirtyGuard({ hook, markDirty, isToastPoint, onSideButton }) {
  let registered = false;
  let running = false;
  function start() {
    if (!registered) {
      hook.on('keydown', () => markDirty());
      hook.on('mousedown', (event) => {
        if (!isToastPoint(event.x, event.y)) markDirty();
        if (event.button === 4) onSideButton();
      });
      registered = true;
    }
    if (!running) { hook.start(); running = true; }
  }
  function stop() { if (running) hook.stop(); running = false; }
  return { start, stop, get running() { return running; } };
}
module.exports = { createInputDirtyGuard };
