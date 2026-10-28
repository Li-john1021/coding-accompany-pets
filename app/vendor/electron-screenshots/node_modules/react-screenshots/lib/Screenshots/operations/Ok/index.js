import { jsx } from "react/jsx-runtime";
import { useCallback } from "react";
import composeImage from "../../composeImage.js";
import useCall from "../../hooks/useCall.js";
import useCanvasContextRef from "../../hooks/useCanvasContextRef.js";
import useHistory from "../../hooks/useHistory.js";
import useReset from "../../hooks/useReset.js";
import useStore from "../../hooks/useStore.js";
import ScreenshotsButton from "../../ScreenshotsButton/index.js";
function Ok() {
    const { image, width, height, history, bounds, lang } = useStore();
    const canvasContextRef = useCanvasContextRef();
    const [, historyDispatcher] = useHistory();
    const call = useCall();
    const reset = useReset();
    const onClick = useCallback(()=>{
        historyDispatcher.clearSelect();
        setTimeout(()=>{
            if (!canvasContextRef.current || !image || !bounds) return;
            composeImage({
                image,
                width,
                height,
                history,
                bounds
            }).then((blob)=>{
                call('onOk', blob, bounds);
                reset();
            });
        });
    }, [
        canvasContextRef,
        historyDispatcher,
        image,
        width,
        height,
        history,
        bounds,
        call,
        reset
    ]);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_ok_title,
        icon: "icon-ok",
        onClick: onClick
    });
}
export { Ok as default };
