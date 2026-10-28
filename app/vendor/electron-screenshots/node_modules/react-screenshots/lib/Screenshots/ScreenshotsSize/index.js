import { jsx } from "react/jsx-runtime";
import { memo } from "react";
import "./index.css";
const Screenshots_ScreenshotsSize = /*#__PURE__*/ memo(function({ value, onChange }) {
    const sizes = [
        3,
        6,
        9
    ];
    return /*#__PURE__*/ jsx("div", {
        className: "screenshots-size",
        children: sizes.map((size)=>{
            const classNames = [
                'screenshots-size-item'
            ];
            if (size === value) classNames.push('screenshots-size-active');
            return /*#__PURE__*/ jsx("div", {
                className: classNames.join(' '),
                onClick: ()=>onChange?.(size),
                children: /*#__PURE__*/ jsx("div", {
                    className: "screenshots-size-pointer",
                    style: {
                        width: 1.8 * size,
                        height: 1.8 * size
                    }
                })
            }, size);
        })
    });
});
export { Screenshots_ScreenshotsSize as default };
