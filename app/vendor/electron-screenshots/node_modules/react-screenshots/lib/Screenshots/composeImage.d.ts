import type { Bounds, History } from './types';
interface ComposeImageOpts {
    image: HTMLImageElement;
    width: number;
    height: number;
    history: History;
    bounds: Bounds;
}
export default function composeImage({ image, width, height, history, bounds, }: ComposeImageOpts): Promise<Blob>;
export {};
