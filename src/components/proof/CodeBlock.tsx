/** A scrollable, keyboard-focusable block of text or code. Never interpreted — always shown as plain text. */
export function CodeBlock({ code, path, note }: { code: string; path?: string; note?: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-night text-white/90">
      {(path || note) && (
        <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-1.5 text-xs text-white/60">
          <span className="truncate font-mono">{path}</span>
          {note && <span className="shrink-0">{note}</span>}
        </figcaption>
      )}
      <pre tabIndex={0} className="max-h-96 overflow-auto p-3 text-[13px] leading-relaxed" aria-label={path ? `Contents of ${path}` : "Code"}>
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </figure>
  )
}
