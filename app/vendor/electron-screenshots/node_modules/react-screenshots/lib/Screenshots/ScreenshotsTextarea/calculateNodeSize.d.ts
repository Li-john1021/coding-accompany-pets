export interface SizeInfo {
    sizingStyle: string;
    paddingSize: number;
    borderSize: number;
    boxSizing: string;
}
export interface Size {
    width: number;
    height: number;
}
export declare function getComputedSizeInfo(node: HTMLElement): {
    sizingStyle: string;
    paddingSize: number;
    borderSize: number;
    boxSizing: string;
};
export default function calculateNodeSize(textarea: HTMLTextAreaElement, value: string, maxWidth: number, maxHeight: number): Size;
