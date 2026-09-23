// This deck uses HTML slide bodies. Preserve the current preview shell and theme.
import fs from 'node:fs/promises';
const root = new URL('./', import.meta.url);
const source = await fs.readFile(new URL('exam-teacher-slidev.md', root), 'utf8');
const target = new URL('exam-teacher-preview.html', root);
const shell = await fs.readFile(target, 'utf8');
const parts = source.split(/\r?\n---\r?\n/).slice(1);
const notes = [];
const slides = parts.map((part, index) => {
  const comments = [...part.matchAll(/<!--([\s\S]*?)-->/g)];
  notes.push(comments.at(-1)?.[1].trim() || '');
  const body = part.replace(/<!--[\s\S]*?-->/g, '').trim();
  return `<section class="slidev-layout" data-slide="${index + 1}" aria-label="第 ${index + 1} 页"${index ? ' hidden' : ''}>\n${body}\n</section>`;
});
if (!shell.includes('<main id="stage">') || !/const notes = [\s\S]*?;\s*const slides/.test(shell)) {
  throw new Error('Preview shell markers changed; review the template before rebuilding.');
}
const output = shell
  .replace(/<main id="stage">[\s\S]*?<\/main>/, () => `<main id="stage">\n${slides.join('\n')}\n</main>`)
  .replace(/const notes = [\s\S]*?;\s*const slides/, () => `const notes = ${JSON.stringify(notes).replace(/</g, '\\u003c')};\n\nconst slides`);
await fs.writeFile(target, output);
console.log(`Updated preview: ${slides.length} slides.`);
