import type { Dispatch, SetStateAction } from 'react';
import React from 'react';
import type { Bounds, CanvasContextRef, EmitterRef, History } from './types';
import type { Lang } from './zh_CN';
export interface ScreenshotsContextStore {
    url?: string;
    image: HTMLImageElement | null;
    width: number;
    height: number;
    lang: Lang;
    emitterRef: EmitterRef;
    canvasContextRef: CanvasContextRef;
    history: History;
    bounds: Bounds | null;
    cursor?: string;
    operation?: string;
}
export interface ScreenshotsContextDispatcher {
    call?: <T>(funcName: string, ...args: T[]) => void;
    setHistory?: Dispatch<SetStateAction<History>>;
    setBounds?: Dispatch<SetStateAction<Bounds | null>>;
    setCursor?: Dispatch<SetStateAction<string | undefined>>;
    setOperation?: Dispatch<SetStateAction<string | undefined>>;
}
export interface ScreenshotsContextValue {
    store: ScreenshotsContextStore;
    dispatcher: ScreenshotsContextDispatcher;
}
declare const _default: React.Context<ScreenshotsContextValue>;
export default _default;
