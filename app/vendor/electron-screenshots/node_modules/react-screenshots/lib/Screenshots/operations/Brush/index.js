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
import { isHit } from "../utils.js";
import draw from "./draw.js";
function Brush() {
    const lang = useLang();
    const [, cursorDispatcher] = useCursor();
    const [operation, operationDispatcher] = useOperation();
    const canvasContextRef = useCanvasContextRef();
    const [history, historyDispatcher] = useHistory();
    const [size, setSize] = useState(3);
    const [color, setColor] = useState('#ee5126');
    const brushRef = useRef(null);
    const brushEditRef = useRef(null);
    const checked = 'Brush' === operation;
    const selectBrush = useCallback(()=>{
        operationDispatcher.set('Brush');
        cursorDispatcher.set('default');
    }, [
        operationDispatcher,
        cursorDispatcher
    ]);
    const onSelectBrush = useCallback(()=>{
        if (checked) return;
        selectBrush();
        historyDispatcher.clearSelect();
    }, [
        checked,
        selectBrush,
        historyDispatcher
    ]);
    const onDrawSelect = useCallback((action, e)=>{
        if ('Brush' !== action.name) return;
        selectBrush();
        brushEditRef.current = {
            type: HistoryItemType.Edit,
            data: {
                x1: e.clientX,
                y1: e.clientY,
                x2: e.clientX,
                y2: e.clientY
            },
            source: action
        };
        historyDispatcher.select(action);
    }, [
        selectBrush,
        historyDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (!checked || brushRef.current || !canvasContextRef.current) return;
        const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
        brushRef.current = {
            name: 'Brush',
            type: HistoryItemType.Source,
            data: {
                size,
                color,
                points: [
                    {
                        x: e.clientX - left,
                        y: e.clientY - top
                    }
                ]
            },
            editHistory: [],
            draw: draw,
            isHit: isHit
        };
    }, [
        checked,
        canvasContextRef,
        size,
        color
    ]);
    const onPointerMove = useCallback((e)=>{
        if (!checked || !canvasContextRef.current) return;
        if (brushEditRef.current) {
            brushEditRef.current.data.x2 = e.clientX;
            brushEditRef.current.data.y2 = e.clientY;
            if (history.top !== brushEditRef.current) {
                brushEditRef.current.source.editHistory.push(brushEditRef.current);
                historyDispatcher.push(brushEditRef.current);
            } else historyDispatcher.set(history);
        } else if (brushRef.current) {
            const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
            brushRef.current.data.points.push({
                x: e.clientX - left,
                y: e.clientY - top
            });
            if (history.top !== brushRef.current) historyDispatcher.push(brushRef.current);
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
        if (brushRef.current) historyDispatcher.clearSelect();
        brushRef.current = null;
        brushEditRef.current = null;
    }, [
        checked,
        historyDispatcher
    ]);
    useDrawSelect(onDrawSelect);
    useCanvasPointerDown(onPointerDown);
    useCanvasPointerMove(onPointerMove);
    useCanvasPointerUp(onPointerUp);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_brush_title,
        icon: "icon-brush",
        checked: checked,
        onClick: onSelectBrush,
        option: /*#__PURE__*/ jsx(ScreenshotsSizeColor, {
            size: size,
            color: color,
            onSizeChange: setSize,
            onColorChange: setColor
        })
    });
}
export { Brush as default };
