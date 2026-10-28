import { useCallback } from "react";
import useBounds from "./useBounds.js";
import useCursor from "./useCursor.js";
import useEmitter from "./useEmitter.js";
import useHistory from "./useHistory.js";
import useOperation from "./useOperation.js";
function useReset() {
    const emitter = useEmitter();
    const [, boundsDispatcher] = useBounds();
    const [, cursorDispatcher] = useCursor();
    const [, historyDispatcher] = useHistory();
    const [, operatioDispatcher] = useOperation();
    const reset = useCallback(()=>{
        emitter.reset();
        historyDispatcher.reset();
        boundsDispatcher.reset();
        cursorDispatcher.reset();
        operatioDispatcher.reset();
    }, [
        emitter,
        historyDispatcher,
        boundsDispatcher,
        cursorDispatcher,
        operatioDispatcher
    ]);
    return reset;
}
export { useReset as default };
