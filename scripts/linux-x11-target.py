#!/usr/bin/env python3
import tkinter as tk


root = tk.Tk()
root.title("KeyShift integration target")

editor = tk.Text(root, width=60, height=8)
editor.pack(fill="both", expand=True)
editor.focus_set()


def select_all(_event: tk.Event) -> str:
    editor.tag_add("sel", "1.0", "end-1c")
    editor.mark_set("insert", "end-1c")
    return "break"


def copy_selection(_event: tk.Event) -> str:
    try:
        selected = editor.get("sel.first", "sel.last")
    except tk.TclError:
        return "break"

    root.clipboard_clear()
    root.clipboard_append(selected)
    root.update_idletasks()
    return "break"


def paste_clipboard(_event: tk.Event) -> str:
    try:
        editor.delete("sel.first", "sel.last")
    except tk.TclError:
        pass

    editor.insert("insert", root.clipboard_get())
    return "break"


editor.bind("<Control-a>", select_all)
editor.bind("<Control-c>", copy_selection)
editor.bind("<Control-v>", paste_clipboard)
root.mainloop()
