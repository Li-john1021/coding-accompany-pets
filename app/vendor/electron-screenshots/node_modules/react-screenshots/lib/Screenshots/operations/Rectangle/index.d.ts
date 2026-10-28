import type { ReactElement } from 'react';
export interface RectangleData {
    size: number;
    color: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export declare enum RectangleEditType {
    Move = 0,
    ResizeTop = 1,
    ResizeRightTop = 2,
    ResizeRight = 3,
    ResizeRightBottom = 4,
    ResizeBottom = 5,
    ResizeLeftBottom = 6,
    ResizeLeft = 7,
    ResizeLeftTop = 8
}
export interface RectangleEditData {
    type: RectangleEditType;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export default function Rectangle(): ReactElement;
