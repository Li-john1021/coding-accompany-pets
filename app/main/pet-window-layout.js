const BASE_WIDTH = 300;
const BASE_HEIGHT = 306;

function boundsForContent(baseWidth, baseHeight, scale) {
  return {
    width: Math.round(Number(baseWidth) * scale),
    height: Math.round(Number(baseHeight) * scale)
  };
}

function boundsForScale(scale) {
  return boundsForContent(BASE_WIDTH, BASE_HEIGHT, scale);
}

function applyInitialZoomAfterLoad(petWindow, getScale) {
  petWindow.webContents.once('did-finish-load', () => {
    if (petWindow.isDestroyed()) return;
    petWindow.webContents.setZoomFactor(getScale());
  });
}

module.exports = { BASE_WIDTH, BASE_HEIGHT, boundsForContent, boundsForScale, applyInitialZoomAfterLoad };
