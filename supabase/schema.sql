-- ① profilesテーブル
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  basic jsonb default '{}',
  checkup jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ② logsテーブル
create table logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  date date not null,
  weight numeric(5,1),
  tags text[] default '{}',
  cond text default '',
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- ③ RLS（自分のデータだけ読み書きできる）
alter table profiles enable row level security;
alter table logs enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id);

create policy "own logs" on logs
  for all using (auth.uid() = user_id);

-- ④ updated_atの自動更新
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();
