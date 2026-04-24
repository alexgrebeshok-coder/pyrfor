import { PyrforRuntime } from './src/runtime/index';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = '/tmp/pyrfor-sessions-test';

async function run() {
  await fs.rm(root, { recursive: true, force: true });

  const rt1 = new PyrforRuntime({
    workspacePath: '/tmp',
    persistence: { rootDir: root, debounceMs: 50 },
  });
  await rt1.start();
  const s = rt1.sessions.create({ channel: 'cli', userId: 'u1', chatId: 'c1', systemPrompt: 'sys' });
  rt1.sessions.addMessage(s.id, { role: 'user', content: 'hello' });
  rt1.sessions.addMessage(s.id, { role: 'assistant', content: 'hi back' });
  await new Promise(r => setTimeout(r, 200));
  await rt1.stop();
  const files1 = await fs.readdir(path.join(root, 'cli'));
  console.log('R1 files:', files1);

  const rt2 = new PyrforRuntime({
    workspacePath: '/tmp',
    persistence: { rootDir: root, debounceMs: 50 },
  });
  await rt2.start();
  const found = rt2.sessions.findByContext('cli', 'u1', 'c1');
  console.log('R2 restored msgs:', found?.messages.length, found?.messages.map(m => m.role + ':' + m.content));

  if (found) rt2.sessions.destroy(found.id);
  await new Promise(r => setTimeout(r, 150));
  const files2 = await fs.readdir(path.join(root, 'cli'));
  console.log('R3 after destroy files:', files2);
  await rt2.stop();
}
run().catch(e => { console.error('FAIL:', e); process.exit(1); });
