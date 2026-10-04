// Generate a repeatable near-limit fixture without committing a 1 MiB blob.
import { writeFileSync } from 'node:fs';
const target = process.argv[2] || '/tmp/logan-reader-large.md';
const section = '\n## 验收章节\n\n中文长文阅读。The reader keeps a centered column and source-relative context.\n\n- 固定的示例项目\n- 不同视图保留各自滚动位置\n\n';
let source = '# 接近 1 MiB 的阅读测试\n';
while (Buffer.byteLength(source + section) <= 1024 * 1024 - 128) source += section;
source += '\n## END_REACHABLE\n';
writeFileSync(target, source);
console.log(JSON.stringify({target, bytes: Buffer.byteLength(source)}));
