import type { PointerEvent, ReactNode } from 'react';
import './index.less';
export interface ScreenshotsButtonProps {
    title: string;
    icon: string;
    checked?: boolean;
    disabled?: boolean;
    option?: ReactNode;
    onClick?: (e: PointerEvent<HTMLDivElement>) => unknown;
}
declare const _default: import("react").NamedExoticComponent<ScreenshotsButtonProps>;
export default _default;
