import { jsx } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";
import useCanvasContextRef from "../../hooks/useCanvasContextRef.js";
import useCanvasPointerDown from "../../hooks/useCanvasPointerDown.js";
import useCanvasPointerMove from "../../hooks/useCanvasPointerMove.js";
import useCanvasPointerUp from "../../hooks/useCanvasPointerUp.js";
import useCursor from "../../hooks/useCursor.js";
import useDrawSelect from "../../hooks/useDrawSelect.js";
import useHistory from "../../hooks/useHistory.js";
import useLang from "../../hooks/useLang.js";
import useOperation from "../../hooks/useOperation.js";
import ScreenshotsButton from "../../ScreenshotsButton/index.js";
import ScreenshotsSizeColor from "../../ScreenshotsSizeColor/index.js";
import { HistoryItemType } from "../../types.js";
import { isHit, isHitCircle } from "../utils.js";
import draw, { getEditedRectangleData } from "./draw.js";
var Rectangle_RectangleEditType = /*#__PURE__*/ function(RectangleEditType) {
    RectangleEditType[RectangleEditType["Move"] = 0] = "Move";
    RectangleEditType[RectangleEditType["ResizeTop"] = 1] = "ResizeTop";
    RectangleEditType[RectangleEditType["ResizeRightTop"] = 2] = "ResizeRightTop";
    RectangleEditType[RectangleEditType["ResizeRight"] = 3] = "ResizeRight";
    RectangleEditType[RectangleEditType["ResizeRightBottom"] = 4] = "ResizeRightBottom";
    RectangleEditType[RectangleEditType["ResizeBottom"] = 5] = "ResizeBottom";
    RectangleEditType[RectangleEditType["ResizeLeftBottom"] = 6] = "ResizeLeftBottom";
    RectangleEditType[RectangleEditType["ResizeLeft"] = 7] = "ResizeLeft";
    RectangleEditType[RectangleEditType["ResizeLeftTop"] = 8] = "ResizeLeftTop";
    return RectangleEditType;
}({});
function Rectangle() {
    const lang = useLang();
    const [history, historyDispatcher] = useHistory();
    const [operation, operationDispatcher] = useOperation();
    const [, cursorDispatcher] = useCursor();
    const canvasContextRef = useCanvasContextRef();
    const [size, setSize] = useState(3);
    const [color, setColor] = useState('#ee5126');
    const rectangleRef = useRef(null);
    const rectangleEditRef = useRef(null);
    const checked = 'Rectangle' === operation;
    const selectRectangle = useCallback(()=>{
        operationDispatcher.set('Rectangle');
        cursorDispatcher.set('crosshair');
    }, [
        operationDispatcher,
        cursorDispatcher
    ]);
    const onSelectRectangle = useCallback(()=>{
        if (checked) return;
        selectRectangle();
        historyDispatcher.clearSelect();
    }, [
        checked,
        selectRectangle,
        historyDispatcher
    ]);
    const onDrawSelect = useCallback((action, e)=>{
        if ('Rectangle' !== action.name || !canvasContextRef.current) return;
        const source = action;
        selectRectangle();
        const { x1, y1, x2, y2 } = getEditedRectangleData(source);
        let type = 0;
        if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: (x1 + x2) / 2,
            y: y1
        })) type = 1;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x2,
            y: y1
        })) type = 2;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x2,
            y: (y1 + y2) / 2
        })) type = 3;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x2,
            y: y2
        })) type = 4;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: (x1 + x2) / 2,
            y: y2
        })) type = 5;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x1,
            y: y2
        })) type = 6;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x1,
            y: (y1 + y2) / 2
        })) type = 7;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x1,
            y: y1
        })) type = 8;
        rectangleEditRef.current = {
            type: HistoryItemType.Edit,
            data: {
                type,
                x1: e.clientX,
                y1: e.clientY,
                x2: e.clientX,
                y2: e.clientY
            },
            source: action
        };
        historyDispatcher.select(action);
    }, [
        canvasContextRef,
        selectRectangle,
        historyDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (!checked || !canvasContextRef.current || rectangleRef.current) return;
        const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
        const x = e.clientX - left;
        const y = e.clientY - top;
        rectangleRef.current = {
            name: 'Rectangle',
            type: HistoryItemType.Source,
            data: {
                size,
                color,
                x1: x,
                y1: y,
                x2: x,
                y2: y
            },
            editHistory: [],
            draw: draw,
            isHit: isHit
        };
    }, [
        checked,
        size,
        color,
        canvasContextRef
    ]);
    const onPointerMove = useCallback((e)=>{
        if (!checked || !canvasContextRef.current) return;
        if (rectangleEditRef.current) {
            rectangleEditRef.current.data.x2 = e.clientX;
            rectangleEditRef.current.data.y2 = e.clientY;
            if (history.top !== rectangleEditRef.current) {
                rectangleEditRef.current.source.editHistory.push(rectangleEditRef.current);
                historyDispatcher.push(rectangleEditRef.current);
            } else historyDispatcher.set(history);
        } else if (rectangleRef.current) {
            const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
            const rectangleData = rectangleRef.current.data;
            rectangleData.x2 = e.clientX - left;
            rectangleData.y2 = e.clientY - top;
            if (history.top !== rectangleRef.current) historyDispatcher.push(rectangleRef.current);
            else historyDispatcher.set(history);
        }
    }, [
        checked,
        canvasContextRef,
        history,
        historyDispatcher
    ]);
    const onPointerUp = useCallback(()=>{
        if (!checked) return;
        if (rectangleRef.current) historyDispatcher.clearSelect();
        rectangleRef.current = null;
        rectangleEditRef.current = null;
    }, [
        checked,
        historyDispatcher
    ]);
    useDrawSelect(onDrawSelect);
    useCanvasPointerDown(onPointerDown);
    useCanvasPointerMove(onPointerMove);
    useCanvasPointerUp(onPointerUp);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_rectangle_title,
        icon: "icon-rectangle",
        checked: checked,
        onClick: onSelectRectangle,
        option: /*#__PURE__*/ jsx(ScreenshotsSizeColor, {
            size: size,
            color: color,
            onSizeChange: setSize,
            onColorChange: setColor
        })
    });
}
export { Rectangle_RectangleEditType as RectangleEditType, Rectangle as default };
