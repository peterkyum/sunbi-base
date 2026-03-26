// ══════════════════════════════════════
// 품목 데이터 관리
// ══════════════════════════════════════
const Items = (() => {
  const STORAGE_KEY = 'sunbi_items';
  const SAFETY = 0.15;

  const DEFAULTS = [
    { id: 'bibim',   name: '비빔장소스',     unit: '박스', monthAvg: 45 },
    { id: 'jang',    name: '장칼국수소스',   unit: '박스', monthAvg: 38 },
    { id: 'sobaw',   name: '메밀쯔유',       unit: '박스', monthAvg: 30 },
    { id: 'myulchi', name: '멸치분말스프',   unit: '박스', monthAvg: 20 },
    { id: 'beef',    name: '소고기육수분말', unit: '박스', monthAvg: 25 },
    { id: 'yukgae',  name: '육개장소스',     unit: '박스', monthAvg: 35 },
    { id: 'dak',     name: '닭칼국수농축액', unit: '박스', monthAvg: 28 },
    { id: 'daksal',  name: '닭가슴살채',     unit: '박스', monthAvg: 50 },
    { id: 'banjuk',  name: '반죽면대',       unit: '박스', monthAvg: 200 },
  ];

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return s && s.length > 0 ? s : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  }

  function save(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function add(name, unit, monthAvg) {
    const items = load();
    const id = 'item_' + Date.now();
    items.push({ id, name, unit: unit || '개', monthAvg: monthAvg || 0 });
    save(items);
    return id;
  }

  function remove(idx) {
    const items = load();
    items.splice(idx, 1);
    save(items);
  }

  return { load, save, add, remove, SAFETY };
})();
