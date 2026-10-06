(function (root) {
  root.resolvePetMouseUp = function resolvePetMouseUp(input) {
    if (input.button !== 0 || !input.bodyGestureActive) return 'ignore';
    if (input.targetInActionRow) {
      return input.triggerMode === 'hold' && input.recording ? 'stop-recording' : 'discard';
    }
    if (input.triggerMode === 'hold') {
      return input.recording ? 'stop-recording' : (!input.dragging ? 'open-settings' : 'discard');
    }
    return !input.dragging && input.elapsedMs < 500 ? 'toggle-recording' : 'discard';
  };
})(window);
