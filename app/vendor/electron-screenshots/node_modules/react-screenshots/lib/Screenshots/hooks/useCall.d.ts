export type CallDispatcher = <T extends unknown[]>(funcName: string, ...args: T) => void;
export default function useCall(): CallDispatcher;
