#!/usr/bin/env node
// Validasi ruleset Panz-08 God Mode sebelum dirilis:
// - semua JSON bisa diparse dan punya bentuk yang diharapkan
// - setiap ikon di game.atlas punya file sumber dan koordinat yang valid
// - setiap nama unit/bangunan/teknologi punya entri ikon di atlas
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);

function readJson(rel) {
  const file = path.join(root, rel);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${rel}: JSON tidak valid (${error.message})`);
    return null;
  }
}

function isPng(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const sig = Buffer.alloc(8);
    fs.readSync(fd, sig, 0, 8, 0);
    return sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } finally {
    fs.closeSync(fd);
  }
}

const JSON_FILES = [
  'Atlases.json',
  'jsons/ModOptions.json',
  'jsons/Buildings.json',
  'jsons/Difficulties.json',
  'jsons/Nations.json',
  'jsons/Speeds.json',
  'jsons/Techs.json',
  'jsons/TileImprovements.json',
  'jsons/TileResources.json',
  'jsons/UnitPromotions.json',
  'jsons/Units.json',
];

const docs = {};
for (const rel of JSON_FILES) docs[rel] = readJson(rel);

const mod = docs['jsons/ModOptions.json'];
if (mod) {
  if (typeof mod.isBaseRuleset !== 'boolean') fail('ModOptions: isBaseRuleset harus boolean');
  if (typeof mod.modVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(mod.modVersion)) {
    fail('ModOptions: modVersion harus berupa versi seperti 1.2.3');
  }
  if (typeof mod.recommendedGameVersion !== 'string' || !mod.recommendedGameVersion) {
    fail('ModOptions: recommendedGameVersion wajib diisi');
  }
  if (typeof mod.author !== 'string' || !mod.author) fail('ModOptions: author wajib diisi');
}

const atlases = docs['Atlases.json'];
if (!Array.isArray(atlases) || atlases.length === 0) {
  fail('Atlases.json: harus berisi daftar atlas, misalnya ["game"]');
}

// --- atlas ---
const atlasFile = path.join(root, 'game.atlas');
if (!fs.existsSync(atlasFile)) {
  fail('game.atlas tidak ditemukan di root mod');
} else {
  const lines = fs.readFileSync(atlasFile, 'utf8').split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  const pngName = lines[0]?.trim();
  if (!pngName || !fs.existsSync(path.join(root, pngName))) {
    fail(`game.atlas: file atlas "${pngName}" tidak ditemukan`);
  } else if (!isPng(path.join(root, pngName))) {
    fail(`${pngName}: bukan berkas PNG yang valid`);
  }

  const sizeLine = lines.find((l) => l.startsWith('size:'));
  const match = sizeLine?.match(/size:\s*(\d+)\s*,\s*(\d+)/);
  if (!match) {
    fail('game.atlas: baris "size: W, H" tidak ditemukan');
  } else {
    const width = Number(match[1]);
    const height = Number(match[2]);

    let region = null;
    let xy = null;
    let size = null;
    const regions = [];

    const flush = () => {
      if (!region) return;
      if (!xy || !size) {
        fail(`game.atlas: region "${region}" tidak punya xy/size`);
        return;
      }
      if (xy[0] < 0 || xy[1] < 0 || xy[0] + size[0] > width || xy[1] + size[1] > height) {
        fail(`game.atlas: region "${region}" keluar dari batas atlas ${width}x${height}`);
      }
      regions.push(region);
    };

    for (const raw of lines.slice(1)) {
      const line = raw.trim();
      if (!line) continue;
      const indented = raw.startsWith(' ') || raw.startsWith('\t');
      if (!indented) {
        if (/^(size|format|filter|repeat):/.test(line)) continue;
        flush();
        region = line;
        xy = null;
        size = null;
        continue;
      }
      const xyMatch = line.match(/^xy:\s*(\d+)\s*,\s*(\d+)/);
      if (xyMatch) xy = [Number(xyMatch[1]), Number(xyMatch[2])];
      const sizeMatch = line.match(/^size:\s*(\d+)\s*,\s*(\d+)/);
      if (sizeMatch) size = [Number(sizeMatch[1]), Number(sizeMatch[2])];
    }
    flush();

    if (regions.length === 0) fail('game.atlas: tidak ada region ikon');

    for (const name of regions) {
      const source = path.join(root, 'Images', `${name}.png`);
      if (!fs.existsSync(source)) {
        fail(`Region "${name}" tidak punya file sumber Images/${name}.png`);
      } else if (!isPng(source)) {
        fail(`Images/${name}.png: bukan berkas PNG yang valid`);
      }
    }

    // --- nama ruleset vs ikon ---
    const sections = [
      ['jsons/Units.json', 'UnitIcons'],
      ['jsons/Buildings.json', 'BuildingIcons'],
      ['jsons/TileResources.json', 'ResourceIcons'],
      ['jsons/TileImprovements.json', 'ImprovementIcons'],
      ['jsons/UnitPromotions.json', 'UnitPromotionIcons'],
      ['jsons/Nations.json', 'NationIcons'],
    ];

    const checkNames = (names, prefix, label) => {
      for (const name of names) {
        if (!name) continue;
        if (!regions.includes(`${prefix}/${name}`)) {
          fail(`${label}: "${name}" tidak punya ikon ${prefix}/${name} di game.atlas`);
        }
      }
    };

    for (const [rel, prefix] of sections) {
      const data = docs[rel];
      if (!Array.isArray(data)) continue;
      checkNames(data.map((item) => item?.name), prefix, rel);
    }

    const techs = docs['jsons/Techs.json'];
    if (Array.isArray(techs)) {
      const names = techs.flatMap((column) => (Array.isArray(column?.techs) ? column.techs : []));
      checkNames(names.map((tech) => tech?.name), 'TechIcons', 'jsons/Techs.json');
    }
  }
}

// --- PNG di Images/ ---
const imagesDir = path.join(root, 'Images');
if (!fs.existsSync(imagesDir)) {
  fail('Folder Images tidak ditemukan');
} else {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.png')) {
        if (!isPng(full)) fail(`${path.relative(root, full)}: bukan PNG valid`);
      }
    }
  };
  walk(imagesDir);
}

if (!fs.existsSync(path.join(root, 'preview.png'))) fail('preview.png tidak ditemukan');

if (errors.length) {
  console.error(`Validasi gagal (${errors.length} masalah):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('Validasi mod berhasil: JSON, atlas, ikon, dan preview konsisten.');
