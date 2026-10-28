import { useEffect } from "react";
import useEmitter from "./useEmitter.js";
function useDrawSelect(onDrawSelect) {
    const emitter = useEmitter();
    useEffect(()=>{
        emitter.on('drawselect', onDrawSelect);
        return ()=>{
            emitter.off('drawselect', onDrawSelect);
        };
    }, [
        onDrawSelect,
        emitter
    ]);
}
export { useDrawSelect as default };
