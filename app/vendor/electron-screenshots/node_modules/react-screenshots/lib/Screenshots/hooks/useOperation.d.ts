export interface OperationDispatcher {
    set: (operation: string) => void;
    reset: () => void;
}
export type OperationValueDispatcher = [
    string | undefined,
    OperationDispatcher
];
export default function useOperation(): OperationValueDispatcher;
