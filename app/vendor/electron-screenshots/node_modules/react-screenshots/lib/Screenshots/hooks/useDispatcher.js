import { useContext } from "react";
import ScreenshotsContext from "../ScreenshotsContext.js";
function useDispatcher() {
    const { dispatcher } = useContext(ScreenshotsContext);
    return dispatcher;
}
export { useDispatcher as default };
