const BASE_WIDTH = 300;
const BASE_HEIGHT = 306;

function boundsForScale(scale) {
  return {
    width: Math.round(BASE_WIDTH * scale),
    height: Math.round(BASE_HEIGHT * scale)
  };
}

function applyInitialZoomAfterLoad(petWindow, getScale) {
  petWindow.webContents.once('did-finish-load', () => {
    if (petWindow.isDestroyed()) return;
    petWindow.webContents.setZoomFactor(getScale());
  });
}

module.exports = { BASE_WIDTH, BASE_HEIGHT, boundsForScale, applyInitialZoomAfterLoad };
