import type { HistoryItemSource } from '../../types';
import type { EllipseData, EllipseEditData } from '.';
export declare function getEditedEllipseData(action: HistoryItemSource<EllipseData, EllipseEditData>): {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
    size: number;
    color: string;
};
export default function draw(ctx: CanvasRenderingContext2D, action: HistoryItemSource<EllipseData, EllipseEditData>): void;
