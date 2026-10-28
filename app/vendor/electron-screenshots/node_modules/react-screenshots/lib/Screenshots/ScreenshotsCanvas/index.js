import { jsx, jsxs } from "react/jsx-runtime";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import useBounds from "../hooks/useBounds.js";
import useCursor from "../hooks/useCursor.js";
import useEmitter from "../hooks/useEmitter.js";
import useHistory from "../hooks/useHistory.js";
import useOperation from "../hooks/useOperation.js";
import useStore from "../hooks/useStore.js";
import { HistoryItemType } from "../types.js";
import getBoundsByPoints from "./getBoundsByPoints.js";
import getPoints from "./getPoints.js";
import "./index.css";
import isPointInDraw from "./isPointInDraw.js";
const borders = [
    "top",
    "right",
    "bottom",
    "left"
];
var ScreenshotsCanvas_ResizePoints = /*#__PURE__*/ function(ResizePoints) {
    ResizePoints["ResizeTop"] = "top";
    ResizePoints["ResizetopRight"] = "top-right";
    ResizePoints["ResizeRight"] = "right";
    ResizePoints["ResizeRightBottom"] = "right-bottom";
    ResizePoints["ResizeBottom"] = "bottom";
    ResizePoints["ResizeBottomLeft"] = "bottom-left";
    ResizePoints["ResizeLeft"] = "left";
    ResizePoints["ResizeLeftTop"] = "left-top";
    ResizePoints["Move"] = "move";
    return ResizePoints;
}({});
const resizePoints = [
    "top",
    "top-right",
    "right",
    "right-bottom",
    "bottom",
    "bottom-left",
    "left",
    "left-top"
];
const Screenshots_ScreenshotsCanvas = /*#__PURE__*/ memo(/*#__PURE__*/ forwardRef(function(_props, ref) {
    const { url, image, width, height } = useStore();
    const emitter = useEmitter();
    const [history] = useHistory();
    const [cursor] = useCursor();
    const [bounds, boundsDispatcher] = useBounds();
    const [operation] = useOperation();
    const resizeOrMoveRef = useRef(void 0);
    const pointRef = useRef(null);
    const boundsRef = useRef(null);
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const isCanResize = bounds && !history.stack.length && !operation;
    const draw = useCallback(()=>{
        if (!bounds || !ctxRef.current) return;
        const ctx = ctxRef.current;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "low";
        ctx.clearRect(0, 0, bounds.width, bounds.height);
        history.stack.slice(0, history.index + 1).forEach((item)=>{
            if (item.type === HistoryItemType.Source) item.draw(ctx, item);
        });
    }, [
        bounds,
        ctxRef,
        history
    ]);
    const onPointerDown = useCallback((e, resizeOrMove)=>{
        if (0 !== e.button || !bounds) return;
        if (operation) {
            const draw = isPointInDraw(bounds, canvasRef.current, history, e.nativeEvent);
            if (draw) emitter.emit("drawselect", draw, e.nativeEvent);
            else emitter.emit("pointerdown", e.nativeEvent);
        } else {
            resizeOrMoveRef.current = resizeOrMove;
            pointRef.current = {
                x: e.clientX,
                y: e.clientY
            };
            boundsRef.current = {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            };
        }
    }, [
        bounds,
        operation,
        emitter,
        history
    ]);
    const updateBounds = useCallback((e)=>{
        if (!resizeOrMoveRef.current || !pointRef.current || !boundsRef.current || !bounds) return;
        const points = getPoints(e, resizeOrMoveRef.current, pointRef.current, boundsRef.current);
        boundsDispatcher.set(getBoundsByPoints(points[0], points[1], bounds, width, height, resizeOrMoveRef.current));
    }, [
        width,
        height,
        bounds,
        boundsDispatcher
    ]);
    useLayoutEffect(()=>{
        if (!image || !bounds || !canvasRef.current) {
            ctxRef.current = null;
            return;
        }
        if (!ctxRef.current) ctxRef.current = canvasRef.current.getContext("2d");
        draw();
    }, [
        image,
        bounds,
        draw
    ]);
    useEffect(()=>{
        const onPointerMove = (e)=>{
            if (operation) emitter.emit("pointermove", e);
            else {
                if (!resizeOrMoveRef.current || !pointRef.current || !boundsRef.current) return;
                updateBounds(e);
            }
        };
        const onPointerUp = (e)=>{
            if (operation) emitter.emit("pointerup", e);
            else {
                if (!resizeOrMoveRef.current || !pointRef.current || !boundsRef.current) return;
                updateBounds(e);
                resizeOrMoveRef.current = void 0;
                pointRef.current = null;
                boundsRef.current = null;
            }
        };
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return ()=>{
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [
        updateBounds,
        operation,
        emitter
    ]);
    useImperativeHandle(ref, ()=>ctxRef.current);
    return /*#__PURE__*/ jsxs("div", {
        className: "screenshots-canvas",
        style: {
            width: bounds?.width || 0,
            height: bounds?.height || 0,
            transform: bounds ? `translate(${bounds.x}px, ${bounds.y}px)` : "none"
        },
        children: [
            /*#__PURE__*/ jsxs("div", {
                className: "screenshots-canvas-body",
                children: [
                    /*#__PURE__*/ jsx("img", {
                        className: "screenshots-canvas-image",
                        src: url,
                        style: {
                            width,
                            height,
                            transform: bounds ? `translate(${-bounds.x}px, ${-bounds.y}px)` : "none"
                        }
                    }),
                    /*#__PURE__*/ jsx("canvas", {
                        ref: canvasRef,
                        className: "screenshots-canvas-panel",
                        width: bounds?.width || 0,
                        height: bounds?.height || 0
                    })
                ]
            }),
            /*#__PURE__*/ jsx("div", {
                className: "screenshots-canvas-mask",
                style: {
                    cursor
                },
                onPointerDown: (e)=>onPointerDown(e, "move"),
                children: isCanResize && /*#__PURE__*/ jsxs("div", {
                    className: "screenshots-canvas-size",
                    children: [
                        bounds.width,
                        " \xd7 ",
                        bounds.height
                    ]
                })
            }),
            borders.map((border)=>/*#__PURE__*/ jsx("div", {
                    className: `screenshots-canvas-border-${border}`
                }, border)),
            isCanResize && resizePoints.map((resizePoint)=>/*#__PURE__*/ jsx("div", {
                    className: `screenshots-canvas-point-${resizePoint}`,
                    onPointerDown: (e)=>onPointerDown(e, resizePoint)
                }, resizePoint))
        ]
    });
}));
export { ScreenshotsCanvas_ResizePoints as ResizePoints, Screenshots_ScreenshotsCanvas as default };
