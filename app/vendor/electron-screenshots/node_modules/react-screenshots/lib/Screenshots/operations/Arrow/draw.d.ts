import type { HistoryItemSource } from '../../types';
import type { ArrowData, ArrowEditData } from '.';
export declare function getEditedArrowData(action: HistoryItemSource<ArrowData, ArrowEditData>): {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
    size: number;
    color: string;
};
export default function draw(ctx: CanvasRenderingContext2D, action: HistoryItemSource<ArrowData, ArrowEditData>): void;
