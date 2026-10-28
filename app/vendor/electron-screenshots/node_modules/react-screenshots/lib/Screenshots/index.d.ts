import type { ReactElement } from 'react';
import './icons/iconfont.less';
import './screenshots.less';
import type { Lang } from './zh_CN';
export interface ScreenshotsProps {
    url?: string;
    width: number;
    height: number;
    lang?: Partial<Lang>;
    className?: string;
    [key: string]: unknown;
}
export default function Screenshots({ url, width, height, lang, className, ...props }: ScreenshotsProps): ReactElement;
