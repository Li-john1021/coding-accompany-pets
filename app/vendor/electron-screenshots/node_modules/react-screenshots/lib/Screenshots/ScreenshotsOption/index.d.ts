import type { ReactElement, ReactNode } from "react";
import type { Point } from "../types";
import "./index.less";
export interface ScreenshotsOptionProps {
    open?: boolean;
    content?: ReactNode;
    children: ReactElement;
}
export type Position = Point;
export declare enum Placement {
    Bottom = "bottom",
    Top = "top"
}
declare const _default: import("react").NamedExoticComponent<ScreenshotsOptionProps>;
export default _default;
