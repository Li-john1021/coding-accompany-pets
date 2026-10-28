import { jsx } from "react/jsx-runtime";
import { useCallback } from "react";
import Screenshots from "../Screenshots/index.js";
import "./app.css";
import image_0 from "./image.js";
function App() {
    const onSave = useCallback((blob, bounds)=>{
        console.log('save', blob, bounds);
        if (blob) {
            const url = URL.createObjectURL(blob);
            console.log(url);
            window.open(url);
        }
    }, []);
    const onCancel = useCallback(()=>{
        console.log('cancel');
    }, []);
    const onOk = useCallback((blob, bounds)=>{
        console.log('ok', blob, bounds);
        if (blob) {
            const url = URL.createObjectURL(blob);
            console.log(url);
            window.open(url);
        }
    }, []);
    return /*#__PURE__*/ jsx("div", {
        className: "body",
        children: /*#__PURE__*/ jsx(Screenshots, {
            url: image_0,
            width: window.innerWidth,
            height: window.innerHeight,
            lang: {
                operation_rectangle_title: 'Rectangle'
            },
            onSave: onSave,
            onCancel: onCancel,
            onOk: onOk
        })
    });
}
export { App as default };
