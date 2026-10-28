import { jsx } from "react/jsx-runtime";
import react, { memo, useCallback, useEffect, useRef, useState } from "react";
import useBounds from "../hooks/useBounds.js";
import useStore from "../hooks/useStore.js";
import operations from "../operations/index.js";
import "./index.css";
const ScreenshotsOperationsCtx = /*#__PURE__*/ react.createContext(null);
const Screenshots_ScreenshotsOperations = /*#__PURE__*/ memo(function() {
    const { width, height } = useStore();
    const [bounds] = useBounds();
    const [operationsRect, setOperationsRect] = useState(null);
    const [position, setPosition] = useState(null);
    const elRef = useRef(null);
    const onDoubleClick = useCallback((e)=>{
        e.stopPropagation();
    }, []);
    const onContextMenu = useCallback((e)=>{
        e.preventDefault();
        e.stopPropagation();
    }, []);
    useEffect(()=>{
        if (!bounds || !elRef.current) return;
        const elRect = elRef.current.getBoundingClientRect();
        let x = bounds.x + bounds.width - elRect.width;
        let y = bounds.y + bounds.height + 10;
        if (x < 0) x = 0;
        if (x > width - elRect.width) x = width - elRect.width;
        if (y > height - elRect.height) y = height - elRect.height - 10;
        if (!position || Math.abs(position.x - x) > 1 || Math.abs(position.y - y) > 1) setPosition({
            x,
            y
        });
        if (!operationsRect || Math.abs(operationsRect.x - elRect.x) > 1 || Math.abs(operationsRect.y - elRect.y) > 1 || Math.abs(operationsRect.width - elRect.width) > 1 || Math.abs(operationsRect.height - elRect.height) > 1) setOperationsRect({
            x: elRect.x,
            y: elRect.y,
            width: elRect.width,
            height: elRect.height
        });
    });
    if (!bounds) return null;
    return /*#__PURE__*/ jsx(ScreenshotsOperationsCtx.Provider, {
        value: operationsRect,
        children: /*#__PURE__*/ jsx("div", {
            ref: elRef,
            className: "screenshots-operations",
            style: {
                visibility: position ? 'visible' : 'hidden',
                transform: `translate(${position?.x ?? 0}px, ${position?.y ?? 0}px)`
            },
            onDoubleClick: onDoubleClick,
            onContextMenu: onContextMenu,
            children: /*#__PURE__*/ jsx("div", {
                className: "screenshots-operations-buttons",
                children: operations.map((OperationButton, index)=>{
                    if ('|' === OperationButton) return /*#__PURE__*/ jsx("div", {
                        className: "screenshots-operations-divider"
                    }, index);
                    return /*#__PURE__*/ jsx(OperationButton, {}, index);
                })
            })
        })
    });
});
export { ScreenshotsOperationsCtx, Screenshots_ScreenshotsOperations as default };
