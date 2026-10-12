import test from 'node:test';
import assert from 'node:assert/strict';
import { customerFields } from '../src/lib/customerFields.ts';

test('customer optional fields retain actual values and deduplicate lists', () => {
  assert.deepEqual(customerFields({ avatar: 'https://example.com/avatar.png', gender: 2 }, {
    remark_mobiles: ['001234', '001234'], tag_id: ['tag1', 'tag1'], add_way: 0, state: 'campaign',
  }), { avatar: 'https://example.com/avatar.png', gender: 2, remarkMobiles: ['001234'], tags: [{ id: 'tag1', name: '' }], addWay: 0, state: 'campaign' });
});

test('missing or malformed optional fields do not invent data', () => {
  assert.deepEqual(customerFields({ avatar: 'javascript:alert(1)', gender: 9 }, {
    remark_mobiles: [null, 123, ''], tag_id: null, add_way: '1', state: 0,
  }), { avatar: '', gender: 0, remarkMobiles: [], tags: [], addWay: null, state: '' });
});
