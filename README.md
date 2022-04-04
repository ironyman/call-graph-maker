# call-graph-maker
Selecting the following functions and doing the `Track current function` command we can produce the following graph.
```
skip_chars(bool, Lisp_Object, Lisp_Object, bool)
scan_lists(EMACS_INT, EMACS_INT, EMACS_INT, bool)
 back_comment(ptrdiff_t, ptrdiff_t, ptrdiff_t, bool, int, ptrdiff_t *, ptrdiff_t *)
  dec_bytepos(ptrdiff_t)
  char_quoted(ptrdiff_t, ptrdiff_t)
 prev_char_comend_first(ptrdiff_t, ptrdiff_t)
scan_words(ptrdiff_t, EMACS_INT)
 in_classes(int, Lisp_Object)
skip_syntaxes(bool, Lisp_Object, Lisp_Object)
```