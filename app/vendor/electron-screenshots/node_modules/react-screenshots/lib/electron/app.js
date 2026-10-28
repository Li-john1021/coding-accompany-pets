import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import Screenshots from "../Screenshots/index.js";
import "./app.css";
function App() {
    const [url, setUrl] = useState(void 0);
    const [width, setWidth] = useState(window.innerWidth);
    const [height, setHeight] = useState(window.innerHeight);
    const [display, setDisplay] = useState(void 0);
    const [lang, setLang] = useState(void 0);
    const onSave = useCallback(async (blob, bounds)=>{
        if (!display || !blob) return;
        window.screenshots.save(await blob.arrayBuffer(), {
            bounds,
            display
        });
    }, [
        display
    ]);
    const onCancel = useCallback(()=>{
        window.screenshots.cancel();
    }, []);
    const onOk = useCallback(async (blob, bounds)=>{
        if (!display || !blob) return;
        window.screenshots.ok(await blob.arrayBuffer(), {
            bounds,
            display
        });
    }, [
        display
    ]);
    useEffect(()=>{
        const onSetLang = (lang)=>{
            setLang(lang);
        };
        const onCapture = (display, dataURL)=>{
            setDisplay(display);
            setUrl(dataURL);
        };
        const onReset = ()=>{
            setUrl(void 0);
            setDisplay(void 0);
            requestAnimationFrame(()=>window.screenshots.reset());
        };
        window.screenshots.on('setLang', onSetLang);
        window.screenshots.on('capture', onCapture);
        window.screenshots.on('reset', onReset);
        window.screenshots.ready();
        return ()=>{
            window.screenshots.off('capture', onCapture);
            window.screenshots.off('setLang', onSetLang);
            window.screenshots.off('reset', onReset);
        };
    }, []);
    useEffect(()=>{
        const onResize = ()=>{
            setWidth(window.innerWidth);
            setHeight(window.innerHeight);
        };
        window.addEventListener('resize', onResize);
        return ()=>{
            window.removeEventListener('resize', onResize);
        };
    }, []);
    return /*#__PURE__*/ jsx("div", {
        className: "body",
        children: /*#__PURE__*/ jsx(Screenshots, {
            url: url,
            width: width,
            height: height,
            lang: lang,
            onSave: onSave,
            onCancel: onCancel,
            onOk: onOk
        })
    });
}
export { App as default };
