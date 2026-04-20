-- ══════════════════════════════════════
-- items 테이블 추가: 품목 마스터를 본사·유통사 모두 공유
-- localStorage 의존 → Supabase 중앙 저장으로 전환
-- ══════════════════════════════════════

create table if not exists public.items (
  id          text primary key,
  name        text not null,
  unit        text not null default '개',
  month_avg   integer not null default 0,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_sort_idx on public.items (sort_order, created_at);

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- RLS: 인증된 사용자 모두 read, 모두 write (본사/유통사 둘 다 품목 추가 가능)
-- 더 엄격히 본사만 write로 제한하려면 추가 정책 필요 (현재는 sunbi-base 자체 규칙으로 본사만 inbound 탭 진입)
alter table public.items enable row level security;

drop policy if exists "items_read_auth" on public.items;
create policy "items_read_auth" on public.items
  for select to authenticated using (true);

drop policy if exists "items_write_auth" on public.items;
create policy "items_write_auth" on public.items
  for all to authenticated using (true) with check (true);

-- 기존 DEFAULTS 시드 (테이블이 비어 있을 때만 입력)
insert into public.items (id, name, unit, month_avg, sort_order)
select * from (values
  ('bibim',   '비빔장소스',     '박스', 45, 1),
  ('jang',    '장칼국수소스',   '박스', 38, 2),
  ('sobaw',   '메밀쯔유',       '박스', 30, 3),
  ('myulchi', '멸치분말스프',   '박스', 20, 4),
  ('beef',    '소고기육수분말', '박스', 25, 5),
  ('yukgae',  '육개장소스',     '박스', 35, 6),
  ('dak',     '닭칼국수농축액', '박스', 28, 7),
  ('daksal',  '닭가슴살채',     '박스', 50, 8),
  ('banjuk',  '반죽면대',       '박스', 200, 9)
) as v(id, name, unit, month_avg, sort_order)
where not exists (select 1 from public.items);
