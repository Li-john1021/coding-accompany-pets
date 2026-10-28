import { useEffect, useState } from "react";
function useGetLoadedImage(url) {
    const [image, setImage] = useState(null);
    useEffect(()=>{
        setImage(null);
        if (null == url) return;
        const $image = document.createElement('img');
        const onLoad = ()=>setImage($image);
        const onError = ()=>setImage(null);
        $image.addEventListener('load', onLoad);
        $image.addEventListener('error', onError);
        $image.src = url;
        return ()=>{
            $image.removeEventListener('load', onLoad);
            $image.removeEventListener('error', onError);
        };
    }, [
        url
    ]);
    return image;
}
export { useGetLoadedImage as default };
