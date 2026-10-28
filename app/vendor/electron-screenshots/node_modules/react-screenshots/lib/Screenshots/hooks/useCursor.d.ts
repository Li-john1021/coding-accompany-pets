export interface CursorDispatcher {
    set: (cursor: string) => void;
    reset: () => void;
}
export type CursorValueDispatcher = [string | undefined, CursorDispatcher];
export default function useCursor(): CursorValueDispatcher;
