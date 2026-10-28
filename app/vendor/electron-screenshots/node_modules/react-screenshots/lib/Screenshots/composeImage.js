import { HistoryItemType } from "./types.js";
function composeImage({ image, width, height, history, bounds }) {
    return new Promise((resolve, reject)=>{
        const $canvas = document.createElement('canvas');
        const targetWidth = bounds.width * window.devicePixelRatio;
        const targetHeight = bounds.height * window.devicePixelRatio;
        $canvas.width = targetWidth;
        $canvas.height = targetHeight;
        const ctx = $canvas.getContext('2d');
        if (!ctx) return reject(new Error('convert image to blob fail'));
        const rx = image.naturalWidth / width;
        const ry = image.naturalHeight / height;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'low';
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, bounds.width, bounds.height);
        ctx.drawImage(image, bounds.x * rx, bounds.y * ry, bounds.width * rx, bounds.height * ry, 0, 0, bounds.width, bounds.height);
        history.stack.slice(0, history.index + 1).forEach((item)=>{
            if (item.type === HistoryItemType.Source) item.draw(ctx, item);
        });
        $canvas.toBlob((blob)=>{
            if (!blob) return reject(new Error('canvas toBlob fail'));
            resolve(blob);
        }, 'image/png');
    });
}
export { composeImage as default };
