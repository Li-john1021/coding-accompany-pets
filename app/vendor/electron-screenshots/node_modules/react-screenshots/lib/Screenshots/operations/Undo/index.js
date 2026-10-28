import { jsx } from "react/jsx-runtime";
import { useCallback } from "react";
import useHistory from "../../hooks/useHistory.js";
import useLang from "../../hooks/useLang.js";
import ScreenshotsButton from "../../ScreenshotsButton/index.js";
function Undo() {
    const lang = useLang();
    const [history, historyDispatcher] = useHistory();
    const onClick = useCallback(()=>{
        historyDispatcher.undo();
    }, [
        historyDispatcher
    ]);
    return /*#__PURE__*/ jsx(ScreenshotsButton, {
        title: lang.operation_undo_title,
        icon: "icon-undo",
        disabled: -1 === history.index,
        onClick: onClick
    });
}
export { Undo as default };
