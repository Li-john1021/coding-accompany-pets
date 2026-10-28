import type { HistoryItemSource } from '../../types';
import type { BrushData, BrushEditData } from '.';
export default function draw(ctx: CanvasRenderingContext2D, action: HistoryItemSource<BrushData, BrushEditData>): void;
