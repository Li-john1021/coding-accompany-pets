import { useCallback } from "react";
import useDispatcher from "./useDispatcher.js";
import useStore from "./useStore.js";
function useBounds() {
    const { bounds } = useStore();
    const { setBounds } = useDispatcher();
    const set = useCallback((bounds)=>{
        setBounds?.(bounds);
    }, [
        setBounds
    ]);
    const reset = useCallback(()=>{
        setBounds?.(null);
    }, [
        setBounds
    ]);
    return [
        bounds,
        {
            set,
            reset
        }
    ];
}
export { useBounds as default };
