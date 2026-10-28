const hiddenTextareaStyle = `
min-width: 0 !important;
width: 0 !important;
min-height: 0 !important;
height:0 !important;
visibility: hidden !important;
overflow: hidden !important;
position: absolute !important;
z-index: -1000 !important;
top:0 !important;
right:0 !important;
`;
const sizeStyle = [
    'letter-spacing',
    'line-height',
    'padding-top',
    'padding-bottom',
    'font-family',
    'font-weight',
    'font-size',
    'font-variant',
    'text-rendering',
    'text-transform',
    'text-indent',
    'padding-left',
    'padding-right',
    'border-width',
    'box-sizing',
    'white-space',
    'word-break'
];
let hiddenTextarea;
function getComputedSizeInfo(node) {
    const style = window.getComputedStyle(node);
    const boxSizing = style.getPropertyValue('box-sizing') || style.getPropertyValue('-moz-box-sizing') || style.getPropertyValue('-webkit-box-sizing');
    const paddingSize = parseFloat(style.getPropertyValue('padding-bottom')) + parseFloat(style.getPropertyValue('padding-top'));
    const borderSize = parseFloat(style.getPropertyValue('border-bottom-width')) + parseFloat(style.getPropertyValue('border-top-width'));
    const sizingStyle = sizeStyle.map((name)=>`${name}:${style.getPropertyValue(name)}`).join(';');
    return {
        sizingStyle,
        paddingSize,
        borderSize,
        boxSizing
    };
}
function calculateNodeSize(textarea, value, maxWidth, maxHeight) {
    if (!hiddenTextarea) {
        hiddenTextarea = document.createElement('textarea');
        hiddenTextarea.setAttribute('tab-index', '-1');
        document.body.appendChild(hiddenTextarea);
    }
    const { paddingSize, borderSize, boxSizing, sizingStyle } = getComputedSizeInfo(textarea);
    hiddenTextarea.setAttribute('style', `${sizingStyle};${hiddenTextareaStyle};max-width:${maxWidth}px;max-height:${maxHeight}px`);
    hiddenTextarea.value = value || ' ';
    let width = hiddenTextarea.scrollWidth;
    let height = hiddenTextarea.scrollHeight;
    if ('border-box' === boxSizing) {
        width += borderSize;
        height += borderSize;
    } else if ('content-box' === boxSizing) {
        width -= paddingSize;
        height -= paddingSize;
    }
    return {
        width: Math.min(width, maxWidth),
        height: Math.min(height, maxHeight)
    };
}
export { calculateNodeSize as default, getComputedSizeInfo };
