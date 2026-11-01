import { API } from './api.js';
const snapshot = list => list.map(v => ({ volume_id: v.volume_id, volume_name: v.volume_name }));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function validateVolumeName(name) {
  if (typeof name !== 'string' || name !== name.trim() || /[\r\n\x00-\x1f]/.test(name)) throw new Error('请提供完整分卷名，例如「第二卷：远行」');
  const m = name.match(/^(第[^：\s]+卷：)(.+)$/u);
  if (!m || m[2] !== m[2].trim() || m[2].length > 16 || name.length > 20) throw new Error('分卷名须含「第几卷：」前缀，卷名最多16字符、完整名最多20字符');
  return m[1];
}

// 只管理分卷；不移动章节，不删除分卷，也不提交审核。
export async function changeVolume({ adapter, book, volume, remoteName, action, journal, persist, saveBook, dryRun = false, replaceVolumeId, resolveNotApplied = false }) {
  if (!volume || ['__proto__', 'constructor', 'prototype'].includes(volume) || !['create', 'rename'].includes(action)) throw new Error('分卷操作需要有效的 --volume');
  const prefix = validateVolumeName(remoteName);
  const manageUrl = book.volumes[volume]?.manageUrl ?? Object.values(book.volumes)[0]?.manageUrl;
  if (!manageUrl) throw new Error('作品至少需要一个已有绑定作为管理入口');
  await adapter.assertBook(book);
  const list = await adapter.volumes(book), before = snapshot(list);
  const binding = book.volumes[volume];
  const key = `${book.bookId}/${volume}`;
  let op = journal[key];
  if (op?.status === 'pending' && (op.action !== action || op.remoteName !== remoteName)) throw new Error('该卷上次操作未核实，请先用相同命令核对恢复');
  if (replaceVolumeId) {
    if (action !== 'create' || !binding) throw new Error('替换临存绑定仅适用于已绑定卷的新建');
    const source = await adapter.resolveVolume(book, binding, list);
    if (source.volume_id !== replaceVolumeId || binding.remoteName === remoteName) throw new Error('临存源卷ID或目标不符');
  }
  if (resolveNotApplied) {
    if (dryRun || action !== 'create' || op?.status !== 'pending' || !same(op.before, before) || list.some(v=>v.volume_name === remoteName)) throw new Error('无法确认旧新建尚未应用，保留日志');
    journal[key] = {...op,status:'not-applied',checkedAt:new Date().toISOString()};
    await persist(journal);
    return {volume,remoteName,status:'not-applied',message:'仅回读并登记旧请求尚未应用，未重发；后续显式新建保留旧日志'};
  }
  let target;
  if (op?.status === 'pending') {
    if (action === 'rename') {
      const expected = op.before.map(v => v.volume_id === op.volumeId ? { ...v, volume_name: remoteName } : v);
      if (!same(expected, before)) throw new Error('上次分卷写入结果仍未核实，或其他卷发生变化；不会自动重试写入');
      target = list.find(v => v.volume_id === op.volumeId);
    } else {
      target = list.find(v => v.volume_name === remoteName);
      if (!target || !same(before, [...op.before, { volume_id: target.volume_id, volume_name: remoteName }])) throw new Error('上次新建分卷结果仍未核实；不会自动再次新建');
    }
  } else {
    if (action === 'create') {
      if (binding && binding.remoteName !== remoteName && !replaceVolumeId) throw new Error('本地卷已绑定其他后台卷，拒绝替换');
      const found = list.filter(v => v.volume_name === remoteName);
      if (found.length > 1) throw new Error('存在重名分卷，停止操作');
      target = found[0];
      if (target && binding?.volumeId && binding.volumeId !== target.volume_id) throw new Error('分卷 ID 与既有绑定冲突');
      if (Object.entries(book.volumes).some(([local,b]) => local !== volume && (b.remoteName === remoteName || (target && b.volumeId === target.volume_id)))) throw new Error('该后台分卷已绑定其他本地卷');
    } else {
      if (!binding) throw new Error('改名需要已绑定的 --volume');
      target = await adapter.resolveVolume(book, binding, list);
      if (validateVolumeName(target.volume_name) !== prefix) throw new Error('改名不能修改分卷序号前缀');
      if (list.some(v => v.volume_name === remoteName && v.volume_id !== target.volume_id)) throw new Error('目标分卷名已存在');
    }
    const unchanged = target?.volume_name === remoteName;
    if (dryRun) return { action, remoteName, volume, write: !unchanged, message: '仅 HTTP 查询预览，未写入' };
    if (!unchanged) {
      op = { ...(op ? { previousAttempt: op } : {}), action, remoteName, volumeId: target?.volume_id, before, status: 'pending', startedAt: new Date().toISOString() };
      journal[key] = op; await persist(journal);
      if (action === 'create') await adapter.request('POST', API.addVolume, { book_id: book.bookId, volume_name: remoteName });
      else await adapter.request('POST', API.modifyVolumes, { book_id: book.bookId, volume_data: JSON.stringify(before.map(v => v.volume_id === target.volume_id ? { ...v, volume_name: remoteName } : v)) });
      const after = await adapter.volumes(book);
      target = action === 'create' ? after.find(v => v.volume_name === remoteName) : after.find(v => v.volume_id === target.volume_id);
      const actual = snapshot(after);
      const expected = action === 'create' && target ? [...before, { volume_id: target.volume_id, volume_name: remoteName }] : before.map(v => v.volume_id === op.volumeId ? { ...v, volume_name: remoteName } : v);
      if (!target || target.volume_name !== remoteName || !same(actual, expected)) throw new Error('分卷回读不一致，保留 pending；请核对后恢复');
    }
  }
  if (dryRun) return { action, remoteName, volume, write: false, message: '上次操作已回读，仅预览，未更新本地绑定' };
  book.volumes[volume] = { ...(binding ?? {}), manageUrl, remoteName, volumeId: target.volume_id };
  await saveBook(book);
  journal[key] = { ...op, action, remoteName, volumeId: target.volume_id, status: 'verified', verifiedAt: new Date().toISOString() };
  await persist(journal);
  return { action, volume, remoteName, volumeId: target.volume_id, status: 'verified' };
}
