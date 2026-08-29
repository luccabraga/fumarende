import { Fragment, type ReactNode } from 'react';

/** Inline: `code`, **bold**, *italic*. Everything else stays literal text. */
function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((t) => t !== '');
  return tokens.map((tok, i) => {
    if (tok.startsWith('`') && tok.endsWith('`')) return <code key={i}>{tok.slice(1, -1)}</code>;
    if (tok.startsWith('**') && tok.endsWith('**')) return <strong key={i}>{tok.slice(2, -2)}</strong>;
    if (tok.startsWith('*') && tok.endsWith('*')) return <em key={i}>{tok.slice(1, -1)}</em>;
    return <Fragment key={i}>{tok}</Fragment>;
  });
}

type Block =
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; lines: string[] };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'h', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (current?.type !== 'ul') {
        flush();
        current = { type: 'ul', items: [] };
      }
      current.items.push(ul[1]);
      continue;
    }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (current?.type !== 'ol') {
        flush();
        current = { type: 'ol', items: [] };
      }
      current.items.push(ol[1]);
      continue;
    }
    if (current?.type !== 'p') {
      flush();
      current = { type: 'p', lines: [] };
    }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

export function Markdown({ source }: { source: string }): JSX.Element {
  const blocks = parseBlocks(source);
  return (
    <div className="markdown">
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const H = `h${b.level}` as 'h1' | 'h2' | 'h3';
          return <H key={i}>{renderInline(b.text)}</H>;
        }
        if (b.type === 'ul') {
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{renderInline(b.lines.join(' '))}</p>;
      })}
    </div>
  );
}
