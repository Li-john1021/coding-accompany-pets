import react from "react";
import zh_CN from "./zh_CN.js";
const ScreenshotsContext = react.createContext({
    store: {
        url: void 0,
        image: null,
        width: 0,
        height: 0,
        lang: zh_CN,
        emitterRef: {
            current: {}
        },
        canvasContextRef: {
            current: null
        },
        history: {
            index: -1,
            stack: []
        },
        bounds: null,
        cursor: 'move',
        operation: void 0
    },
    dispatcher: {
        call: void 0,
        setHistory: void 0,
        setBounds: void 0,
        setCursor: void 0,
        setOperation: void 0
    }
});
export { ScreenshotsContext as default };
