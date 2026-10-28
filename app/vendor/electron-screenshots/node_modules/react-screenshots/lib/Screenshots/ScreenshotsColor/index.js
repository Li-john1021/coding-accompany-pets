import { jsx } from "react/jsx-runtime";
import { memo } from "react";
import "./index.css";
const Screenshots_ScreenshotsColor = /*#__PURE__*/ memo(function({ value, onChange }) {
    const colors = [
        '#ee5126',
        '#fceb4d',
        '#90e746',
        '#51c0fa',
        '#7a7a7a',
        '#ffffff'
    ];
    return /*#__PURE__*/ jsx("div", {
        className: "screenshots-color",
        children: colors.map((color)=>{
            const classNames = [
                'screenshots-color-item'
            ];
            if (color === value) classNames.push('screenshots-color-active');
            return /*#__PURE__*/ jsx("div", {
                className: classNames.join(' '),
                style: {
                    backgroundColor: color
                },
                onClick: ()=>onChange?.(color)
            }, color);
        })
    });
});
export { Screenshots_ScreenshotsColor as default };
