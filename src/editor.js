import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { vim, Vim } from "@replit/codemirror-vim";
export function createEditor(parent, contents, save, run, close) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: contents,
      extensions: [
        vim(),
        lineNumbers(),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              run();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) save(update.state.doc.toString());
        }),
      ],
    }),
  });
  Vim.defineEx("write", "w", () => save(view.state.doc.toString()));
  Vim.defineEx("quit", "q", close);
  Vim.defineEx("wq", "wq", () => {
    save(view.state.doc.toString());
    close();
  });
  view.focus();
  return {
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    source: () => view.state.sliceDoc(),
    selected: () => {
      const range = view.state.selection.main;
      return range.empty
        ? view.state.sliceDoc()
        : view.state.sliceDoc(range.from, range.to);
    },
  };
}
