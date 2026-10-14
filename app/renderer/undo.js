let token = null;
window.v2p.onUndoShow((payload) => {
  token = payload.token || null;
  document.querySelector('#message').textContent = payload.note || (payload.inserted ? '已自动粘贴，可短暂回退' : '结果已复制，可恢复原文');
  document.querySelector('#undo').hidden = !token;
  document.querySelector('#undo').disabled = false;
});
document.querySelector('#undo').addEventListener('click', async () => {
  document.querySelector('#undo').disabled = true;
  const result = await window.v2p.undo(token);
  if (!result.ok) document.querySelector('#message').textContent = result.note;
});
document.querySelector('#close').addEventListener('click', () => window.v2p.undoDismiss(token));
