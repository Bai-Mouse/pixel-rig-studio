// Optional real-account smoke test: node scripts/test-codex-live.mjs <codex.exe>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const executable = process.argv[2];
if (!executable) throw new Error('Pass an absolute path to codex.exe.');
const dir = await mkdtemp(join(tmpdir(), 'pixel-rig-codex-smoke-'));
const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const { codexPrompt } = await server.ssrLoadModule('/src/codex/context.ts');
  const { parseEditPlan, applyEditPlan } = await server.ssrLoadModule('/src/codex/editPlan.ts');
  // Entirely synthetic. No assets or node/frame metadata is copied from local projects.
  const node = { id: 'body', name: 'Synthetic test node', parentId: null, children: [], assetIds: [], assetId: null, pivot: { x: 0, y: 0 }, transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, visible: true, locked: false };
  const frame = { id: 'smoke-frame', nodeStates: { body: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 } } };
  const project = { assets: {}, settings: { canvasSize: { x: 32, y: 32 }, gridSize: 1, pixelPerfectRotation: true, pixelGridSize: 1, rotationSnapAngle: 0 }, nodes: { body: node }, rootNodeIds: ['body'], frames: [frame], fps: 12, isLooping: true };
  useProjectStore.setState({ ...project, projectName: 'Synthetic connection test', currentFrameIndex: 0, selectedNodeId: 'body', selectedFrameIds: ['smoke-frame'] });
  const prompt = codexPrompt('把 body 节点的第 1 帧旋转设为 15 度，其他属性保持原值。', [], project);
  const schema = join(dir, 'edit.schema.json'), output = join(dir, 'reply.json');
  await copyFile('src-tauri/codex-edit.schema.json', schema);
  const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only',
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
    '--disable', 'shell_tool', '--disable', 'multi_agent', '--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks', '--disable', 'browser_use', '--disable', 'computer_use',
    '--json', '--color', 'never', '--output-schema', schema, '--output-last-message', output, '-C', dir, '-'];
  const child = spawn(executable, args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let tail = '';
  child.stdout.on('data', () => {});
  child.stderr.on('data', (data) => { tail = (tail + data.toString()).slice(-4000); });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const timer = setTimeout(() => child.kill(), 180000);
  const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  clearTimeout(timer);
  if (exit !== 0) throw new Error('Codex smoke test failed: ' + tail.replace(/(?:sk-|Bearer )[a-zA-Z0-9_-]+/g, '[redacted]'));
  const plan = parseEditPlan(JSON.parse(await readFile(output, 'utf8')));
  const result = applyEditPlan(project, plan, Object.keys(project.assets));
  assert.equal(result.frames[0].nodeStates.body.rotation, 15);
  assert.equal(result.frames.length, 1);
  const expected = structuredClone(project);
  expected.frames[0].nodeStates.body.rotation = 15;
  assert.deepEqual(result, expected);
  console.log('PASS: real Codex login -> structured edit plan -> validated scene change (rotation only). Operations: ' + plan.operations.length);
} finally {
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
