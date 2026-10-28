import { useCallback } from "react";
import useStore from "./useStore.js";
function useEmitter() {
    const { emitterRef } = useStore();
    const on = useCallback((event, listener)=>{
        const emitter = emitterRef.current;
        if (Array.isArray(emitter[event])) emitter[event].push(listener);
        else emitter[event] = [
            listener
        ];
    }, [
        emitterRef
    ]);
    const off = useCallback((event, listener)=>{
        const emitter = emitterRef.current;
        if (Array.isArray(emitter[event])) {
            const index = emitter[event].indexOf(listener);
            if (-1 !== index) emitter[event].splice(index, 1);
        }
    }, [
        emitterRef
    ]);
    const emit = useCallback((event, ...args)=>{
        const emitter = emitterRef.current;
        if (Array.isArray(emitter[event])) emitter[event].forEach((listener)=>{
            listener(...args);
        });
    }, [
        emitterRef
    ]);
    const reset = useCallback(()=>{
        emitterRef.current = {};
    }, [
        emitterRef
    ]);
    return {
        on,
        off,
        emit,
        reset
    };
}
export { useEmitter as default };
