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
import draw, { getEditedEllipseData } from "./draw.js";
var Ellipse_EllipseEditType = /*#__PURE__*/ function(EllipseEditType) {
    EllipseEditType[EllipseEditType["Move"] = 0] = "Move";
    EllipseEditType[EllipseEditType["ResizeTop"] = 1] = "ResizeTop";
    EllipseEditType[EllipseEditType["ResizeRightTop"] = 2] = "ResizeRightTop";
    EllipseEditType[EllipseEditType["ResizeRight"] = 3] = "ResizeRight";
    EllipseEditType[EllipseEditType["ResizeRightBottom"] = 4] = "ResizeRightBottom";
    EllipseEditType[EllipseEditType["ResizeBottom"] = 5] = "ResizeBottom";
    EllipseEditType[EllipseEditType["ResizeLeftBottom"] = 6] = "ResizeLeftBottom";
    EllipseEditType[EllipseEditType["ResizeLeft"] = 7] = "ResizeLeft";
    EllipseEditType[EllipseEditType["ResizeLeftTop"] = 8] = "ResizeLeftTop";
    return EllipseEditType;
}({});
function Ellipse() {
    const lang = useLang();
    const [history, historyDispatcher] = useHistory();
    const [operation, operationDispatcher] = useOperation();
    const [, cursorDispatcher] = useCursor();
    const canvasContextRef = useCanvasContextRef();
    const [size, setSize] = useState(3);
    const [color, setColor] = useState('#ee5126');
    const ellipseRef = useRef(null);
    const ellipseEditRef = useRef(null);
    const checked = 'Ellipse' === operation;
    const selectEllipse = useCallback(()=>{
        operationDispatcher.set('Ellipse');
        cursorDispatcher.set('crosshair');
    }, [
        operationDispatcher,
        cursorDispatcher
    ]);
    const onSelectEllipse = useCallback(()=>{
        if (checked) return;
        selectEllipse();
        historyDispatcher.clearSelect();
    }, [
        checked,
        selectEllipse,
        historyDispatcher
    ]);
    const onDrawSelect = useCallback((action, e)=>{
        if ('Ellipse' !== action.name || !canvasContextRef.current) return;
        const source = action;
        selectEllipse();
        const { x1, y1, x2, y2 } = getEditedEllipseData(source);
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
        ellipseEditRef.current = {
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
        selectEllipse,
        historyDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (!checked || !canvasContextRef.current || ellipseRef.current) return;
        const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
        const x = e.clientX - left;
        const y = e.clientY - top;
        ellipseRef.current = {
            name: 'Ellipse',
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
        if (ellipseEditRef.current) {
            ellipseEditRef.current.data.x2 = e.clientX;
            ellipseEditRef.current.data.y2 = e.clientY;
            if (history.top !== ellipseEditRef.current) {
                ellipseEditRef.current.source.editHistory.push(ellipseEditRef.current);
                historyDispatcher.push(ellipseEditRef.current);
            } else historyDispatcher.set(history);
        } else if (ellipseRef.current) {
            const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
            ellipseRef.current.data.x2 = e.clientX - left;
            ellipseRef.current.data.y2 = e.clientY - top;
            if (history.top !== ellipseRef.current) historyDispatcher.push(ellipseRef.current);
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
        if (ellipseRef.current) historyDispatcher.clearSelect();
        ellipseRef.current = null;
        ellipseEditRef.current = null;
    }, [
        checked,
        historyDispatcher
    ]);
    useDrawSelect(onDrawSelect);
    useCanvasPointerDown(onPointerDown);
    useCanvasPointerMove(onPointerMove);
    useCanvasPointerUp(onPointerUp);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_ellipse_title,
        icon: "icon-ellipse",
        checked: checked,
        onClick: onSelectEllipse,
        option: /*#__PURE__*/ jsx(ScreenshotsSizeColor, {
            size: size,
            color: color,
            onSizeChange: setSize,
            onColorChange: setColor
        })
    });
}
export { Ellipse_EllipseEditType as EllipseEditType, Ellipse as default };
