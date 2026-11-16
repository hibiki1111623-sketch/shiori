export const DEFAULT = {
  name: 'しおり',
  subtitle: '次の一冊を、見つけに。',
  note: '',
  accent: '#2e513e',
  paper: '#f7f5ee',
  density: 'roomy',
  hero: true,
  picks: []
};

export const PRESETS = [
  { name: '深緑', accent: '#2e513e', paper: '#f7f5ee' },
  { name: '藍', accent: '#345179', paper: '#f0f3f7' },
  { name: '煉瓦', accent: '#8a423a', paper: '#faf0e8' },
  { name: '藤', accent: '#694b78', paper: '#f6f1f8' }
];

function hex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value.toLowerCase() : fallback;
}

export function appearance(value = {}) {
  const string = (key, size) => typeof value[key] === 'string' ? value[key].trim().slice(0, size) : '';
  return {
    name: string('name', 24) || DEFAULT.name,
    subtitle: string('subtitle', 70),
    note: string('note', 200),
    accent: hex(value.accent, DEFAULT.accent),
    paper: hex(value.paper, DEFAULT.paper),
    density: value.density === 'compact' ? 'compact' : 'roomy',
    hero: value.hero !== false,
    picks: [...new Set((Array.isArray(value.picks) ? value.picks : []).filter(id => /^\d{6}$/.test(id)))].slice(0, 8)
  };
}

function contrastColor(color) {
  const rgb = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255);
  const values = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export function applyAppearance(node, theme) {
  node.style.setProperty('--accent', theme.accent);
  node.style.setProperty('--paper', theme.paper);
  node.style.setProperty('--on-accent', contrastColor(theme.accent));
  node.style.setProperty('--on-paper', contrastColor(theme.paper));
  node.dataset.density = theme.density;
}

export function isbn13(input = '') {
  const value = input.normalize('NFKC').toUpperCase().replace(/[\s\p{Pd}]/gu, '');
  const checksum = text => [...text].reduce((sum, digit, index) => sum + digit * (index % 2 ? 3 : 1), 0);
  if (/^97[89]\d{10}$/.test(value)) return checksum(value) % 10 === 0 ? value : '';
  if (!/^\d{9}[\dX]$/.test(value)) return '';
  const sum = [...value].reduce((acc, digit, index) => acc + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
  if (sum % 11) return '';
  const start = '978' + value.slice(0, 9);
  return start + ((10 - checksum(start) % 10) % 10);
}

export function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 96))
    .replace(/\s/g, '');
}
