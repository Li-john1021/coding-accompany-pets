import { useEffect } from "react";
import useEmitter from "./useEmitter.js";
function useCanvasPointerMove(onPointerMove) {
    const emitter = useEmitter();
    useEffect(()=>{
        emitter.on('pointermove', onPointerMove);
        return ()=>{
            emitter.off('pointermove', onPointerMove);
        };
    }, [
        onPointerMove,
        emitter
    ]);
}
export { useCanvasPointerMove as default };
