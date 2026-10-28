import { useCallback } from "react";
import useDispatcher from "./useDispatcher.js";
function useCall() {
    const dispatcher = useDispatcher();
    const call = useCallback((funcName, ...args)=>{
        dispatcher.call?.(funcName, ...args);
    }, [
        dispatcher
    ]);
    return call;
}
export { useCall as default };
