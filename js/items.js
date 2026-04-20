// ══════════════════════════════════════
// 품목 데이터 관리 — Supabase items 테이블 (본사·유통사 공유)
// localStorage는 오프라인 캐시로만 사용
// ══════════════════════════════════════
const Items = (() => {
  const CACHE_KEY = 'sunbi_items_cache';
  const LEGACY_KEY = 'sunbi_items'; // 구 버전 localStorage-only 데이터
  const SAFETY = 0.15;

  // Supabase 비어 있을 때 시드용 / 오프라인 폴백
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

  let _cache = null;

  function readCache() {
    try {
      const s = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (s && s.length > 0) return s;
    } catch { /* ignore */ }
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (legacy && legacy.length > 0) return legacy;
    } catch { /* ignore */ }
    return DEFAULTS;
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }

  // 동기 로드: 캐시 반환 (refresh가 미리 호출돼 있어야 최신)
  function load() {
    if (_cache) return _cache;
    _cache = readCache();
    return _cache;
  }

  function fromRow(r) {
    return { id: r.id, name: r.name, unit: r.unit, monthAvg: r.month_avg };
  }

  // Supabase에서 최신 품목 목록 가져와 캐시 갱신
  async function refresh() {
    try {
      const rows = await Api.get('items', 'select=id,name,unit,month_avg,sort_order&order=sort_order.asc,created_at.asc');
      _cache = rows.map(fromRow);
      writeCache(_cache);
      return _cache;
    } catch (e) {
      console.warn('Items.refresh 실패, 캐시 사용:', e.message);
      return load();
    }
  }

  // 테이블이 비었을 때만 DEFAULTS 또는 기존 localStorage 데이터로 시드
  async function seedIfEmpty() {
    try {
      const rows = await Api.get('items', 'select=id&limit=1');
      if (rows.length > 0) return false;

      let seed;
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
        seed = (legacy && legacy.length > 0) ? legacy : DEFAULTS;
      } catch {
        seed = DEFAULTS;
      }

      const payload = seed.map((it, i) => ({
        id: it.id,
        name: it.name,
        unit: it.unit || '개',
        month_avg: it.monthAvg || 0,
        sort_order: i + 1,
      }));
      await Api.insert('items', payload);
      await refresh();
      return true;
    } catch (e) {
      console.warn('Items.seedIfEmpty 실패:', e.message);
      return false;
    }
  }

  async function add(name, unit, monthAvg) {
    const id = 'item_' + Date.now();
    const sortOrder = (load().length || 0) + 1;
    await Api.insert('items', [{
      id,
      name,
      unit: unit || '개',
      month_avg: monthAvg || 0,
      sort_order: sortOrder,
    }]);
    await refresh();
    return id;
  }

  async function removeById(id) {
    await Api.delete('items', `id=eq.${encodeURIComponent(id)}`);
    await refresh();
  }

  async function remove(idx) {
    const items = load();
    const target = items[idx];
    if (!target) return;
    await removeById(target.id);
  }

  async function updateById(id, fields) {
    const patch = {};
    if (fields.name !== undefined) patch.name = fields.name;
    if (fields.unit !== undefined) patch.unit = fields.unit;
    if (fields.monthAvg !== undefined) patch.month_avg = fields.monthAvg;
    if (Object.keys(patch).length === 0) return;
    await Api.patch('items', `id=eq.${encodeURIComponent(id)}`, patch);
    await refresh();
  }

  async function update(idx, fields) {
    const items = load();
    const target = items[idx];
    if (!target) return;
    await updateById(target.id, fields);
  }

  return {
    load,
    refresh,
    seedIfEmpty,
    add,
    remove,
    removeById,
    update,
    updateById,
    SAFETY,
  };
})();
