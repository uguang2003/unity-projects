#!/usr/bin/env node
/**
 * @description: Unity WebGL Build 大文件拆分脚本
 *   将 Build 目录下大于 25MB 的资源文件拆分为多个 24MB 的分片，便于上传 Git 与
 *   部署到 EdgeOne（单文件 25MB 上限）。每个被拆的文件会在同目录生成 manifest.json
 *   描述分片数量和总大小，供运行时 split-loader.js 合并使用。
 *   用法（在 unity-projects 目录下）: node split-build.js
 * @author: UG - 一个斗码大陆苦逼的三段码之气的少年，并没有神秘戒指中码老的帮助，但总有一天，我会成为斗码大陆中码帝一样的存在。三十年河东，三十年河西，莫欺少年穷。
 * @date: 2026-04-25
 */
const fs = require('fs');
const path = require('path');

const PART_SIZE = 24 * 1024 * 1024;
const SPLIT_THRESHOLD = 25 * 1024 * 1024;
const ROOT = __dirname;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function splitFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size <= SPLIT_THRESHOLD) return null;

  const parts = Math.ceil(stat.size / PART_SIZE);
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  console.log(`[拆分] ${rel} (${formatSize(stat.size)}) -> ${parts} 片`);

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(PART_SIZE);
    for (let i = 0; i < parts; i++) {
      const partPath = `${filePath}.part${String(i).padStart(2, '0')}`;
      const bytesRead = fs.readSync(fd, buffer, 0, PART_SIZE, i * PART_SIZE);
      fs.writeFileSync(partPath, buffer.subarray(0, bytesRead));
      console.log(`        ${path.basename(partPath)} (${formatSize(bytesRead)})`);
    }
  } finally {
    fs.closeSync(fd);
  }

  const manifest = {
    originalName: path.basename(filePath),
    totalSize: stat.size,
    partSize: PART_SIZE,
    parts,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(`${filePath}.manifest.json`, JSON.stringify(manifest, null, 2));
  fs.unlinkSync(filePath);
  return manifest;
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (
      stat.isFile() &&
      stat.size > SPLIT_THRESHOLD &&
      !/\.part\d+$/.test(name) &&
      !name.endsWith('.manifest.json')
    ) {
      splitFile(full);
    }
  }
}

console.log('扫描目录:', ROOT);
walk(ROOT);
console.log('全部拆分完成');
