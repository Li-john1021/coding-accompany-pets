import { useCallback } from "react";
import useDispatcher from "./useDispatcher.js";
import useStore from "./useStore.js";
function useCursor() {
    const { cursor } = useStore();
    const { setCursor } = useDispatcher();
    const set = useCallback((cursor)=>{
        setCursor?.(cursor);
    }, [
        setCursor
    ]);
    const reset = useCallback(()=>{
        setCursor?.('move');
    }, [
        setCursor
    ]);
    return [
        cursor,
        {
            set,
            reset
        }
    ];
}
export { useCursor as default };
