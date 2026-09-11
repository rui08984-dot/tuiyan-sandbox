const fs = require('fs');
const t = fs.readFileSync('docs/sandbox/refs/rulebook-text.txt', 'utf8');
for (const k of ['Example of', 'An example', 'example of', 'walkthrough', 'Walkthrough', 'the first day', 'The first day', 'first nomination', 'first nomination', 'Example Day', 'example game', 'Example:']) {
  const n = t.split(k).length - 1;
  if (n > 0) {
    console.log('--- "' + k + '" x' + n);
    let i = t.indexOf(k);
    console.log(t.slice(Math.max(0,i-80), i+220).replace(/\n/g,' | ').slice(0,300));
  }
}
