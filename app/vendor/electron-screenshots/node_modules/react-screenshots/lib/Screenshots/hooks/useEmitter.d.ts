import type { EmitterListener } from '../types';
export interface EmitterDispatcher {
    on: (event: string, listener: EmitterListener) => void;
    off: (event: string, listener: EmitterListener) => void;
    emit: (event: string, ...args: unknown[]) => void;
    reset: () => void;
}
export default function useEmitter(): EmitterDispatcher;
