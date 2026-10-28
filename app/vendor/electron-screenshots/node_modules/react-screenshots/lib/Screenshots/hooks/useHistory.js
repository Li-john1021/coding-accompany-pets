import { useCallback } from "react";
import { HistoryItemType } from "../types.js";
import useDispatcher from "./useDispatcher.js";
import useStore from "./useStore.js";
function useHistory() {
    const { history } = useStore();
    const { setHistory } = useDispatcher();
    const push = useCallback((action)=>{
        const { index, stack } = history;
        stack.forEach((item)=>{
            if (item.type === HistoryItemType.Source) item.isSelected = false;
        });
        if (action.type === HistoryItemType.Source) action.isSelected = true;
        else if (action.type === HistoryItemType.Edit) action.source.isSelected = true;
        stack.splice(index + 1);
        stack.push(action);
        setHistory?.({
            index: stack.length - 1,
            stack
        });
    }, [
        history,
        setHistory
    ]);
    const pop = useCallback(()=>{
        const { stack } = history;
        stack.pop();
        setHistory?.({
            index: stack.length - 1,
            stack
        });
    }, [
        history,
        setHistory
    ]);
    const undo = useCallback(()=>{
        const { index, stack } = history;
        const item = stack[index];
        if (item) {
            if (item.type === HistoryItemType.Source) item.isSelected = false;
            else if (item.type === HistoryItemType.Edit) item.source.editHistory.pop();
        }
        setHistory?.({
            index: index <= 0 ? -1 : index - 1,
            stack
        });
    }, [
        history,
        setHistory
    ]);
    const redo = useCallback(()=>{
        const { index, stack } = history;
        const item = stack[index + 1];
        if (item) {
            if (item.type === HistoryItemType.Source) item.isSelected = false;
            else if (item.type === HistoryItemType.Edit) item.source.editHistory.push(item);
        }
        setHistory?.({
            index: index >= stack.length - 1 ? stack.length - 1 : index + 1,
            stack
        });
    }, [
        history,
        setHistory
    ]);
    const set = useCallback((history)=>{
        setHistory?.({
            ...history
        });
    }, [
        setHistory
    ]);
    const select = useCallback((action)=>{
        history.stack.forEach((item)=>{
            if (item.type === HistoryItemType.Source) if (item === action) item.isSelected = true;
            else item.isSelected = false;
        });
        setHistory?.({
            ...history
        });
    }, [
        history,
        setHistory
    ]);
    const clearSelect = useCallback(()=>{
        history.stack.forEach((item)=>{
            if (item.type === HistoryItemType.Source) item.isSelected = false;
        });
        setHistory?.({
            ...history
        });
    }, [
        history,
        setHistory
    ]);
    const reset = useCallback(()=>{
        setHistory?.({
            index: -1,
            stack: []
        });
    }, [
        setHistory
    ]);
    return [
        {
            index: history.index,
            stack: history.stack,
            top: history.stack.slice(history.index, history.index + 1)[0]
        },
        {
            push,
            pop,
            undo,
            redo,
            set,
            select,
            clearSelect,
            reset
        }
    ];
}
export { useHistory as default };
