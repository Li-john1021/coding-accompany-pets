import useStore from "./useStore.js";
function useLang() {
    const { lang } = useStore();
    return lang;
}
export { useLang as default };
