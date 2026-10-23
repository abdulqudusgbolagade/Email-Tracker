"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
export function Editor({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (html: string, text: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    immediatelyRender: false,
    content: initial,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Email body",
        "aria-multiline": "true",
        class: "rich-editor",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText()),
  });
  if (!editor) return <div className="editor-loading">Loading editor…</div>;
  return (
    <div className="editor-shell">
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Email formatting"
      >
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          aria-label="Bulleted list"
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          type="button"
          aria-label="Insert link"
          onClick={() => {
            const value = window.prompt("Link URL (https://…):");
            if (value && /^https?:\/\//i.test(value))
              editor.chain().focus().setLink({ href: value }).run();
          }}
        >
          Link
        </button>
        <span>Personalize with {"{{first_name}}"}</span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
