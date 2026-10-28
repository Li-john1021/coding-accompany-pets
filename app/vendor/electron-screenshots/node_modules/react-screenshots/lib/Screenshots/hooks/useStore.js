import { useContext } from "react";
import ScreenshotsContext from "../ScreenshotsContext.js";
function useStore() {
    const { store } = useContext(ScreenshotsContext);
    return store;
}
export { useStore as default };
