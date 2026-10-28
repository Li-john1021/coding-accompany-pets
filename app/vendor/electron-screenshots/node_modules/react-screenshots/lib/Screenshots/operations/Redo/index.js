import { jsx } from "react/jsx-runtime";
import { useCallback } from "react";
import useHistory from "../../hooks/useHistory.js";
import useLang from "../../hooks/useLang.js";
import ScreenshotsButton from "../../ScreenshotsButton/index.js";
function Redo() {
    const lang = useLang();
    const [history, historyDispatcher] = useHistory();
    const onClick = useCallback(()=>{
        historyDispatcher.redo();
    }, [
        historyDispatcher
    ]);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_redo_title,
        icon: "icon-redo",
        disabled: !history.stack.length || history.stack.length - 1 === history.index,
        onClick: onClick
    });
}
export { Redo as default };
