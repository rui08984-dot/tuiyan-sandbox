const fs = require('fs'), path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'script-schema.json'), 'utf8'));
console.log('$id:', s.$id);
console.log('title:', s.title, '| minItems:', s.minItems, '| maxItems:', s.maxItems);
const it = s.items;
console.log('items keys:', Object.keys(it).join(','));
if (it.oneOf) {
  console.log('items.oneOf branches:', it.oneOf.length);
  it.oneOf.forEach((b, i) => {
    console.log('--- branch', i, 'required:', JSON.stringify(b.required || null));
    if (b.properties) {
      console.log('    props:', Object.keys(b.properties).join(','));
      if (b.properties.id) console.log('    id:', JSON.stringify(b.properties.id));
      if (b.properties.team) console.log('    team enum:', JSON.stringify(b.properties.team.enum || null));
    }
  });
} else {
  console.log(JSON.stringify(it, null, 1).slice(0, 3500));
}
