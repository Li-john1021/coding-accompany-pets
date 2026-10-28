import { jsx } from "react/jsx-runtime";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import calculateNodeSize from "./calculateNodeSize.js";
import "./index.css";
const Screenshots_ScreenshotsTextarea = /*#__PURE__*/ memo(function({ x, y, maxWidth, maxHeight, size, color, value, onChange, onBlur }) {
    const popoverRef = useRef(null);
    const textareaRef = useRef(null);
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    const getPopoverEl = ()=>{
        if (!popoverRef.current) popoverRef.current = document.createElement('div');
        return popoverRef.current;
    };
    useLayoutEffect(()=>{
        if (popoverRef.current) {
            document.body.appendChild(popoverRef.current);
            requestAnimationFrame(()=>{
                textareaRef.current?.focus();
            });
        }
        return ()=>{
            popoverRef.current?.remove();
        };
    }, []);
    useLayoutEffect(()=>{
        if (!textareaRef.current) return;
        const { width, height } = calculateNodeSize(textareaRef.current, value, maxWidth, maxHeight);
        setWidth(width);
        setHeight(height);
    }, [
        value,
        maxWidth,
        maxHeight
    ]);
    return /*#__PURE__*/ createPortal(/*#__PURE__*/ jsx("textarea", {
        ref: textareaRef,
        className: "screenshots-textarea",
        style: {
            color,
            width,
            height,
            maxWidth,
            maxHeight,
            fontSize: size,
            lineHeight: `${size}px`,
            transform: `translate(${x}px, ${y}px)`
        },
        value: value,
        onChange: (e)=>onChange?.(e.target.value),
        onBlur: (e)=>onBlur?.(e)
    }), getPopoverEl());
});
export { Screenshots_ScreenshotsTextarea as default };
