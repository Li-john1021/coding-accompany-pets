import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";
import useBounds from "../../hooks/useBounds.js";
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
import ScreenshotsTextarea from "../../ScreenshotsTextarea/index.js";
import { HistoryItemType } from "../../types.js";
const sizes = {
    3: 18,
    6: 32,
    9: 46
};
function draw(ctx, action) {
    const { size, color, fontFamily, x, y, text } = action.data;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `${size}px ${fontFamily}`;
    const distance = action.editHistory.reduce((distance, { data })=>({
            x: distance.x + data.x2 - data.x1,
            y: distance.y + data.y2 - data.y1
        }), {
        x: 0,
        y: 0
    });
    text.split('\n').forEach((item, index)=>{
        ctx.fillText(item, x + distance.x, y + distance.y + index * size);
    });
}
function isHit(ctx, action, point) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `${action.data.size}px ${action.data.fontFamily}`;
    let width = 0;
    let height = 0;
    action.data.text.split('\n').forEach((item)=>{
        const measured = ctx.measureText(item);
        if (width < measured.width) width = measured.width;
        height += action.data.size;
    });
    const { x, y } = action.editHistory.reduce((distance, { data })=>({
            x: distance.x + data.x2 - data.x1,
            y: distance.y + data.y2 - data.y1
        }), {
        x: 0,
        y: 0
    });
    const left = action.data.x + x;
    const top = action.data.y + y;
    const right = left + width;
    const bottom = top + height;
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}
function Text() {
    const lang = useLang();
    const [history, historyDispatcher] = useHistory();
    const [bounds] = useBounds();
    const [operation, operationDispatcher] = useOperation();
    const [, cursorDispatcher] = useCursor();
    const canvasContextRef = useCanvasContextRef();
    const [size, setSize] = useState(3);
    const [color, setColor] = useState('#ee5126');
    const textRef = useRef(null);
    const textEditRef = useRef(null);
    const [textareaBounds, setTextareaBounds] = useState(null);
    const [text, setText] = useState('');
    const checked = 'Text' === operation;
    const selectText = useCallback(()=>{
        operationDispatcher.set('Text');
        cursorDispatcher.set('default');
    }, [
        operationDispatcher,
        cursorDispatcher
    ]);
    const onSelectText = useCallback(()=>{
        if (checked) return;
        selectText();
        historyDispatcher.clearSelect();
    }, [
        checked,
        selectText,
        historyDispatcher
    ]);
    const onSizeChange = useCallback((size)=>{
        if (textRef.current) textRef.current.data.size = sizes[size];
        setSize(size);
    }, []);
    const onColorChange = useCallback((color)=>{
        if (textRef.current) textRef.current.data.color = color;
        setColor(color);
    }, []);
    const onTextareaChange = useCallback((value)=>{
        setText(value);
        if (checked && textRef.current) textRef.current.data.text = value;
    }, [
        checked
    ]);
    const onTextareaBlur = useCallback(()=>{
        if (textRef.current?.data.text) historyDispatcher.push(textRef.current);
        textRef.current = null;
        setText('');
        setTextareaBounds(null);
    }, [
        historyDispatcher
    ]);
    const onDrawSelect = useCallback((action, e)=>{
        if ('Text' !== action.name) return;
        selectText();
        textEditRef.current = {
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
        selectText,
        historyDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (!checked || !canvasContextRef.current || textRef.current || !bounds) return;
        const { left, top } = canvasContextRef.current.canvas.getBoundingClientRect();
        const fontFamily = window.getComputedStyle(canvasContextRef.current.canvas).fontFamily;
        const x = e.clientX - left;
        const y = e.clientY - top;
        textRef.current = {
            name: 'Text',
            type: HistoryItemType.Source,
            data: {
                size: sizes[size],
                color,
                fontFamily,
                x,
                y,
                text: ''
            },
            editHistory: [],
            draw,
            isHit
        };
        setTextareaBounds({
            x: e.clientX,
            y: e.clientY,
            maxWidth: bounds.width - x,
            maxHeight: bounds.height - y
        });
    }, [
        checked,
        size,
        color,
        bounds,
        canvasContextRef
    ]);
    const onPointerMove = useCallback((e)=>{
        if (!checked) return;
        if (textEditRef.current) {
            textEditRef.current.data.x2 = e.clientX;
            textEditRef.current.data.y2 = e.clientY;
            if (history.top !== textEditRef.current) {
                textEditRef.current.source.editHistory.push(textEditRef.current);
                historyDispatcher.push(textEditRef.current);
            } else historyDispatcher.set(history);
        }
    }, [
        checked,
        history,
        historyDispatcher
    ]);
    const onPointerUp = useCallback(()=>{
        if (!checked) return;
        textEditRef.current = null;
    }, [
        checked
    ]);
    useDrawSelect(onDrawSelect);
    useCanvasPointerDown(onPointerDown);
    useCanvasPointerMove(onPointerMove);
    useCanvasPointerUp(onPointerUp);
    return /*#__PURE__*/ jsxs(Fragment, {
        children: [
            /*#__PURE__*/ jsx(ScreenshotsButton, {
                title: lang.operation_text_title,
                icon: "icon-text",
                checked: checked,
                onClick: onSelectText,
                option: /*#__PURE__*/ jsx(ScreenshotsSizeColor, {
                    size: size,
                    color: color,
                    onSizeChange: onSizeChange,
                    onColorChange: onColorChange
                })
            }),
            checked && textareaBounds && /*#__PURE__*/ jsx(ScreenshotsTextarea, {
                x: textareaBounds.x,
                y: textareaBounds.y,
                maxWidth: textareaBounds.maxWidth,
                maxHeight: textareaBounds.maxHeight,
                size: sizes[size],
                color: color,
                value: text,
                onChange: onTextareaChange,
                onBlur: onTextareaBlur
            })
        ]
    });
}
export { Text as default };
