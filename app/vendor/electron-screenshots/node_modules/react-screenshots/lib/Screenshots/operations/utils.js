const CircleRadius = 4;
function drawDragCircle(ctx, x, y) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, CircleRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
}
function isHit(ctx, action, point) {
    action.draw(ctx, action);
    const { data } = ctx.getImageData(point.x, point.y, 1, 1);
    return data.some((val)=>0 !== val);
}
function isHitCircle(canvas, e, point) {
    if (!canvas) return false;
    const { left, top } = canvas.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    return (point.x - x) ** 2 + (point.y - y) ** 2 < CircleRadius ** 2;
}
export { drawDragCircle, isHit, isHitCircle };
