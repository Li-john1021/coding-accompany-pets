import { jsx, jsxs } from "react/jsx-runtime";
import { memo } from "react";
import ScreenshotsColor from "../ScreenshotsColor/index.js";
import ScreenshotsSize from "../ScreenshotsSize/index.js";
import "./index.css";
const Screenshots_ScreenshotsSizeColor = /*#__PURE__*/ memo(function({ size, color, onSizeChange, onColorChange }) {
    return /*#__PURE__*/ jsxs("div", {
        className: "screenshots-sizecolor",
        children: [
            /*#__PURE__*/ jsx(ScreenshotsSize, {
                value: size,
                onChange: onSizeChange
            }),
            /*#__PURE__*/ jsx(ScreenshotsColor, {
                value: color,
                onChange: onColorChange
            })
        ]
    });
});
export { Screenshots_ScreenshotsSizeColor as default };
