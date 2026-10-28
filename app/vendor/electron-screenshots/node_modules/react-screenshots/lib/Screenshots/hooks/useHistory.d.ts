import type { History, HistoryItem } from '../types';
export interface HistoryValue extends History {
    top?: HistoryItem<unknown, unknown>;
}
export interface HistoryDispatcher {
    push: <S, E>(action: HistoryItem<S, E>) => void;
    pop: () => void;
    undo: () => void;
    redo: () => void;
    set: (history: History) => void;
    select: <S, E>(action: HistoryItem<S, E>) => void;
    clearSelect: () => void;
    reset: () => void;
}
export type HistoryValueDispatcher = [HistoryValue, HistoryDispatcher];
export default function useHistory(): HistoryValueDispatcher;
