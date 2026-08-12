const fs = require('node:fs');
const path = require('node:path');

const packageDir = path.dirname(require.resolve('car-brand-logos/package.json'));
const outputDir = path.join(process.cwd(), 'public', 'brands');

fs.mkdirSync(outputDir, { recursive: true });

for (const name of fs.readdirSync(packageDir)) {
  if (!/-logo\.(svg|png)$/i.test(name)) continue;
  fs.copyFileSync(path.join(packageDir, name), path.join(outputDir, name));
}

console.log(`Installed vehicle brand assets to ${outputDir}.`);
