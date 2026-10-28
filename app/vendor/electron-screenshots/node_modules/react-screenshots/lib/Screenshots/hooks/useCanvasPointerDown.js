import { useEffect } from "react";
import useEmitter from "./useEmitter.js";
function useCanvasPointerDown(onPointerDown) {
    const emitter = useEmitter();
    useEffect(()=>{
        emitter.on('pointerdown', onPointerDown);
        return ()=>{
            emitter.off('pointerdown', onPointerDown);
        };
    }, [
        onPointerDown,
        emitter
    ]);
}
export { useCanvasPointerDown as default };
