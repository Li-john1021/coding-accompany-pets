import './index.less';
export interface SizeColorProps {
    size: number;
    color: string;
    onSizeChange: (value: number) => void;
    onColorChange: (value: string) => void;
}
declare const _default: import("react").NamedExoticComponent<SizeColorProps>;
export default _default;
