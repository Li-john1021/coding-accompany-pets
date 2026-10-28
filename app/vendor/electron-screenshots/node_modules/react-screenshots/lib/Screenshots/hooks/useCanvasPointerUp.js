import { useEffect } from "react";
import useEmitter from "./useEmitter.js";
function useCanvasPointerUp(onPointerUp) {
    const emitter = useEmitter();
    useEffect(()=>{
        emitter.on("pointerup", onPointerUp);
        return ()=>{
            emitter.off("pointerup", onPointerUp);
        };
    }, [
        onPointerUp,
        emitter
    ]);
}
export { useCanvasPointerUp as default };
