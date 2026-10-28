import { jsx } from "react/jsx-runtime";
import { memo, useCallback } from "react";
import ScreenshotsOption from "../ScreenshotsOption/index.js";
import "./index.css";
const Screenshots_ScreenshotsButton = /*#__PURE__*/ memo(function({ title, icon, checked, disabled, option, onClick }) {
    const classNames = [
        'screenshots-button'
    ];
    const onButtonClick = useCallback((e)=>{
        if (disabled || !onClick) return;
        onClick(e);
    }, [
        disabled,
        onClick
    ]);
    if (checked) classNames.push('screenshots-button-checked');
    if (disabled) classNames.push('screenshots-button-disabled');
    return /*#__PURE__*/ jsx(ScreenshotsOption, {
        open: checked,
        content: option,
        children: /*#__PURE__*/ jsx("div", {
            className: classNames.join(' '),
            title: title,
            onClick: onButtonClick,
            children: /*#__PURE__*/ jsx("span", {
                className: icon
            })
        })
    });
});
export { Screenshots_ScreenshotsButton as default };
