import type { FocusEvent } from 'react';
import './index.less';
export interface TextInputProps {
    x: number;
    y: number;
    maxWidth: number;
    maxHeight: number;
    size: number;
    color: string;
    value: string;
    onChange: (value: string) => unknown;
    onBlur: (e: FocusEvent<HTMLTextAreaElement>) => unknown;
}
declare const _default: import("react").NamedExoticComponent<TextInputProps>;
export default _default;
