const { nativeInputSession } = require('./native-input-session');
function keyEvents(chord) {
  const packets = { 'ctrl-v': [[0x11, 0x56]], 'shift-insert': [[0x10, 0x2d]], 'ctrl-shift-v': [[0x11, 0x10, 0x56]], 'ctrl-z': [[0x11, 0x5a]], 'voice-restore': [[0x11, 0x5a], [0x11, 0x56]] }[chord];
  return packets ? packets.flatMap((keys) => [...keys.map((key) => [key, 0]), ...keys.slice().reverse().map((key) => [key, 2])]) : null;
}
function sendTargetChord(chord, target, options = {}) {
  if (options.signal && options.signal.aborted) return Promise.resolve({ sent: false });
  if (['ctrl-z', 'voice-restore'].includes(chord) && (!Number.isSafeInteger(options.expectedGeneration) || typeof options.sessionId !== 'string')) return Promise.resolve({ sent: false, reason: 'guard-unavailable' });
  const events = keyEvents(chord);
  if (!events || !target || !['hwnd', 'pid', 'threadId', 'focusHwnd'].every((key) => Number.isSafeInteger(target[key]) && target[key] > 0)) return Promise.resolve({ sent: false });
  return nativeInputSession.send(events, target, options);
}
module.exports = { keyEvents, sendTargetChord };
