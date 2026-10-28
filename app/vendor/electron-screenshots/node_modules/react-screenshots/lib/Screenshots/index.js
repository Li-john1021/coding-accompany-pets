import { jsx, jsxs } from "react/jsx-runtime";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import composeImage from "./composeImage.js";
import "./icons/iconfont.css";
import "./screenshots.css";
import ScreenshotsBackground from "./ScreenshotsBackground/index.js";
import ScreenshotsCanvas from "./ScreenshotsCanvas/index.js";
import ScreenshotsContext from "./ScreenshotsContext.js";
import ScreenshotsOperations from "./ScreenshotsOperations/index.js";
import useGetLoadedImage from "./useGetLoadedImage.js";
import zh_CN from "./zh_CN.js";
function Screenshots({ url, width, height, lang, className, ...props }) {
    const propsRef = useRef(props);
    propsRef.current = props;
    const image = useGetLoadedImage(url);
    const canvasContextRef = useRef(null);
    const emitterRef = useRef({});
    const [history, setHistory] = useState({
        index: -1,
        stack: []
    });
    const [bounds, setBounds] = useState(null);
    const [cursor, setCursor] = useState('move');
    const [operation, setOperation] = useState(void 0);
    const store = {
        url,
        width,
        height,
        image,
        lang: {
            ...zh_CN,
            ...lang
        },
        emitterRef,
        canvasContextRef,
        history,
        bounds,
        cursor,
        operation
    };
    const call = useCallback((funcName, ...args)=>{
        const func = propsRef.current[funcName];
        if ('function' == typeof func) func(...args);
    }, []);
    const dispatcher = {
        call,
        setHistory,
        setBounds,
        setCursor,
        setOperation
    };
    const classNames = [
        'screenshots'
    ];
    if (className) classNames.push(className);
    const reset = useCallback(()=>{
        emitterRef.current = {};
        setHistory({
            index: -1,
            stack: []
        });
        setBounds(null);
        setCursor('move');
        setOperation(void 0);
    }, []);
    const onDoubleClick = useCallback(async (e)=>{
        if (0 !== e.button || !image) return;
        if (bounds && canvasContextRef.current) composeImage({
            image,
            width,
            height,
            history,
            bounds
        }).then((blob)=>{
            call('onOk', blob, bounds);
            reset();
        });
        else {
            const targetBounds = {
                x: 0,
                y: 0,
                width,
                height
            };
            composeImage({
                image,
                width,
                height,
                history,
                bounds: targetBounds
            }).then((blob)=>{
                call('onOk', blob, targetBounds);
                reset();
            });
        }
    }, [
        image,
        history,
        bounds,
        width,
        height,
        call,
        reset
    ]);
    const onContextMenu = useCallback((e)=>{
        if (2 !== e.button) return;
        e.preventDefault();
        call('onCancel');
        reset();
    }, [
        call,
        reset
    ]);
    useLayoutEffect(()=>{
        reset();
    }, [
        url
    ]);
    return /*#__PURE__*/ jsx(ScreenshotsContext.Provider, {
        value: {
            store,
            dispatcher
        },
        children: /*#__PURE__*/ jsxs("div", {
            className: classNames.join(' '),
            style: {
                width,
                height
            },
            onDoubleClick: onDoubleClick,
            onContextMenu: onContextMenu,
            children: [
                /*#__PURE__*/ jsx(ScreenshotsBackground, {}),
                /*#__PURE__*/ jsx(ScreenshotsCanvas, {
                    ref: canvasContextRef
                }),
                /*#__PURE__*/ jsx(ScreenshotsOperations, {})
            ]
        })
    });
}
export { Screenshots as default };
