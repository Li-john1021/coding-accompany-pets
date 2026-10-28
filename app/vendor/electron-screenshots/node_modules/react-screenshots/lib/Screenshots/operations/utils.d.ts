import type { HistoryItemSource, Point } from '../types';
export declare function drawDragCircle(ctx: CanvasRenderingContext2D, x: number, y: number): void;
export declare function isHit<S, E>(ctx: CanvasRenderingContext2D, action: HistoryItemSource<S, E>, point: Point): boolean;
export declare function isHitCircle(canvas: HTMLCanvasElement | null, e: PointerEvent, point: Point): boolean;
