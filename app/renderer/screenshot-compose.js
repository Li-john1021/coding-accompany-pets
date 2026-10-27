async function composeScreens(screens, plan) {
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const part of plan.parts) {
    const screen = screens.find((entry) => entry.id === part.id);
    if (!screen) throw new Error('missing-screen');
    const image = new Image();
    image.src = screen.dataUrl;
    await image.decode();
    context.drawImage(image,
      part.source.x, part.source.y, part.source.width, part.source.height,
      part.destination.x, part.destination.y, part.destination.width, part.destination.height);
  }
  return canvas.toDataURL('image/png');
}

if (typeof module !== 'undefined') module.exports = { composeScreens };
if (typeof window !== 'undefined') window.screenshotCompose = { composeScreens };
