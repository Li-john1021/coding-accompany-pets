import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import useBounds from "../../hooks/useBounds.js";
import useCanvasContextRef from "../../hooks/useCanvasContextRef.js";
import useCanvasPointerDown from "../../hooks/useCanvasPointerDown.js";
import useCanvasPointerMove from "../../hooks/useCanvasPointerMove.js";
import useCanvasPointerUp from "../../hooks/useCanvasPointerUp.js";
import useCursor from "../../hooks/useCursor.js";
import useHistory from "../../hooks/useHistory.js";
import useLang from "../../hooks/useLang.js";
import useOperation from "../../hooks/useOperation.js";
import useStore from "../../hooks/useStore.js";
import ScreenshotsButton from "../../ScreenshotsButton/index.js";
import ScreenshotsSize from "../../ScreenshotsSize/index.js";
import { HistoryItemType } from "../../types.js";
function getColor(x, y, imageData) {
    if (!imageData) return [
        0,
        0,
        0,
        0
    ];
    const { data, width } = imageData;
    const index = y * width * 4 + 4 * x;
    return Array.from(data.slice(index, index + 4));
}
function draw(ctx, action) {
    const { tiles, size } = action.data;
    tiles.forEach((tile)=>{
        const r = Math.round(tile.color[0]);
        const g = Math.round(tile.color[1]);
        const b = Math.round(tile.color[2]);
        const a = tile.color[3] / 255;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.fillRect(tile.x - size / 2, tile.y - size / 2, size, size);
    });
}
function Mosaic() {
    const lang = useLang();
    const { image, width, height } = useStore();
    const [operation, operationDispatcher] = useOperation();
    const canvasContextRef = useCanvasContextRef();
    const [history, historyDispatcher] = useHistory();
    const [bounds] = useBounds();
    const [, cursorDispatcher] = useCursor();
    const [size, setSize] = useState(3);
    const imageDataRef = useRef(null);
    const mosaicRef = useRef(null);
    const checked = 'Mosaic' === operation;
    const selectMosaic = useCallback(()=>{
        operationDispatcher.set('Mosaic');
        cursorDispatcher.set('crosshair');
    }, [
        operationDispatcher,
        cursorDispatcher
    ]);
    const onSelectMosaic = useCallback(()=>{
        if (checked) return;
        selectMosaic();
        historyDispatcher.clearSelect();
    }, [
        checked,
        selectMosaic,
        historyDispatcher
    ]);
    const onPointerDown = useCallback((e)=>{
        if (!checked || mosaicRef.current || !imageDataRef.current || !canvasContextRef.current) return;
        const rect = canvasContextRef.current.canvas.getBoundingClientRect();
        const x = e.clientX - rect.x;
        const y = e.clientY - rect.y;
        const mosaicSize = 2 * size;
        mosaicRef.current = {
            name: 'Mosaic',
            type: HistoryItemType.Source,
            data: {
                size: mosaicSize,
                tiles: [
                    {
                        x,
                        y,
                        color: getColor(x, y, imageDataRef.current)
                    }
                ]
            },
            editHistory: [],
            draw
        };
    }, [
        checked,
        size,
        canvasContextRef
    ]);
    const onPointerMove = useCallback((e)=>{
        if (!checked || !mosaicRef.current || !canvasContextRef.current || !imageDataRef.current) return;
        const rect = canvasContextRef.current.canvas.getBoundingClientRect();
        const x = e.clientX - rect.x;
        const y = e.clientY - rect.y;
        const mosaicSize = mosaicRef.current.data.size;
        const mosaicTiles = mosaicRef.current.data.tiles;
        let lastTile = mosaicTiles[mosaicTiles.length - 1];
        if (lastTile) {
            const dx = lastTile.x - x;
            const dy = lastTile.y - y;
            let length = Math.sqrt(dx ** 2 + dy ** 2);
            const sin = -dy / length;
            const cos = -dx / length;
            while(length > mosaicSize){
                const cx = Math.floor(lastTile.x + mosaicSize * cos);
                const cy = Math.floor(lastTile.y + mosaicSize * sin);
                lastTile = {
                    x: cx,
                    y: cy,
                    color: getColor(cx, cy, imageDataRef.current)
                };
                mosaicTiles.push(lastTile);
                length -= mosaicSize;
            }
            if (length > mosaicSize / 2) mosaicTiles.push({
                x,
                y,
                color: getColor(x, y, imageDataRef.current)
            });
        } else mosaicTiles.push({
            x,
            y,
            color: getColor(x, y, imageDataRef.current)
        });
        if (history.top !== mosaicRef.current) historyDispatcher.push(mosaicRef.current);
        else historyDispatcher.set(history);
    }, [
        checked,
        canvasContextRef,
        history,
        historyDispatcher
    ]);
    const onPointerUp = useCallback(()=>{
        if (!checked) return;
        mosaicRef.current = null;
    }, [
        checked
    ]);
    useCanvasPointerDown(onPointerDown);
    useCanvasPointerMove(onPointerMove);
    useCanvasPointerUp(onPointerUp);
    useEffect(()=>{
        if (!bounds || !image || !checked) return;
        const $canvas = document.createElement('canvas');
        const canvasContext = $canvas.getContext('2d');
        if (!canvasContext) return;
        $canvas.width = bounds.width;
        $canvas.height = bounds.height;
        const rx = image.naturalWidth / width;
        const ry = image.naturalHeight / height;
        canvasContext.drawImage(image, bounds.x * rx, bounds.y * ry, bounds.width * rx, bounds.height * ry, 0, 0, bounds.width, bounds.height);
        imageDataRef.current = canvasContext.getImageData(0, 0, bounds.width, bounds.height);
    }, [
        width,
        height,
        bounds,
        image,
        checked
    ]);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_mosaic_title,
        icon: "icon-mosaic",
        checked: checked,
        onClick: onSelectMosaic,
        option: /*#__PURE__*/ jsx(ScreenshotsSize, {
            value: size,
            onChange: setSize
        })
    });
}
export { Mosaic as default };
