import type { HistoryItemSource } from '../../types';
import type { RectangleData, RectangleEditData } from '.';
export declare function getEditedRectangleData(action: HistoryItemSource<RectangleData, RectangleEditData>): {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
    size: number;
    color: string;
};
export default function draw(ctx: CanvasRenderingContext2D, action: HistoryItemSource<RectangleData, RectangleEditData>): void;
