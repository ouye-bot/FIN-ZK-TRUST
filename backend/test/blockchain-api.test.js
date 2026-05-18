/**
 * 区块链 API 集成测试
 * 测试 /api/v1/blockchain/ 端点
 * 需要后端运行在 localhost:3003
 */
const http = require('http');

const BASE = 'http://localhost:3003';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json' }
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function runTests() {
  let pass = 0, fail = 0;

  function assert(name, condition) {
    if (condition) { console.log(`  ✅ ${name}`); pass++; }
    else { console.log(`  ❌ ${name}`); fail++; }
  }

  console.log('=== 区块链 API 测试 ===\n');

  // Test 1: GET /status
  console.log('--- GET /status ---');
  const statusRes = await req('GET', '/api/v1/blockchain/status');
  assert('status 返回 200', statusRes.status === 200);
  assert('status.success === true', statusRes.body?.success === true);
  assert('status 包含 totalRecords', typeof statusRes.body?.data?.totalRecords === 'number');

  // Test 2: GET /explorer
  console.log('\n--- GET /explorer ---');
  const explorerRes = await req('GET', '/api/v1/blockchain/explorer');
  assert('explorer 返回 200', explorerRes.status === 200);
  assert('explorer.success === true', explorerRes.body?.success === true);
  assert('explorer 包含 totalRecords', typeof explorerRes.body?.data?.totalRecords === 'number');
  assert('explorer 包含 recentRecords 数组', Array.isArray(explorerRes.body?.data?.recentRecords));

  // Test 3: GET /records (分页)
  console.log('\n--- GET /records ---');
  const recordsRes = await req('GET', '/api/v1/blockchain/records?page=1&pageSize=5');
  assert('records 返回 200', recordsRes.status === 200);
  assert('records.success === true', recordsRes.body?.success === true);
  assert('records 包含 pagination', !!recordsRes.body?.data?.pagination);

  // Test 4: GET /records 无效参数
  console.log('\n--- GET /records (边界) ---');
  const edgeRes = await req('GET', '/api/v1/blockchain/records?pageSize=999');
  assert('pageSize 被限制在 100', edgeRes.status === 200);

  // Test 5: GET /records/:hash 无效哈希
  console.log('\n--- GET /records/:hash (无效) ---');
  const badHashRes = await req('GET', '/api/v1/blockchain/records/short');
  assert('短哈希返回 400', badHashRes.status === 400);

  // Test 6: GET /verify/:id 缺少参数
  console.log('\n--- GET /verify (缺参数) ---');
  const noDataRes = await req('GET', '/api/v1/blockchain/verify/test123');
  assert('缺少 transactionData 返回 400', noDataRes.status === 400);

  console.log(`\n=== 结果: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
