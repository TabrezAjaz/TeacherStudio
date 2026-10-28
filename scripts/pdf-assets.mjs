import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  const destination = join('public', 'pdf-assets', name);
  mkdirSync(destination, { recursive: true });
  cpSync(join('node_modules', 'pdfjs-dist', name), destination, { recursive: true });
}
cpSync(join('node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'), join('public', 'pdf-assets', 'pdf.worker.min.mjs'));
cpSync(join('node_modules', 'pdfjs-dist', 'LICENSE'), join('public', 'pdf-assets', 'LICENSE'));
for (const name of ['react', 'react-dom', 'pdfjs-dist', 'pdf-lib', 'perfect-freehand', 'idb', 'zod', 'lucide-react', '@tauri-apps/api']) {
  const source = join('node_modules', name);
  const destination = join('public', 'licenses', name.replace('/', '-'));
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(source).filter(file => /^(licen[cs]e|notice|copyright)/i.test(file))) cpSync(join(source, file), join(destination, file), { recursive: true });
}
