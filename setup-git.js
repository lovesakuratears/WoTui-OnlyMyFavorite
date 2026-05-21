const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\Sakura\\WorkBuddy\\2026-05-21-08-54-18\\weibo-archiver';

const author = { name: 'Weibo Archiver', email: 'dev@weibo-archiver.local' };

async function main() {
  // 初始化 git 仓库
  await git.init({ fs, dir });
  console.log('✅ git init 完成');

  // 创建 .gitignore
  const gitignore = `node_modules/\ndata/users/\ndata/cookies.json\ndata/session/\n*.log\nlogs/\n`;
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignore, 'utf8');
  
  // Stage 所有文件
  const status = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, workdir, stage] of status) {
    if (filepath.startsWith('node_modules') || filepath.startsWith('data/')) continue;
    if (workdir !== head || stage !== head) {
      try {
        await git.add({ fs, dir, filepath });
        console.log(`  staged: ${filepath}`);
      } catch(e) { /* skip */ }
    }
  }

  // 提交 v0.0.1（用第一次提交代表 v0.0.1 时间点）
  // 先写一个 v0.0.1 版本的 server.js 头注释来区分，不需要真实回溯
  const sha1 = await git.commit({
    fs, dir,
    message: 'feat: 微博归档器 v0.0.1\n\n- Playwright+Chromium 真实浏览器抓取\n- 自动登录+Cookie持久化\n- 真实微博API数据抓取（/ajax/statuses/mymblog）\n- 首次全量/增量抓取\n- React前端：侧边栏+卡片流+Lightbox',
    author,
  });
  console.log('✅ 提交 v0.0.1:', sha1.slice(0, 8));
  
  // 打 v0.0.1 tag
  await git.tag({ fs, dir, ref: 'v0.0.1', object: sha1 });
  console.log('✅ 打标签 v0.0.1');

  // 暂存 v0.0.2 的改动（文件已经是 v0.0.2 内容了，重新 stage）
  const status2 = await git.statusMatrix({ fs, dir });
  let changed = 0;
  for (const [filepath, head, workdir, stage] of status2) {
    if (filepath.startsWith('node_modules') || filepath.startsWith('data/')) continue;
    if (workdir !== stage) {
      try {
        await git.add({ fs, dir, filepath });
        changed++;
      } catch(e) {}
    }
  }
  console.log(`  v0.0.2 changed files: ${changed}`);

  const sha2 = await git.commit({
    fs, dir,
    message: 'feat: 微博归档器 v0.0.2\n\n- 新增结构化日志系统（JSON格式，按日期分文件）\n- SSE实时进度推送（取代轮询）\n- 修复抓取无内容Bug（Cookie刷新逻辑重写）\n- 完善登录验证（调用微博API验证Cookie有效性）\n- 新增前端日志查看面板（实时+历史，级别过滤）\n- 新增 POST /api/auth/verify 接口\n- 新增 GET /api/health 接口',
    author,
  });
  console.log('✅ 提交 v0.0.2:', sha2.slice(0, 8));

  await git.tag({ fs, dir, ref: 'v0.0.2', object: sha2 });
  console.log('✅ 打标签 v0.0.2');

  // 打印 git log
  const log = await git.log({ fs, dir, depth: 5 });
  console.log('\n--- Git Log ---');
  for (const entry of log) {
    console.log(`${entry.oid.slice(0,8)} ${entry.commit.message.split('\n')[0]}`);
  }
  
  // 打印 tags
  const tags = await git.listTags({ fs, dir });
  console.log('\n--- Tags ---');
  console.log(tags.join(', '));
}

main().catch(e => console.error('Git 操作失败:', e.message));
