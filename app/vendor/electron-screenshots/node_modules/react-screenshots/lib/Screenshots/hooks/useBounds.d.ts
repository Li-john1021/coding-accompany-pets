import type { Bounds } from '../types';
export interface BoundsDispatcher {
    set: (bounds: Bounds) => void;
    reset: () => void;
}
export type BoundsValueDispatcher = [Bounds | null, BoundsDispatcher];
export default function useBounds(): BoundsValueDispatcher;
