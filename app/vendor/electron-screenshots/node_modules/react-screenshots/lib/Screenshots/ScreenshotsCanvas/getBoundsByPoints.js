function getBoundsByPoints({ x: x1, y: y1 }, { x: x2, y: y2 }, bounds, width, height, resizeOrMove) {
    if (x1 > x2) [x1, x2] = [
        x2,
        x1
    ];
    if (y1 > y2) [y1, y2] = [
        y2,
        y1
    ];
    if (x1 < 0) {
        x1 = 0;
        if ('move' === resizeOrMove) x2 = bounds.width;
    }
    if (x2 > width) {
        x2 = width;
        if ('move' === resizeOrMove) x1 = x2 - bounds.width;
    }
    if (y1 < 0) {
        y1 = 0;
        if ('move' === resizeOrMove) y2 = bounds.height;
    }
    if (y2 > height) {
        y2 = height;
        if ('move' === resizeOrMove) y1 = y2 - bounds.height;
    }
    return {
        x: x1,
        y: y1,
        width: Math.max(x2 - x1, 1),
        height: Math.max(y2 - y1, 1)
    };
}
export { getBoundsByPoints as default };
