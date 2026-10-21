import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeOptions } from '../src/pages/customerEmployees.ts';

test('shows internal names while retaining IDs and disambiguating duplicate names', () => {
  const options = employeeOptions(['a', 'b', 'c', 'missing', 'toString'], { a: ' 张三 ', b: '李四', c: '张三' });
  assert.deepEqual(options.map(item => item.value), ['a', 'b', 'c', 'missing', 'toString']);
  assert.deepEqual(options.map(item => item.label), ['张三（a）', '李四', '张三（c）', 'missing', 'toString']);
  assert.equal(options[1].searchText, '李四 b');
});
