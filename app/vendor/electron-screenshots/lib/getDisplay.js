"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
exports.default = () => {
    const point = electron_1.screen.getCursorScreenPoint();
    const { id, bounds, scaleFactor } = electron_1.screen.getDisplayNearestPoint(point);
    // https://github.com/nashaofu/screenshots/issues/98
    return {
        id,
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
        scaleFactor,
    };
};
//# sourceMappingURL=getDisplay.js.map