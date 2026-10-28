import type { MutableRefObject } from "react";
export type CanvasContextRef = MutableRefObject<CanvasRenderingContext2D | null>;
export type EmitterListener = (...args: any[]) => unknown;
export type Emitter = Record<string, EmitterListener[]>;
export type EmitterRef = MutableRefObject<Emitter>;
export interface Point {
    x: number;
    y: number;
}
export declare enum HistoryItemType {
    Edit = 0,
    Source = 1
}
export interface HistoryItemEdit<E, S> {
    type: HistoryItemType.Edit;
    data: E;
    source: HistoryItemSource<S, E>;
}
export interface HistoryItemSource<S, E> {
    name: string;
    type: HistoryItemType.Source;
    data: S;
    isSelected?: boolean;
    editHistory: HistoryItemEdit<E, S>[];
    draw: (ctx: CanvasRenderingContext2D, action: HistoryItemSource<S, E>) => void;
    isHit?: (ctx: CanvasRenderingContext2D, action: HistoryItemSource<S, E>, point: Point) => boolean;
}
export type HistoryItem<S, E> = HistoryItemEdit<E, S> | HistoryItemSource<S, E>;
export interface History {
    index: number;
    stack: HistoryItem<any, any>[];
}
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export type Position = Point;
