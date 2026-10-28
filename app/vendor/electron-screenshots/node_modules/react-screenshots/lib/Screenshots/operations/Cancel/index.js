import { jsx } from "react/jsx-runtime";
import { useCallback } from "react";
import useCall from "../../hooks/useCall.js";
import useLang from "../../hooks/useLang.js";
import useReset from "../../hooks/useReset.js";
import ScreenshotsButton from "../../ScreenshotsButton/index.js";
function Cancel() {
    const call = useCall();
    const reset = useReset();
    const lang = useLang();
    const onClick = useCallback(()=>{
        call('onCancel');
        reset();
    }, [
        call,
        reset
    ]);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_cancel_title,
        icon: "icon-cancel",
        onClick: onClick
    });
}
export { Cancel as default };
