import assert from 'node:assert/strict';
import { slugify } from './src/slug.mjs';

assert.equal(slugify('Hello World'), 'hello-world');
assert.equal(slugify('  Canción   Ñandú!! '), 'cancion-nandu');
assert.equal(slugify('a--b__c'), 'a-b-c');
assert.equal(slugify('---'), '');
assert.equal(slugify(''), '');
assert.equal(slugify('Node 24 is out'), 'node-24-is-out');
assert.equal(slugify('abcde fghij', 6), 'abcde');
assert.equal(slugify('abcde fghij', 8), 'abcde-fg');
assert.equal(slugify('x'.repeat(60)).length, 40);
