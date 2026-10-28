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
import draw, { getEditedArrowData } from "./draw.js";
var Arrow_ArrowEditType = /*#__PURE__*/ function(ArrowEditType) {
    ArrowEditType[ArrowEditType["Move"] = 0] = "Move";
    ArrowEditType[ArrowEditType["MoveStart"] = 1] = "MoveStart";
    ArrowEditType[ArrowEditType["MoveEnd"] = 2] = "MoveEnd";
    return ArrowEditType;
}({});
function Arrow() {
    const lang = useLang();
    const [, cursorDispatcher] = useCursor();
    const [operation, operationDispatcher] = useOperation();
    const [history, historyDispatcher] = useHistory();
    const canvasContextRef = useCanvasContextRef();
    const [size, setSize] = useState(3);
    const [color, setColor] = useState('#ee5126');
    const arrowRef = useRef(null);
    const arrowEditRef = useRef(null);
    const checked = 'Arrow' === operation;
    const selectArrow = useCallback(()=>{
        operationDispatcher.set('Arrow');
        cursorDispatcher.set('default');
    }, [
        operationDispatcher,
        cursorDispatcher
    ]);
    const onSelectArrow = useCallback(()=>{
        if (checked) return;
        selectArrow();
        historyDispatcher.clearSelect();
    }, [
        checked,
        selectArrow,
        historyDispatcher
    ]);
    const onDrawSelect = useCallback((action, e)=>{
        if ('Arrow' !== action.name || !canvasContextRef.current) return;
        const source = action;
        selectArrow();
        const { x1, y1, x2, y2 } = getEditedArrowData(source);
        let type = 0;
        if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x1,
            y: y1
        })) type = 1;
        else if (isHitCircle(canvasContextRef.current.canvas, e, {
            x: x2,
            y: y2
        })) type = 2;
        arrowEditRef.current = {
            type: HistoryItemType.Edit,
            data: {
                type,
                x1: e.clientX,
                y1: e.clientY,
                x2: e.clientX,
                y2: e.clientY
            },
            source
        };
        historyDispatcher.select(action);
    }, [
        canvasContextRef,
        selectArrow,
        historyDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (!checked || arrowRef.current || !canvasContextRef.current) return;
        const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
        arrowRef.current = {
            name: 'Arrow',
            type: HistoryItemType.Source,
            data: {
                size,
                color,
                x1: e.clientX - left,
                y1: e.clientY - top,
                x2: e.clientX - left,
                y2: e.clientY - top
            },
            editHistory: [],
            draw: draw,
            isHit: isHit
        };
    }, [
        checked,
        color,
        size,
        canvasContextRef
    ]);
    const onPointerMove = useCallback((e)=>{
        if (!checked || !canvasContextRef.current) return;
        if (arrowEditRef.current) {
            arrowEditRef.current.data.x2 = e.clientX;
            arrowEditRef.current.data.y2 = e.clientY;
            if (history.top !== arrowEditRef.current) {
                arrowEditRef.current.source.editHistory.push(arrowEditRef.current);
                historyDispatcher.push(arrowEditRef.current);
            } else historyDispatcher.set(history);
        } else if (arrowRef.current) {
            const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
            arrowRef.current.data.x2 = e.clientX - left;
            arrowRef.current.data.y2 = e.clientY - top;
            if (history.top !== arrowRef.current) historyDispatcher.push(arrowRef.current);
            else historyDispatcher.set(history);
        }
    }, [
        checked,
        history,
        canvasContextRef,
        historyDispatcher
    ]);
    const onPointerUp = useCallback(()=>{
        if (!checked) return;
        if (arrowRef.current) historyDispatcher.clearSelect();
        arrowRef.current = null;
        arrowEditRef.current = null;
    }, [
        checked,
        historyDispatcher
    ]);
    useDrawSelect(onDrawSelect);
    useCanvasPointerDown(onPointerDown);
    useCanvasPointerMove(onPointerMove);
    useCanvasPointerUp(onPointerUp);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_arrow_title,
        icon: "icon-arrow",
        checked: checked,
        onClick: onSelectArrow,
        option: /*#__PURE__*/ jsx(ScreenshotsSizeColor, {
            size: size,
            color: color,
            onSizeChange: setSize,
            onColorChange: setColor
        })
    });
}
export { Arrow_ArrowEditType as ArrowEditType, Arrow as default };
