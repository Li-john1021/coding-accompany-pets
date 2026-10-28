import { useCallback } from "react";
import useDispatcher from "./useDispatcher.js";
import useStore from "./useStore.js";
function useOperation() {
    const { operation } = useStore();
    const { setOperation } = useDispatcher();
    const set = useCallback((operation)=>{
        setOperation?.(operation);
    }, [
        setOperation
    ]);
    const reset = useCallback(()=>{
        setOperation?.(void 0);
    }, [
        setOperation
    ]);
    return [
        operation,
        {
            set,
            reset
        }
    ];
}
export { useOperation as default };
