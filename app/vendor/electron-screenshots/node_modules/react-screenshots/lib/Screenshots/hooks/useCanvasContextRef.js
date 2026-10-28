import useStore from "./useStore.js";
function useCanvasContextRef() {
    const { canvasContextRef } = useStore();
    return canvasContextRef;
}
export { useCanvasContextRef as default };
