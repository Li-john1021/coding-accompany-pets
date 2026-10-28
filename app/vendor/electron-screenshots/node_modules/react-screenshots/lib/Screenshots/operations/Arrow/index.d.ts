import type { ReactElement } from 'react';
export interface ArrowData {
    size: number;
    color: string;
    x1: number;
    x2: number;
    y1: number;
    y2: number;
}
export declare enum ArrowEditType {
    Move = 0,
    MoveStart = 1,
    MoveEnd = 2
}
export interface ArrowEditData {
    type: ArrowEditType;
    x1: number;
    x2: number;
    y1: number;
    y2: number;
}
export default function Arrow(): ReactElement;
