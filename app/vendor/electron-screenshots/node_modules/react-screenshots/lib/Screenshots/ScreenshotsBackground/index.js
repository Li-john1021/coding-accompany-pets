import { jsx, jsxs } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import useBounds from "../hooks/useBounds.js";
import useStore from "../hooks/useStore.js";
import ScreenshotsMagnifier from "../ScreenshotsMagnifier/index.js";
import getBoundsByPoints from "./getBoundsByPoints.js";
import "./index.css";
const Screenshots_ScreenshotsBackground = /*#__PURE__*/ memo(function() {
    const { url, image, width, height } = useStore();
    const [bounds, boundsDispatcher] = useBounds();
    const elRef = useRef(null);
    const pointRef = useRef(null);
    const isMoveRef = useRef(false);
    const [position, setPosition] = useState(null);
    const updateBounds = useCallback((p1, p2)=>{
        if (!elRef.current) return;
        const { x, y } = elRef.current.getBoundingClientRect();
        boundsDispatcher.set(getBoundsByPoints({
            x: p1.x - x,
            y: p1.y - y
        }, {
            x: p2.x - x,
            y: p2.y - y
        }, width, height));
    }, [
        width,
        height,
        boundsDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (pointRef.current || bounds || 0 !== e.button) return;
        pointRef.current = {
            x: e.clientX,
            y: e.clientY
        };
        isMoveRef.current = false;
    }, [
        bounds
    ]);
    useEffect(()=>{
        const onPointerMove = (e)=>{
            if (elRef.current) {
                const rect = elRef.current.getBoundingClientRect();
                e.clientX < rect.left || e.clientY < rect.top || e.clientX > rect.right || e.clientY > rect.bottom ? setPosition(null) : setPosition({
                    x: e.clientX - rect.x,
                    y: e.clientY - rect.y
                });
            }
            if (!pointRef.current) return;
            updateBounds(pointRef.current, {
                x: e.clientX,
                y: e.clientY
            });
            isMoveRef.current = true;
        };
        const onPointerUp = (e)=>{
            if (!pointRef.current) return;
            if (isMoveRef.current) updateBounds(pointRef.current, {
                x: e.clientX,
                y: e.clientY
            });
            pointRef.current = null;
            isMoveRef.current = false;
        };
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return ()=>{
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [
        updateBounds
    ]);
    useLayoutEffect(()=>{
        if (!image || bounds) setPosition(null);
    }, [
        image,
        bounds
    ]);
    if (!url || !image) return null;
    return /*#__PURE__*/ jsxs("div", {
        ref: elRef,
        className: "screenshots-background",
        onPointerDown: onPointerDown,
        children: [
            /*#__PURE__*/ jsx("img", {
                className: "screenshots-background-image",
                src: url
            }),
            /*#__PURE__*/ jsx("div", {
                className: "screenshots-background-mask"
            }),
            position && !bounds && /*#__PURE__*/ jsx(ScreenshotsMagnifier, {
                x: position?.x,
                y: position?.y
            })
        ]
    });
});
export { Screenshots_ScreenshotsBackground as default };
