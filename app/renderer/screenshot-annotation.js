function drawAnnotations(context, annotations, imageWidth) {
  const lineWidth = Math.max(2, Math.round(imageWidth * 0.003));
  const fontSize = Math.max(16, Math.round(imageWidth * 0.025));
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const annotation of annotations) {
    if (annotation.type === 'pen' && annotation.points.length) {
      context.strokeStyle = '#e53935';
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(annotation.points[0].x, annotation.points[0].y);
      for (const point of annotation.points.slice(1)) context.lineTo(point.x, point.y);
      if (annotation.points.length === 1) context.lineTo(annotation.points[0].x + 0.01, annotation.points[0].y + 0.01);
      context.stroke();
    } else if (annotation.type === 'text' && annotation.text) {
      context.font = `bold ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      context.textBaseline = 'top';
      context.lineWidth = Math.max(2, Math.round(lineWidth * 0.7));
      context.strokeStyle = '#ffffff';
      context.fillStyle = '#e53935';
      context.strokeText(annotation.text, annotation.x, annotation.y);
      context.fillText(annotation.text, annotation.x, annotation.y);
    }
  }
  context.restore();
}

if (typeof module !== 'undefined') module.exports = { drawAnnotations };
if (typeof window !== 'undefined') window.screenshotAnnotation = { drawAnnotations };
