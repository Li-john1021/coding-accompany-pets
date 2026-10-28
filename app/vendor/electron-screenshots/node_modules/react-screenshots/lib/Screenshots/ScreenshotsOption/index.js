import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { cloneElement, memo, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScreenshotsOperationsCtx } from "../ScreenshotsOperations/index.js";
import "./index.css";
var ScreenshotsOption_Placement = /*#__PURE__*/ function(Placement) {
    Placement["Bottom"] = "bottom";
    Placement["Top"] = "top";
    return Placement;
}({});
const Screenshots_ScreenshotsOption = /*#__PURE__*/ memo(function({ open, content, children }) {
    const childrenRef = useRef(null);
    const popoverRef = useRef(null);
    const contentRef = useRef(null);
    const operationsRect = useContext(ScreenshotsOperationsCtx);
    const [placement, setPlacement] = useState("bottom");
    const [position, setPosition] = useState(null);
    const [offsetX, setOffsetX] = useState(0);
    const getPopoverEl = ()=>{
        if (!popoverRef.current) popoverRef.current = document.createElement("div");
        return popoverRef.current;
    };
    useEffect(()=>{
        const $el = getPopoverEl();
        if (open) document.body.appendChild($el);
        return ()=>{
            $el.remove();
        };
    }, [
        open
    ]);
    useEffect(()=>{
        if (!open || !operationsRect || !childrenRef.current || !contentRef.current) return;
        const childrenRect = childrenRef.current.getBoundingClientRect();
        const contentRect = contentRef.current.getBoundingClientRect();
        let currentPlacement = placement;
        let x = childrenRect.left + childrenRect.width / 2;
        let y = childrenRect.top + childrenRect.height;
        let currentOffsetX = offsetX;
        if (x + contentRect.width / 2 > operationsRect.x + operationsRect.width) {
            const ox = x;
            x = operationsRect.x + operationsRect.width - contentRect.width / 2;
            currentOffsetX = ox - x;
        }
        if (x < operationsRect.x + contentRect.width / 2) {
            const ox = x;
            x = operationsRect.x + contentRect.width / 2;
            currentOffsetX = ox - x;
        }
        if (y > window.innerHeight - contentRect.height) {
            if ("bottom" === currentPlacement) currentPlacement = "top";
            y = childrenRect.top - contentRect.height;
        }
        if (y < 0) {
            if ("top" === currentPlacement) currentPlacement = "bottom";
            y = childrenRect.top + childrenRect.height;
        }
        if (currentPlacement !== placement) setPlacement(currentPlacement);
        if (position?.x !== x || position.y !== y) setPosition({
            x,
            y
        });
        if (currentOffsetX !== offsetX) setOffsetX(currentOffsetX);
    });
    return /*#__PURE__*/ jsxs(Fragment, {
        children: [
            /*#__PURE__*/ cloneElement(children, {
                ref: childrenRef
            }),
            open && content && /*#__PURE__*/ createPortal(/*#__PURE__*/ jsxs("div", {
                ref: contentRef,
                className: "screenshots-option",
                style: {
                    visibility: position ? "visible" : "hidden",
                    transform: `translate(${position?.x ?? 0}px, ${position?.y ?? 0}px)`
                },
                "data-placement": placement,
                children: [
                    /*#__PURE__*/ jsx("div", {
                        className: "screenshots-option-container",
                        children: content
                    }),
                    /*#__PURE__*/ jsx("div", {
                        className: "screenshots-option-arrow",
                        style: {
                            marginLeft: offsetX
                        }
                    })
                ]
            }), getPopoverEl())
        ]
    });
});
export { ScreenshotsOption_Placement as Placement, Screenshots_ScreenshotsOption as default };
